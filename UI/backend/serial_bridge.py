r"""
waferQC 아두이노 시리얼 브리지.

화면(브라우저)은 시리얼 포트를 직접 못 연다. 이 파일이 그 사이를 잇는다.

    브라우저 ──HTTP──▶ serial_bridge.py ──USB Serial──▶ 아두이노 2대
                                                        ├ 쓰기(출력) : 595 래치
                                                        └ 읽기(입력) : 4067 스캔

펌웨어는 code/ 폴더의 것을 그대로 쓴다. 이 파일이 맞추는 쪽이다.

    code/쓰기아두이노/prototype_arduino/prototype_arduino.ino   ← 출력
    code/read_arduino/read_arduino.ino                          ← 입력

와이어 프로토콜 (둘 다 9600 baud, 개행 종단)

    호스트 → 쓰기 아두이노 :  "D:" + 64자리 0/1        (row-major, 1 = 불량)
    쓰기 아두이노 → 호스트 :  "OK"                      (595 래치 완료 — 되읽기가 아니다)
    읽기 아두이노 → 호스트 :  "D:" + 64자리 0/1        (값이 바뀔 때마다 자발적으로)

    쓰기 보드가 "R:" + 64자리로 답하면 4067 스캔을 같이 하던 예전 펌웨어다.
    그때는 되읽은 값이 실렸지만 그 보드엔 4067이 안 꽂혀 있어 의미 없는 상수였다.
    호환을 위해 아직 받아는 준다.

읽기 아두이노는 질의를 받지 않는다 — S0~S3이 4067 입장에서 입력이고 COMMON이 출력이라
이쪽에서 저쪽으로 정보가 흐를 길이 애초에 없다(정보 격벽). 그래서 폴링이 아니라
백그라운드 스레드가 계속 듣기만 한다.

⚠ 읽기 아두이노는 **값이 바뀔 때만** 보낸다. 부팅 직후 한 번 보내고
  (실측: "ARDUINO READY" t=1.52s → 첫 D: t=1.84s), 격자가 그대로면 그 뒤로 영영 조용하다.
  그래서 포트를 연 직후 입력 버퍼를 비우면 그 한 프레임을 잃고, 다시 달라고 할 방법이 없다
  (명령 채널이 없는 게 정보 격벽의 요점이다). 읽기 쪽은 반드시 wait_boot=False 로 붙인다.
  거꾸로 말하면 **포트를 다시 여는 것(=/reconnect)이 곧 "보드를 다시 읽기"** 다 —
  Uno 는 열 때 리셋되므로 부팅 프레임이 새로 온다.

값 변환
    화면/모델 쪽 맵은 0(웨이퍼 밖) / 1(정상 die) / 2(불량 die) 세 값이고,
    펌웨어 쪽은 0/1 두 값이다. 웨이퍼 밖 12칸의 정의는 이 파일의 _inside() 하나뿐이고
    (frontend 의 isInsideWafer 와 같은 식), 되읽은 비트에 그 마스크를 다시 씌운다.
    펌웨어는 64비트를 그대로 다룰 뿐 웨이퍼 형상을 모른다.

실행 (모델 서버와 같은 venv 를 쓴다 — pyserial 이 이미 들어 있다)

    ..\backend\wafer_final_package_v2\.venv\Scripts\python.exe serial_bridge.py

    --port 8078          HTTP 포트
    --read-port COM11    자동 탐지 대신 직접 지정
    --write-port COM12
    --invert-read        읽기 아두이노의 HIGH/LOW 가 뒤집혀 들어올 때

엔드포인트
    GET  /health                브리지·양쪽 포트 상태
    GET  /read?since=<seq>      읽기 아두이노가 마지막으로 올린 맵
    POST /write                 {"cells": [64개 0/1/2]} → 쓰기 아두이노로 송출
    POST /reconnect             포트 재탐지
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import serial
    import serial.tools.list_ports
except ImportError:  # pragma: no cover
    raise SystemExit(
        "pyserial 이 없습니다. 모델 서버 venv 로 실행하세요:\n"
        r"  backend\wafer_final_package_v2\.venv\Scripts\python.exe serial_bridge.py"
    )

BAUD = 9600
GRID = 8
CELL_COUNT = GRID * GRID

CELL_OUTSIDE = 0
CELL_NORMAL = 1
CELL_DEFECT = 2

# Uno 는 포트를 열면 DTR 이 토글되며 리셋된다. 부트로더가 빠지기를 기다리는 시간.
RESET_WAIT = 2.2

# 포트를 연 뒤 "부팅 프레임"을 기다리는 시간.
# 실측: ARDUINO READY 가 t=1.52s, 첫 D: 가 t=1.84s 에 온다. 여유를 둬서 5초.
BOOT_LISTEN = 5.0


# ── 웨이퍼 형상 ──────────────────────────────────────────────────────────────
# frontend/src/config/hardware.ts 의 isInsideWafer 와 같은 식이어야 한다.
# 여기서 어긋나면 화면과 LED 매트릭스의 모서리가 다르게 보인다.
def _inside(row: int, col: int) -> bool:
    dx = col + 0.5 - GRID / 2
    dy = row + 0.5 - GRID / 2
    return (dx * dx + dy * dy) ** 0.5 <= GRID / 2


INSIDE = [_inside(i // GRID, i % GRID) for i in range(CELL_COUNT)]


def cells_to_bits(cells) -> str:
    """0/1/2 맵 → 펌웨어가 먹는 64자리 0/1 문자열. 불량(2)만 1이다."""
    return "".join("1" if int(v) == CELL_DEFECT else "0" for v in cells)


def bits_to_cells(bits: str, invert: bool = False) -> list[int]:
    """펌웨어의 64자리 0/1 → 0/1/2 맵. 웨이퍼 밖 12칸은 무조건 0으로 덮는다."""
    out = []
    for i, ch in enumerate(bits):
        if not INSIDE[i]:
            out.append(CELL_OUTSIDE)
            continue
        hot = (ch == "1") != invert
        out.append(CELL_DEFECT if hot else CELL_NORMAL)
    return out


# ── 포트 한 개 ───────────────────────────────────────────────────────────────
class Link:
    """아두이노 한 대와의 연결. 끊겨도 죽지 않고 재연결을 계속 시도한다."""

    def __init__(self, role: str) -> None:
        self.role = role  # 'read' | 'write'
        self.port: str | None = None
        self.ser: serial.Serial | None = None
        self.error: str = ""
        self.lock = threading.Lock()

    @property
    def connected(self) -> bool:
        return self.ser is not None and self.ser.is_open

    def attach(self, port: str, wait_boot: bool) -> bool:
        """
        wait_boot=True  — 부트로더가 빠질 때까지 기다렸다가 버퍼를 비운다. 쓰기 쪽 전용:
                          부트로더가 도는 중에 D: 를 밀어 넣으면 그냥 사라진다.
        wait_boot=False — 여는 즉시 듣는다. 읽기 쪽은 반드시 이쪽이어야 한다 —
                          read_arduino 는 부팅 직후(~1.8초) 한 번 보내고 그 다음엔
                          격자 값이 바뀔 때까지 영영 조용하다. 여기서 버퍼를 비우면
                          그 유일한 프레임을 버리게 되고, 되읽기가 통째로 안 온다.
                          (요청으로 다시 받아낼 수도 없다 — 정보 격벽이라 명령 채널이 없다.)
        """
        self.detach()
        try:
            ser = serial.Serial(port, BAUD, timeout=1)
        except Exception as exc:  # noqa: BLE001
            self.port = port
            self.error = str(exc)
            return False
        if wait_boot:
            time.sleep(RESET_WAIT)
            try:
                ser.reset_input_buffer()
            except Exception:  # noqa: BLE001, S110
                pass
        self.ser = ser
        self.port = port
        self.error = ""
        return True

    def detach(self) -> None:
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:  # noqa: BLE001, S110
                pass
        self.ser = None


# ── 상태 ─────────────────────────────────────────────────────────────────────
class Bridge:
    def __init__(self, invert_read: bool) -> None:
        self.read = Link("read")
        self.write = Link("write")
        self.invert_read = invert_read

        # 읽기 아두이노가 마지막으로 올린 맵
        self.latest_cells: list[int] | None = None
        self.latest_bits: str = ""
        self.latest_at: float = 0.0
        self.seq: int = 0
        self.frames: int = 0

        # 마지막으로 쓰기 아두이노에 보낸 것
        self.sent_bits: str = ""
        self.sent_at: float = 0.0
        self.last_ack: str = ""  # 쓰기 아두이노의 래치 확인 ("OK")

        self.detect_note: str = ""
        self.state_lock = threading.Lock()
        self._stop = threading.Event()

    # ── 포트 탐지 ────────────────────────────────────────────────────────────
    def candidates(self) -> list[str]:
        """Arduino 로 보이는 포트만. 블루투스 가상 COM 은 걸러진다."""
        found = []
        for p in serial.tools.list_ports.comports():
            hwid = (p.hwid or "").upper()
            desc = (p.description or "").upper()
            if "VID:PID=2341" in hwid or "VID:PID=1A86" in hwid or "ARDUINO" in desc:
                found.append(p.device)
        return sorted(found)

    def detect(self, forced_read: str | None, forced_write: str | None) -> None:
        """
        두 대를 구분한다.

        읽기 아두이노는 아무것도 안 보내도 "D:" 를 계속 올린다.
        쓰기 아두이노는 "D:" 를 받기 전에는 한 줄도 안 보낸다.
        그래서 "가만히 듣고 있을 때 D: 가 오는가" 하나로 갈린다.
        """
        notes: list[str] = []
        ports = self.candidates()
        if not ports:
            self.detect_note = "Arduino 로 인식되는 COM 포트가 없습니다 (USB 케이블/드라이버 확인)"
            return

        # 직접 지정된 건 탐지하지 않고 그대로 붙인다
        if forced_read:
            ok = self.read.attach(forced_read, wait_boot=False)
            notes.append(f"읽기={forced_read}{'' if ok else ' (열기 실패)'}")
        if forced_write:
            ok = self.write.attach(forced_write, wait_boot=True)
            notes.append(f"쓰기={forced_write}{'' if ok else ' (열기 실패)'}")

        todo = [p for p in ports if p not in (forced_read, forced_write)]
        for port in todo:
            if self.read.connected and self.write.connected:
                break
            try:
                ser = serial.Serial(port, BAUD, timeout=0.5)
            except Exception as exc:  # noqa: BLE001
                notes.append(f"{port}: 열 수 없음 ({exc})")
                continue

            # 여는 즉시 듣는다. 버퍼를 비우면 안 된다 — 읽기 아두이노가 부팅 직후
            # 보내는 한 번뿐인 프레임이 여기 들어 있고, 그게 판별의 유일한 근거다.
            # 부트로더가 뱉는 쓰레기는 "D:" + 64자리 검사에서 알아서 걸러진다.
            role = None
            deadline = time.time() + BOOT_LISTEN
            while time.time() < deadline:
                line = ser.readline().decode("utf-8", "ignore").strip()
                if line.startswith("D:") and len(line) == 66:
                    role = "read"
                    break

            if role is None and not self.write.connected:
                # 조용하면 쓰기 아두이노인지 확인한다. 화면 내용을 지우지 않도록
                # 지금까지 보낸 패턴이 있으면 그걸, 없으면 빈 맵을 쓴다.
                probe = self.sent_bits or "0" * CELL_COUNT
                ser.reset_input_buffer()
                ser.write(f"D:{probe}\n".encode("utf-8"))
                deadline = time.time() + 3.0
                while time.time() < deadline:
                    line = ser.readline().decode("utf-8", "ignore").strip()
                    # "OK" 는 지금 펌웨어의 래치 확인. "R:" 는 4067 되읽기를 같이 하던
                    # 예전 펌웨어의 응답이다 — 그게 올라간 보드도 알아보게 둔다.
                    if line == "OK" or line.startswith("R:"):
                        role = "write"
                        break

            ser.close()

            if role == "read" and not self.read.connected:
                # 다시 열면서 아두이노가 또 리셋되므로 부팅 프레임이 한 번 더 온다.
                # 이번엔 reader_loop 가 받는다 (wait_boot=False 라 안 버린다).
                ok = self.read.attach(port, wait_boot=False)
                notes.append(f"{port} → 읽기(입력){'' if ok else ' (재연결 실패)'}")
            elif role == "write" and not self.write.connected:
                ok = self.write.attach(port, wait_boot=True)
                notes.append(f"{port} → 쓰기(출력){'' if ok else ' (재연결 실패)'}")
            else:
                notes.append(f"{port}: 응답 없음 — 펌웨어가 안 올라갔거나 다른 프로그램이 잡고 있음")

        self.detect_note = " · ".join(notes) if notes else "탐지된 포트 없음"

    # ── 읽기 스레드 ──────────────────────────────────────────────────────────
    def reader_loop(self) -> None:
        while not self._stop.is_set():
            link = self.read
            if not link.connected:
                time.sleep(1.0)
                continue
            try:
                raw = link.ser.readline()  # type: ignore[union-attr]
            except Exception as exc:  # noqa: BLE001
                link.error = f"수신 끊김: {exc}"
                link.detach()
                continue
            if not raw:
                continue
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("D:"):
                continue
            bits = line[2:]
            if len(bits) != CELL_COUNT or set(bits) - {"0", "1"}:
                continue
            with self.state_lock:
                self.latest_bits = bits
                self.latest_cells = bits_to_cells(bits, self.invert_read)
                self.latest_at = time.time()
                self.seq += 1
                self.frames += 1

    # ── 쓰기 ─────────────────────────────────────────────────────────────────
    def send(self, cells) -> dict:
        bits = cells_to_bits(cells)
        link = self.write
        if not link.connected:
            return {"ok": False, "error": link.error or "쓰기 아두이노가 연결되어 있지 않습니다", "bits": bits}

        with link.lock:
            try:
                link.ser.reset_input_buffer()  # type: ignore[union-attr]
                link.ser.write(f"D:{bits}\n".encode("utf-8"))  # type: ignore[union-attr]
            except Exception as exc:  # noqa: BLE001
                link.error = f"송신 실패: {exc}"
                link.detach()
                return {"ok": False, "error": link.error, "bits": bits}

            # 래치 확인. "OK" 는 접수했다는 뜻일 뿐 되읽기가 아니다 —
            # 실제로 잘 걸렸는지는 읽기 아두이노가 올리는 맵으로만 알 수 있다.
            # ("R:" 는 4067 스캔을 같이 하던 예전 펌웨어의 응답. 그때는 되읽은 값이 실렸다.)
            ack = ""
            deadline = time.time() + 1.5
            while time.time() < deadline:
                try:
                    line = link.ser.readline().decode("utf-8", "ignore").strip()  # type: ignore[union-attr]
                except Exception:  # noqa: BLE001
                    break
                if line == "OK":
                    ack = "OK"
                    break
                if line.startswith("R:") and len(line) == 66:
                    ack = line[2:]
                    break

        with self.state_lock:
            self.sent_bits = bits
            self.sent_at = time.time()
            self.last_ack = ack

        return {"ok": True, "bits": bits, "ack": ack}

    # ── 상태 스냅샷 ──────────────────────────────────────────────────────────
    def snapshot(self) -> dict:
        with self.state_lock:
            now = time.time()
            return {
                "ok": True,
                "invertRead": self.invert_read,
                "detectNote": self.detect_note,
                "ports": [p.device for p in serial.tools.list_ports.comports()],
                "read": {
                    "port": self.read.port,
                    "connected": self.read.connected,
                    "error": self.read.error,
                    "frames": self.frames,
                    "ageMs": None if not self.latest_at else int((now - self.latest_at) * 1000),
                },
                "write": {
                    "port": self.write.port,
                    "connected": self.write.connected,
                    "error": self.write.error,
                    "ageMs": None if not self.sent_at else int((now - self.sent_at) * 1000),
                },
                "seq": self.seq,
                "cells": self.latest_cells,
                "sentBits": self.sent_bits,
                "ack": self.last_ack,
            }


BRIDGE: Bridge | None = None
ARGS: argparse.Namespace | None = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        # 개발 서버(vite)가 다른 포트에서 뜨므로 CORS 를 열어 둔다. serve.py 와 같은 정책.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        assert BRIDGE is not None
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path in ("/health", ""):
            self._send(200, BRIDGE.snapshot())
            return

        if path == "/read":
            since = parse_qs(parsed.query).get("since", ["-1"])[0]
            try:
                since_n = int(since)
            except ValueError:
                since_n = -1
            with BRIDGE.state_lock:
                seq, cells, at = BRIDGE.seq, BRIDGE.latest_cells, BRIDGE.latest_at
            # 한 프레임도 안 올라왔으면(cells is None) 바뀐 게 아니다.
            # seq 0 과 클라이언트 초기값 -1 이 달라서 "바뀜"으로 새는 걸 막는다.
            changed = cells is not None and seq != since_n
            self._send(
                200,
                {
                    "seq": seq,
                    "changed": changed,
                    "cells": cells if changed else None,
                    "at": int(at * 1000) if at else None,
                    "connected": BRIDGE.read.connected,
                },
            )
            return

        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        assert BRIDGE is not None and ARGS is not None
        path = urlparse(self.path).path.rstrip("/")
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"error": f"본문을 읽지 못했습니다: {exc}"})
            return

        if path == "/write":
            cells = payload.get("cells")
            if not isinstance(cells, list) or len(cells) != CELL_COUNT:
                self._send(400, {"error": f"cells 는 {CELL_COUNT}개여야 합니다"})
                return
            result = BRIDGE.send(cells)
            self._send(200 if result["ok"] else 503, result)
            return

        if path == "/reconnect":
            BRIDGE.read.detach()
            BRIDGE.write.detach()
            BRIDGE.detect(ARGS.read_port, ARGS.write_port)
            self._send(200, BRIDGE.snapshot())
            return

        self._send(404, {"error": "not found"})

    def log_message(self, fmt: str, *args) -> None:
        # /read 폴링이 초당 두 번씩 들어오므로 조용히 둔다.
        return


class Server(ThreadingHTTPServer):
    """
    브리지는 화면이 붙어 있는 내내 떠 있어야 한다. 그래서 클라이언트 쪽 사정으로
    죽지 않게 한다.

    /reconnect 는 포트를 다시 훑느라 15초쯤 걸리는데, 그 사이에 브라우저가 탭을 닫거나
    새로고침하면 응답을 쓰는 순간 ConnectionResetError 가 난다. 정상적인 일이고
    브리지가 알 바가 아니므로 조용히 넘긴다 — 콘솔을 트레이스백으로 덮어 버리면
    정작 봐야 할 포트 메시지가 묻힌다.
    """

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main() -> None:
    global BRIDGE, ARGS

    parser = argparse.ArgumentParser(description="waferQC 아두이노 시리얼 브리지")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8078)
    parser.add_argument("--read-port", default=None, help="읽기(입력) 아두이노 COM 포트")
    parser.add_argument("--write-port", default=None, help="쓰기(출력) 아두이노 COM 포트")
    parser.add_argument(
        "--invert-read",
        action="store_true",
        help="읽기 아두이노가 정상=HIGH 로 올라올 때 (되읽은 맵이 전부 불량으로 보이면 이걸 켠다)",
    )
    ARGS = parser.parse_args()

    BRIDGE = Bridge(invert_read=ARGS.invert_read)

    print("아두이노 탐지 중… (Uno 는 포트를 열 때 리셋되므로 대당 몇 초 걸린다)")
    BRIDGE.detect(ARGS.read_port, ARGS.write_port)
    print(f"  {BRIDGE.detect_note}")
    print(f"  읽기(입력): {BRIDGE.read.port or '없음'}  {'OK' if BRIDGE.read.connected else BRIDGE.read.error}")
    print(f"  쓰기(출력): {BRIDGE.write.port or '없음'}  {'OK' if BRIDGE.write.connected else BRIDGE.write.error}")

    if not BRIDGE.read.connected or not BRIDGE.write.connected:
        print()
        print("  ! 두 대가 다 안 붙었습니다. 흔한 원인:")
        print("    - Arduino IDE 의 시리얼 모니터가 포트를 잡고 있다 (모니터 창을 닫을 것)")
        print("    - 펌웨어가 안 올라갔다 (code/ 폴더의 .ino 두 개를 각각 업로드)")
        print("    - USB 케이블이 충전 전용이다")
        print("  포트를 비운 뒤 화면의 '하드웨어 재연결' 버튼을 누르면 다시 찾는다.")

    threading.Thread(target=BRIDGE.reader_loop, daemon=True).start()

    print()
    print(f"시리얼 브리지: http://{ARGS.host}:{ARGS.port}")
    print("  GET  /health")
    print("  GET  /read?since=<seq>")
    print('  POST /write      {"cells": [64개]}')
    print("  POST /reconnect")

    try:
        Server((ARGS.host, ARGS.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        BRIDGE.read.detach()
        BRIDGE.write.detach()


if __name__ == "__main__":
    main()
