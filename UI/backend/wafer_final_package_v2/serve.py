"""
웹 UI(waferQC)용 HTTP 추론 서버.

app.py는 시리얼/수동입력을 받아 콘솔에 출력하는 CLI라 브라우저가 붙을 수 없다.
이 파일은 wafer_model.WaferInferenceSystem을 그대로 감싸 HTTP로 노출만 한다.
판정 로직은 한 줄도 건드리지 않는다 — app.py와 완전히 같은 결과가 나와야 한다.

의존성은 표준 라이브러리만 쓴다. requirements.txt(numpy/torch/pyserial)에 이미
설치된 것 외에 새로 깔 게 없다.

실행:
    .venv\\Scripts\\python serve.py            (Windows)
    .venv/bin/python serve.py                  (macOS/Linux)
    python serve.py --port 9000                사용자 지정 포트

엔드포인트:
    GET  /health   → {"ok": true, "device": "cpu", ...}
    POST /predict  → {"hardware_map": [[8x8]]} 또는 {"cells": [64개]}
"""

from __future__ import annotations

import argparse
import json
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from wafer_model import WaferInferenceSystem

BASE_DIR = Path(__file__).resolve().parent

SYSTEM: WaferInferenceSystem | None = None


def to_grid(payload: dict) -> list[list[int]]:
    """{"hardware_map": [[8x8]]} 또는 {"cells": [64]} 둘 다 받는다."""
    if "hardware_map" in payload:
        grid = payload["hardware_map"]
    elif "cells" in payload:
        flat = payload["cells"]
        if len(flat) != 64:
            raise ValueError(f"cells는 64개여야 합니다. 받은 개수={len(flat)}")
        grid = [flat[r * 8 : r * 8 + 8] for r in range(8)]
    else:
        raise ValueError("hardware_map 또는 cells 필드가 필요합니다.")
    return grid


def build_response(system: WaferInferenceSystem, grid) -> dict:
    # top_k를 클래스 수만큼 달라고 해서 9개 확률을 전부 받는다.
    # UI가 클래스 확률을 계통으로 묶어 쓰기 때문에 일부만 오면 합이 어긋난다.
    result = system.predict(grid, top_k=len(system.class_names))

    # 클래스 순서대로 정렬한 확률 벡터를 추가로 실어 준다 (원본 필드는 그대로 둔다)
    index_of = {name: i for i, name in enumerate(system.class_names)}
    probabilities = [0.0] * len(system.class_names)
    for item in result.get("top_predictions", []):
        i = index_of.get(item["class"])
        if i is not None:
            probabilities[i] = float(item["score"])

    result["class_names"] = list(system.class_names)
    result["probabilities"] = probabilities
    result["model"] = "WaferCNNV2 + WaferHierarchicalCNNV3"
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        # 개발 서버(vite)가 다른 포트에서 뜨므로 CORS를 열어 둔다.
        # 사내 배포 시에는 허용 출처를 좁힐 것.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            assert SYSTEM is not None
            self._send(
                200,
                {
                    "ok": True,
                    "device": str(SYSTEM.device),
                    "class_names": list(SYSTEM.class_names),
                    "v3_binary_threshold": float(SYSTEM.v3_binary_threshold),
                    "model": "WaferCNNV2 + WaferHierarchicalCNNV3",
                },
            )
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/predict":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            grid = to_grid(payload)
            assert SYSTEM is not None
            self._send(200, build_response(SYSTEM, grid))
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send(400, {"error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        print(f"  {self.address_string()} {fmt % args}")


def main() -> None:
    global SYSTEM

    parser = argparse.ArgumentParser(description="waferQC 웹 UI용 추론 서버")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8077)
    parser.add_argument("--model-dir", default=str(BASE_DIR / "models"))
    parser.add_argument("--config", default=str(BASE_DIR / "config.json"))
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    SYSTEM = WaferInferenceSystem(
        model_dir=args.model_dir,
        config_path=args.config,
        device=args.device,
    )

    print(
        f"모델 로드 완료 | device={SYSTEM.device} | "
        f"V3 threshold={SYSTEM.v3_binary_threshold:.2f}"
    )
    print(f"추론 서버: http://{args.host}:{args.port}")
    print("  GET  /health")
    print("  POST /predict   {\"hardware_map\": [[8x8]]}")

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
