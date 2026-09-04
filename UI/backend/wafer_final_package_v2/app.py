from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

from wafer_model import WaferInferenceSystem


REVIEW_REASON_KO = {
    "structurally_ambiguous_class": "8×8 구조상 모호한 클래스",
    "below_class_threshold": "클래스별 신뢰 점수 기준 미달",
    "suspicious_none_prediction": "None 예측이지만 보조 모델이 결함 가능성 감지",
    "none_defect_disagreement": "V2/V3의 None-결함 판정 불일치",
    "defect_class_disagreement": "V2/V3의 결함 종류 판정 불일치",
    "extreme_defect_density": "고밀도 결함 패턴(Random/Near-full 계열 충돌 가능)",
}


def parse_hardware_line(line: str) -> np.ndarray:
    """
    지원 입력 예:
    0,0,1,1,...  (64개)
    MAP:0,0,1,1,... (64개)
    0 0 1 1 ... (64개)

    64개 값은 row-major:
    앞 8개가 1행, 다음 8개가 2행 ... 마지막 8개가 8행.
    """
    text = line.strip()

    if not text:
        raise ValueError("빈 입력")

    if text.upper().startswith("MAP:"):
        text = text[4:].strip()

    # [](){}는 허용
    text = re.sub(r"[\[\]\(\)\{\}]", " ", text)
    text = text.replace(",", " ").replace(";", " ")

    tokens = text.split()

    if len(tokens) != 64:
        raise ValueError(
            f"64개 값이 필요합니다. 현재 {len(tokens)}개"
        )

    try:
        values = [int(token) for token in tokens]
    except ValueError as exc:
        raise ValueError(
            "모든 입력은 정수 0/1/2여야 합니다."
        ) from exc

    invalid = sorted(set(values) - {0, 1, 2})
    if invalid:
        raise ValueError(
            f"0/1/2 외의 값이 있습니다: {invalid}"
        )

    return np.asarray(values, dtype=np.int64).reshape(8, 8)


def print_result(result, show_map=None):
    print()
    print("=" * 68)

    if show_map is not None:
        print("Hardware Map")
        for row in show_map:
            print(" ".join(str(int(v)) for v in row))
        print("-" * 68)

    print(f"Failure Type      : {result['prediction']}")
    print(f"Class Score       : {result['score']:.4f}")
    print(f"Status            : {result['status']}")
    print(f"Defect Cell Count : {result['defect_cell_count']}")

    if result.get("direction") is not None:
        print(f"Direction         : {result['direction']}")
        print(
            "Direction Score   : "
            f"{result['direction_confidence']:.4f}"
        )
        print(
            "Quadrant Count    : "
            f"{result['quadrant_counts']}"
        )

    print(
        f"V3 Auxiliary      : "
        f"{result['auxiliary_prediction']} "
        f"({result['auxiliary_score']:.4f})"
    )
    print(
        f"V3 Defect Score   : "
        f"{result['v3_defect_score']:.4f}"
    )

    print("Top predictions   :")
    for rank, item in enumerate(
        result["top_predictions"],
        start=1,
    ):
        print(
            f"  {rank}. {item['class']:<10s} "
            f"{item['score']:.4f}"
        )

    if result["review_reason"]:
        print("Review Reason     :")
        for reason in result["review_reason"]:
            print(
                "  - "
                + REVIEW_REASON_KO.get(
                    reason,
                    reason,
                )
            )

    print("=" * 68)
    print()


def list_serial_ports():
    try:
        from serial.tools import list_ports
    except ImportError:
        print(
            "pyserial이 설치되지 않았습니다.\n"
            "pip install -r requirements.txt"
        )
        return []

    ports = list(list_ports.comports())

    if not ports:
        print("검색된 시리얼 포트가 없습니다.")
        return []

    print("사용 가능한 시리얼 포트:")
    for p in ports:
        print(
            f"  {p.device:<20s} "
            f"{p.description}"
        )

    return ports


