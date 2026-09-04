/*
  읽기 컴퓨터측 아두이노 (최종본)
  ------------------------------------------------
  1. 4067 네 개의 S0~S3(D5~D8, 4개 4067이 공유)을 구동해서 채널을 스캔
     (오늘 디버깅으로 확인된 문제 때문에 그레이 코드 순서로 스캔 -
      한 번에 주소 비트 1개만 바뀌도록 해서 다중 비트 동시 전환 글리치 방지)
  2. 매 채널마다 4개 4067의 COMMON 핀(A0~A3)을 동시에 읽어 4비트씩 수집
     (16채널 x 4비트 = 64비트 = 8x8 결함맵 전체)
  3. 완성된 64비트를 "D:" + 64자리(0/1) 문자열로 만들어 USB Serial로
     읽기 컴퓨터(read_computer.py)에 전달
  4. 같은 값을 NeoPixel 8x8 매트릭스(D9)에 띄웁니다 - 이 보드가 실제로
     읽어낸 것이 무엇인지 사람이 눈으로 볼 수 있게. 표시는 읽기 결과이지
     보내온 값이 아닙니다. 둘이 다르면 화면의 "어긋난 칸 수"와 이 매트릭스가
     같이 어긋나 보입니다.

  * 정보 격벽: S0~S3은 4067 입장에서 "입력", COMMON은 "출력"이므로
    이 아두이노 -> 쓰기 아두이노 방향으로는 어떤 정보도 흘러갈 수 없습니다.
    매트릭스도 이쪽 보드에만 달려 있어서 이 성질을 깨지 않습니다.

  * 격자 <-> mux/칩 매핑 (wiring_test.ino로 실제 검증된 배선 기준):
      mux1(COMMON->A0): 칩1(홀수,I0~I7)=0행 / 칩2(짝수,I8~I15)=1행
      mux2(COMMON->A1): 칩3(홀수,I0~I7)=2행 / 칩4(짝수,I8~I15)=3행
      mux3(COMMON->A2): 칩5(홀수,I0~I7)=4행 / 칩6(짝수,I8~I15)=5행
      mux4(COMMON->A3): 칩7(홀수,I0~I7)=6행 / 칩8(짝수,I8~I15)=7행
    채널 c(0~15): 열 = c%8, 행은 c<8이면 홀수칩 행, c>=8이면 짝수칩 행
*/

#include <Adafruit_NeoPixel.h>

#define PIN_S0 5   // 4067 공용 주소선 (LSB)
#define PIN_S1 6
#define PIN_S2 7
#define PIN_S3 8   // (MSB)

#define LED_PIN 9    // NeoPixel DIN
#define NUM_LEDS 64
#define BRIGHTNESS 40  // 64칸 전부 흰색이어도 전원이 감당하는 값

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// mux 순서: {mux1, mux2, mux3, mux4} (칩1,2 / 칩3,4 / 칩5,6 / 칩7,8)
const int muxCommonPin[4] = {A0, A1, A2, A3};
// 각 mux가 담당하는 (홀수칩 행, 짝수칩 행)
const int muxOddRow[4]  = {0, 2, 4, 6};
const int muxEvenRow[4] = {1, 3, 5, 7};

// 그레이 코드 순서: 한 번에 딱 1개 주소 비트만 바뀌도록 스캔 순서를 재배열
const int grayOrder[16] = {0, 1, 3, 2, 6, 7, 5, 4, 12, 13, 15, 14, 10, 11, 9, 8};

byte grid[8][8]; // [row][col]
byte prevGrid[8][8];
byte lastSentGrid[8][8];
bool havePrev = false;
bool haveLastSent = false;

void setup() {
  Serial.begin(9600);

  pinMode(PIN_S0, OUTPUT);
  pinMode(PIN_S1, OUTPUT);
  pinMode(PIN_S2, OUTPUT);
  pinMode(PIN_S3, OUTPUT);

  for (int m = 0; m < 4; m++) {
    pinMode(muxCommonPin[m], INPUT);
  }

  strip.begin();
  strip.setBrightness(BRIGHTNESS);
  strip.show();  // 켜자마자 전부 꺼진 상태로
}

void loop() {
  scanAll();

  // 연속 2회 스캔 결과가 완전히 같아야 "확정된 값"으로 인정 (노이즈 필터링)
  if (havePrev && gridsEqual(grid, prevGrid)) {
    if (!haveLastSent || !gridsEqual(grid, lastSentGrid)) {
      sendGrid();
      showGrid();  // 시리얼로 올린 것과 같은 값을 매트릭스에도
      copyGrid(grid, lastSentGrid);
      haveLastSent = true;
    }
  }

  copyGrid(grid, prevGrid);
  havePrev = true;
  delay(100);
}

