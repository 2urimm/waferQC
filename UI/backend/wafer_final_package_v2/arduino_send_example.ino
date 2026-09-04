/*
  테스트용 전송 예시입니다.
  실제 센서/스위치 스캔 로직으로 wafer[8][8]만 채우면 됩니다.

  PC 프로그램이 기대하는 형식:
  - 한 줄에 64개 정수
  - 값은 0 / 1 / 2
  - row-major
  - comma separated
  - 마지막에 newline

  0 = wafer 밖
  1 = normal die
  2 = defect die
*/

const unsigned long BAUD_RATE = 115200;

int wafer[8][8] = {
  {0,0,1,1,1,1,0,0},
  {0,1,1,1,1,1,1,0},
  {1,1,1,1,1,1,1,1},
  {1,1,1,1,1,1,1,1},
  {1,1,1,1,2,2,2,1},
  {1,1,1,1,2,2,2,1},
  {0,1,1,1,2,2,2,0},
  {0,0,1,1,1,1,0,0}
};

void sendWaferMap() {
  Serial.print("MAP:");

  for (int r = 0; r < 8; r++) {
    for (int c = 0; c < 8; c++) {
      Serial.print(wafer[r][c]);

      if (!(r == 7 && c == 7)) {
        Serial.print(",");
      }
    }
  }

  Serial.println();
}

void setup() {
  Serial.begin(BAUD_RATE);
  delay(2000);

  // 테스트: 부팅 후 한 번 전송
  sendWaferMap();
}

void loop() {
  // 실제 하드웨어에서는 새로운 map이 준비됐을 때만
  // sendWaferMap()을 호출하면 됩니다.
}