def auto_detect_serial_port() -> str:
    try:
        from serial.tools import list_ports
    except ImportError as exc:
        raise RuntimeError(
            "pyserial이 없습니다. "
            "pip install -r requirements.txt 를 실행하세요."
        ) from exc

    ports = list(list_ports.comports())

    if not ports:
        raise RuntimeError(
            "시리얼 포트를 찾지 못했습니다."
        )

    keywords = [
        "arduino",
        "usb serial",
        "usb-serial",
        "ch340",
        "cp210",
        "usbmodem",
        "usbserial",
        "ttyacm",
    ]

    scored = []

    for port in ports:
        text = (
            f"{port.device} "
            f"{port.description} "
            f"{port.manufacturer or ''}"
        ).lower()

        score = sum(
            keyword in text
            for keyword in keywords
        )

        scored.append(
            (score, port.device, port.description)
        )

    scored.sort(reverse=True)

    best_score = scored[0][0]
    best = [
        item for item in scored
        if item[0] == best_score
    ]

    if len(ports) == 1:
        return ports[0].device

    if best_score > 0 and len(best) == 1:
        return best[0][1]

    message = [
        "포트를 자동으로 하나로 결정할 수 없습니다.",
        "아래 중 하나를 --port에 직접 지정하세요.",
    ]
    for _, device, description in scored:
        message.append(
            f"  {device}: {description}"
        )

    raise RuntimeError("\n".join(message))


def run_manual(system: WaferInferenceSystem):
    print(
        "수동 입력 모드\n"
        "8×8 map 64개 값을 한 줄에 입력하세요.\n"
        "예: 0,0,1,... 총 64개\n"
        "종료: q"
    )

    while True:
        try:
            line = input("\nMAP> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n종료")
            return

        if line.lower() in {"q", "quit", "exit"}:
            return

        try:
            hardware_map = parse_hardware_line(line)
            result = system.predict(hardware_map)
            print_result(result, show_map=hardware_map)
        except Exception as exc:
            print(f"[입력 오류] {exc}")


def run_serial(
    system: WaferInferenceSystem,
    port: str,
    baud: int,
    timeout: float,
    verbose: bool = False,
):
    try:
        import serial
    except ImportError as exc:
        raise RuntimeError(
            "pyserial이 없습니다. "
            "pip install -r requirements.txt 를 실행하세요."
        ) from exc

    if port.lower() == "auto":
        port = auto_detect_serial_port()

    print(f"Serial Port : {port}")
    print(f"Baud Rate   : {baud}")
    print("64개 map이 한 줄로 들어오면 즉시 추론합니다.")
    print("Ctrl+C로 종료")

    with serial.Serial(
        port=port,
        baudrate=baud,
        timeout=timeout,
    ) as ser:
        # Arduino 계열은 포트 open 시 reset될 수 있음
        time.sleep(2.0)
        ser.reset_input_buffer()

        while True:
            try:
                raw = ser.readline()
            except KeyboardInterrupt:
                print("\n종료")
                return

            if not raw:
                continue

            line = raw.decode(
                "utf-8",
                errors="replace",
            ).strip()

            if not line:
                continue

            try:
                hardware_map = parse_hardware_line(line)
            except ValueError as exc:
                if verbose:
                    print(
                        f"[무시한 시리얼 라인] "
                        f"{line}\n  이유: {exc}"
                    )
                continue

            try:
                result = system.predict(hardware_map)
                print_result(result, show_map=hardware_map)
            except Exception as exc:
                print(f"[추론 오류] {exc}")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "8×8 Wafer Map 실시간 분류 "
            "(V2 main + V3 review + 4방향 후처리)"
        )
    )

    parser.add_argument(
        "--model-dir",
        default="models",
        help="체크포인트 폴더 (기본: models)",
    )
    parser.add_argument(
        "--config",
        default="config.json",
        help="config.json 경로",
    )
    parser.add_argument(
        "--device",
        default=None,
        help="cpu / cuda. 미지정 시 자동 선택",
    )

    mode = parser.add_mutually_exclusive_group(
        required=False
    )
    mode.add_argument(
        "--manual",
        action="store_true",
        help="키보드에서 64개 값을 직접 입력",
    )
    mode.add_argument(
        "--list-ports",
        action="store_true",
        help="시리얼 포트 목록 출력",
    )

    parser.add_argument(
        "--port",
        default="auto",
        help=(
            "Arduino 포트. 예: COM3, "
            "/dev/cu.usbmodem1101, /dev/ttyACM0. "
            "기본 auto"
        ),
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=115200,
        help="baud rate (기본 115200)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=1.0,
        help="serial read timeout 초",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="형식이 맞지 않는 시리얼 라인도 표시",
    )

    args = parser.parse_args()

    if args.list_ports:
        list_serial_ports()
        return

    system = WaferInferenceSystem(
        model_dir=args.model_dir,
        config_path=args.config,
        device=args.device,
    )

    print(
        "모델 로드 완료 | "
        f"device={system.device} | "
        f"V3 threshold={system.v3_binary_threshold:.2f}"
    )

    if args.manual:
        run_manual(system)
    else:
        run_serial(
            system=system,
            port=args.port,
            baud=args.baud,
            timeout=args.timeout,
            verbose=args.verbose,
        )


if __name__ == "__main__":
    main()
