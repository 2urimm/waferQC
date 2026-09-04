"""
한 컴퓨터용 프로토타입 서버 (Flask 없이, 파이썬 기본 라이브러리만 사용)
------------------------------------------------
브라우저(prototype_ui.html) <-> 이 파이썬 서버 <-> 아두이노(시리얼)

사전 준비: pip install pyserial numpy   (Thonny면 도구->패키지 관리에서 설치)
실행: python prototype_server.py
"""

import json
import time
import numpy as np
import serial
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT_NAME = 'COM12'  # 실제 아두이노 포트로 변경
BAUD = 9600
SERVER_PORT = 8000

ser = None
latest_array = None


def connect_serial():
    global ser
    ser = serial.Serial(PORT_NAME, BAUD, timeout=5)
    time.sleep(2)
    print(f'아두이노 연결됨: {PORT_NAME}')


def send_defects(flat):
    global latest_array
    bits = ''.join(str(int(b)) for b in flat)
    ser.write(f'D:{bits}\n'.encode('utf-8'))

    deadline = time.time() + 5
    result_bits = None
    while time.time() < deadline:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line.startswith('R:'):
            result_bits = line[2:]
            break

    if result_bits is None or len(result_bits) != 64:
        return None

    arr = np.array([int(b) for b in result_bits], dtype=np.uint8).reshape(8, 8)
    latest_array = arr
    return arr


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/':
            try:
                with open('prototype_ui.html', 'rb') as f:
                    body = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self._send_json({'error': 'prototype_ui.html 파일을 같은 폴더에서 찾을 수 없습니다'}, 404)
        elif self.path == '/latest':
            if latest_array is None:
                self._send_json({'error': '아직 전송된 데이터가 없습니다'}, 404)
            else:
                self._send_json({'array': latest_array.tolist()})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        if self.path == '/send':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                flat = data.get('array')
            except Exception:
                self._send_json({'error': '잘못된 요청'}, 400)
                return

            if not flat or len(flat) != 64:
                self._send_json({'error': 'array는 64개 원소여야 합니다'}, 400)
                return

            arr = send_defects(flat)
            if arr is None:
                self._send_json({'error': '아두이노 응답 없음 또는 형식 오류'}, 500)
                return

            self._send_json({'sent': flat, 'scanned': arr.tolist()})
        else:
            self._send_json({'error': 'not found'}, 404)

    def log_message(self, format, *args):
        pass  # 콘솔에 매 요청 로그 안 찍히게 조용히


if __name__ == '__main__':
    connect_serial()
    server = HTTPServer(('0.0.0.0', SERVER_PORT), Handler)
    print(f'서버 시작: http://localhost:{SERVER_PORT}')
    server.serve_forever()
