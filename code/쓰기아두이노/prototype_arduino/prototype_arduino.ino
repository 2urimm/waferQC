/*
  쓰기(출력) 컴퓨터측 아두이노
  ------------------------------------------------------------------
  하는 일은 하나다. PC에서 받은 64비트 결함맵을 74HC595 체인에 래치한다.
  그 출력이 실물 보드를 거쳐 읽기 아두이노의 4067로 넘어간다 — 이 아두이노는
  그쪽에서 무슨 값이 읽히는지 알지 못하고, 알 방법도 없다(정보 격벽).

  프로토콜 (9600 baud, 개행 종단)
      PC → 이 보드 :  "D:" + 64자리 0/1   (row-major, 1 = 불량)
      이 보드 → PC :  "OK"                (래치 완료. 되읽은 값이 아니다)

  * "OK" 는 되읽기가 아니라 접수 확인일 뿐이다. 실제로 잘 걸렸는지는 읽기
    아두이노가 올리는 맵으로만 확인할 수 있고, 그게 이 구조의 요점이다.
    브리지(serial_bridge.py)는 이 응답으로 두 보드를 구분한다 —
    읽기 보드는 가만히 둬도 "D:" 를 올리고, 이 보드는 받기 전엔 조용하다.

  배선 (2026-09-03 확인)
      D2 = DS(직렬 데이터)   D3 = SHCP(시프트 클럭)   D4 = STCP(래치 클럭)
      그 외에 5V, GND.

  * 예전 버전에는 NeoPixel 표시와 4067 되읽기 스캔이 같이 들어 있었다.
    둘 다 걷어냈다 — 이 보드에는 D9(NeoPixel DIN)도, D5~D8/A0~A3(4067)도
    꽂혀 있지 않다. 뜬 핀을 읽어 의미 없는 상수를 회신하고 있었고,
    4067 주소선을 읽기 보드와 동시에 구동할 위험도 있었다.
    LED 매트릭스는 읽기 보드 쪽 D9에 물려 있다.
*/

#define PIN_DS   2   // 74HC595 직렬 데이터 입력
#define PIN_SHCP 3   // 시프트 레지스터 클럭
#define PIN_STCP 4   // 스토리지(래치) 클럭

#define NUM_CHIPS 8  // 595 8개 = 64비트 = 8x8

// 프로토타입을 직접 적는다. 아두이노 IDE 가 자동으로 만들어 주긴 하지만
// 배열 인자를 받는 함수에서 그 생성이 실패한다 (이 파일에 #include 가 없어서 더 그렇다).
void processLine(String line);
void shiftToChips(byte chipBytes[NUM_CHIPS]);

String inputLine = "";

void setup() {
  Serial.begin(9600);

  pinMode(PIN_DS, OUTPUT);
  pinMode(PIN_SHCP, OUTPUT);
  pinMode(PIN_STCP, OUTPUT);
  digitalWrite(PIN_STCP, LOW);

  // 전원을 넣은 직후 595 내용은 정해져 있지 않다. 빈 맵으로 한 번 밀어
  // 알 수 없는 패턴이 실물 보드에 걸린 채로 시작하지 않게 한다.
  byte blank[NUM_CHIPS] = {0};
  shiftToChips(blank);
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') {
      processLine(inputLine);
      inputLine = "";
    } else if (ch != '\r') {
      inputLine += ch;
    }
  }
}

void processLine(String line) {
  line.trim();
  if (!line.startsWith("D:")) return;
  String bits = line.substring(2);
  if ((int)bits.length() != 64) return;

  // 인덱스 i(row-major)의 비트를 칩 i/8 의 비트 i%8 로 보낸다.
  byte chipBytes[NUM_CHIPS] = {0};
  for (int i = 0; i < 64; i++) {
    if (bits[i] == '1') {
      chipBytes[i / 8] |= (1 << (i % 8));
    }
  }
  shiftToChips(chipBytes);

  Serial.println("OK");
}

void shiftToChips(byte chipBytes[NUM_CHIPS]) {
  // 체인의 끝 칩부터 밀어 넣는다 — 먼저 들어간 바이트가 가장 멀리 밀려간다.
  digitalWrite(PIN_STCP, LOW);
  for (int chip = NUM_CHIPS - 1; chip >= 0; chip--) {
    shiftOut(PIN_DS, PIN_SHCP, MSBFIRST, chipBytes[chip]);
  }
  // 래치를 올렸다 내려야 시프트된 값이 출력 핀에 나타난다.
  digitalWrite(PIN_STCP, HIGH);
  digitalWrite(PIN_STCP, LOW);
}