bool gridsEqual(byte a[8][8], byte b[8][8]) {
  for (int r = 0; r < 8; r++)
    for (int c = 0; c < 8; c++)
      if (a[r][c] != b[r][c]) return false;
  return true;
}

void copyGrid(byte src[8][8], byte dst[8][8]) {
  for (int r = 0; r < 8; r++)
    for (int c = 0; c < 8; c++)
      dst[r][c] = src[r][c];
}

void setChannel(int c) {
  digitalWrite(PIN_S0, bitRead(c, 0));
  digitalWrite(PIN_S1, bitRead(c, 1));
  digitalWrite(PIN_S2, bitRead(c, 2));
  digitalWrite(PIN_S3, bitRead(c, 3));
  delay(5); // 4067 스위칭 안정화 대기 (오늘 디버깅 기준값)
}

void scanAll() {
  for (int i = 0; i < 16; i++) {
    int c = grayOrder[i];
    setChannel(c);
    int col = c % 8;
    bool isOddChipHalf = (c < 8); // I0~I7 = 홀수칩, I8~I15 = 짝수칩

    for (int m = 0; m < 4; m++) {
      int val = digitalRead(muxCommonPin[m]);
      int row = isOddChipHalf ? muxOddRow[m] : muxEvenRow[m];
      grid[row][col] = (val == HIGH) ? 1 : 0;
    }
  }
}

void sendGrid() {
  String bits = "";
  for (int r = 0; r < 8; r++) {
    for (int c = 0; c < 8; c++) {
      bits += grid[r][c] ? '1' : '0';
    }
  }
  Serial.println("D:" + bits);
}

/*
  웨이퍼 밖 12칸 (네 모서리 3칸씩). 실제 웨이퍼는 원형이라 정사각 격자의
  모서리는 웨이퍼 밖이고, 데이터가 없는 칸이므로 꺼 둔다. 인덱스 = row*8+col.

  ⚠ 이 12칸의 정의는 세 곳에 있고 셋이 같아야 한다:
       여기 · serial_bridge.py 의 _inside() · frontend 의 isInsideWafer()
     한 곳만 바뀌면 화면과 매트릭스의 모서리가 조용히 달라진다.
*/
bool isOutsideWafer(int i) {
  switch (i) {
    case 0:  case 1:  case 8:    // 좌상단
    case 6:  case 7:  case 15:   // 우상단
    case 48: case 56: case 57:   // 좌하단
    case 55: case 62: case 63:   // 우하단
      return true;
    default:
      return false;
  }
}

/*
  격자 인덱스(row-major, 0=좌상단) → 매트릭스의 LED 번호.

  매트릭스가 180도 돌아간 채로 달려 있어서 뒤집는다. 실측: 좌상단에 있어야 할
  패턴이 우하단에 떴다. (r,c) -> (7-r, 7-c) 이므로 i -> 63-i 다.

  * 모서리 마스크는 180도 회전에 대칭이라 이 어긋남을 드러내지 못한다.
    방향은 반드시 비대칭 패턴으로 확인할 것.

  다른 배선이면 아래로 바꾸면 된다. 여기 한 줄만 고치면 전부 따라온다:
      그대로            return i;
      좌우 반전         return (i / 8) * 8 + (7 - i % 8);
      상하 반전         return (7 - i / 8) * 8 + (i % 8);
      180도 회전        return 63 - i;
      지그재그(홀수행)  { int r = i/8, c = i%8; return r*8 + ((r % 2) ? 7-c : c); }
      행/열 뒤바뀜      return (i % 8) * 8 + (i / 8);
*/
int mapIndexToLED(int i) {
  return 63 - i;
}

/*
  스캔 결과를 매트릭스에 그린다.
  불량 = 빨강 / 정상 = 흰색 / 웨이퍼 밖 = 꺼짐 (원형 웨이퍼 모양이 그대로 보인다).
*/
void showGrid() {
  for (int i = 0; i < NUM_LEDS; i++) {
    int led = mapIndexToLED(i);
    if (isOutsideWafer(i)) {
      strip.setPixelColor(led, strip.Color(0, 0, 0));
    } else if (grid[i / 8][i % 8]) {
      strip.setPixelColor(led, strip.Color(255, 0, 0));        // 불량
    } else {
      strip.setPixelColor(led, strip.Color(255, 255, 255));    // 정상
    }
  }
  strip.show();
}
