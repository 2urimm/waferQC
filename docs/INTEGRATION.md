# 실제 연결 체크리스트

각 항목은 **해당 파일 하나만** 바꾸면 UI는 손대지 않아도 되게 짜 두었다.
하드웨어와 모델·지식베이스는 이미 실물이 붙어 있고, 남은 대체물은 검사 이력(localStorage)뿐이다.

---

## 1. 하드웨어 (74HC595 + CD4067) — 연결됨

**파일** `UI/backend/serial_bridge.py` · `frontend/src/services/deviceBridge.ts` · `frontend/src/components/HardwarePanel.tsx`

아두이노 2대가 실제로 붙어 있다. 펌웨어는 `code/` 폴더가 정본이고 UI 쪽이 거기에 맞춘다.

| 역할 | 펌웨어 | 배선 | 하는 일 |
| --- | --- | --- | --- |
| 출력(쓰기) | `code/쓰기아두이노/prototype_arduino/prototype_arduino.ino` | 5V, GND, D2 D3 D4 | 화면 패턴을 74HC595 체인에 래치. **그게 전부다.** |
| 입력(읽기) | `code/read_arduino/read_arduino.ino` | D5~D8, A0~A3, D9, GND | CD4067 4개로 스캔 → 시리얼로 올림 + **NeoPixel 8x8 표시** |

LED 매트릭스는 **읽기 보드**에 달려 있다(D9). 그래서 매트릭스에 뜨는 건 보내온 값이 아니라
이 보드가 **실제로 읽어낸** 값이다 — 왕복에서 비트가 새면 화면의 "어긋난 칸 수"와
매트릭스가 같이 어긋난다. 매트릭스도 읽기 쪽에만 있으므로 정보 격벽은 그대로다.

두 대 사이에는 전선만 있고 통신이 없다. 읽기 쪽은 4067의 COMMON을 읽기만 하므로
읽기 -> 쓰기 방향으로는 정보가 흐를 길 자체가 없다 (`read_arduino.ino`의 정보 격벽).

**보드가 붙어 있으면 판정 입력은 읽기 아두이노가 올린 맵 하나뿐이다**
(`AppStore.runInspection`의 기본 인자가 `'hardware'`). 화면 맵으로 **조용히** 대체되는 경로는
없다 — 하드웨어를 거쳤다고 표시된 결과가 실은 화면에서 나온 것이면 그 사실이 어디에도
안 남는다. 되읽은 프레임이 없을 때만 `패턴 선택` 카드의 버튼이 `하드웨어 없이 이 패턴으로
판정`으로 바뀌고, 그렇게 나온 판정은 `source: 'draw'`로 이력에 기록된다.

### 시리얼 프로토콜 (실제)

9600 baud, 개행 종단. `serial_bridge.py`가 이 문자열을 전부 흡수하고, 프론트로는 0/1/2 맵만 올라간다.

```
호스트 -> 쓰기 아두이노   D:<64자리 0/1>    row-major, 1 = 불량
쓰기 아두이노 -> 호스트   OK                595 래치 완료 (되읽기가 아니다)
읽기 아두이노 -> 호스트   D:<64자리 0/1>    값이 바뀔 때마다 자발적으로
```

`OK` 는 접수 확인일 뿐이다. 실제로 잘 걸렸는지는 읽기 아두이노가 올리는 맵으로만 알 수 있고,
그게 이 구조의 요점이다. 브리지는 이 응답으로 두 보드를 구분한다 — 읽기 보드는 가만히 둬도
`D:` 를 올리고, 쓰기 보드는 받기 전엔 조용하다. (옛 펌웨어의 `R:` 도 아직 받아준다.)

**값 변환** — 화면/모델 맵은 0(웨이퍼 밖)/1(정상)/2(불량) 세 값, 펌웨어는 0/1 두 값이다.
브리지가 되읽은 비트에 웨이퍼 마스크를 다시 씌운다.

⚠ **웨이퍼 밖 12칸의 정의가 세 곳에 있다** — `read_arduino.ino`의 `isOutsideWafer()`(LED 표시용),
`serial_bridge.py`의 `_inside()`, `config/hardware.ts`의 `isInsideWafer()`. 셋이 같아야 하고,
한 곳만 바뀌면 화면과 매트릭스의 모서리가 조용히 달라진다.

⚠ **매트릭스 방향**은 `read_arduino.ino`의 `mapIndexToLED()` 한 줄이 정한다. 현재 매트릭스가
180도 돌아가 달려 있어 `return 63 - i` 다. 모서리 마스크는 180도 회전에 대칭이라 이 어긋남을
**드러내지 못하므로**, 방향 확인은 반드시 비대칭 패턴으로 할 것. 다른 배선(좌우/상하 반전,
지그재그, 행열 교환)의 식은 그 함수 주석에 적어 두었다.

### 브리지 띄우기

```
cd /d F:\waferQC\UI\backend
wafer_final_package_v2\.venv\Scripts\python.exe serial_bridge.py
```

`UI/start.bat`이 세 번째 창으로 같이 띄운다. 포트는 자동으로 갈린다 —
읽기 아두이노는 가만히 둬도 `D:`를 올리고, 쓰기 아두이노는 `D:`를 받기 전에는 조용하다.
직접 지정하려면 `--read-port COM11 --write-port COM12`.

### 확인해야 할 것

- **되읽은 맵이 보낸 맵과 일치하는가.** `패턴 선택` 카드의 판정 버튼 바로 아래에 어긋난 칸 수가
  항상 뜬다. 맵이 뒤섞여도 **에러는 안 난다** — 이 수치가 유일한 신호다.
  (되읽은 맵 자체는 화면에 격자로 그리지 않는다. 읽기 보드의 LED 매트릭스가 실물로 띄운다.)
- **전부 어긋나면** 읽기 쪽 HIGH/LOW가 뒤집힌 것이다. 브리지를 `--invert-read`로 띄운다.
- **쓰기 보드는 595만 건드린다.** 예전엔 NeoPixel 표시와 4067 되읽기 스캔이 같이 들어 있었으나
  그 보드엔 D9도 D5~D8/A0~A3도 꽂혀 있지 않아 뜬 핀을 읽고 있었다. 둘 다 걷어냈다
  (4040바이트, 12%). 4067 주소선을 두 보드가 동시에 구동할 위험도 같이 없어졌다.
- **포트를 다른 프로그램이 잡고 있으면 안 된다.** Arduino IDE의 시리얼 모니터가
  열려 있으면 브리지가 그 포트를 못 연다 (`PermissionError 13`). 모니터를 닫고
  화면의 `재연결` 버튼을 누른다.

---

## 2. 모델

**파일** `src/services/inference.ts` → `HttpInferenceEngine`

`predict()`는 이미 구현되어 있다. 서버만 계약대로 띄우면 된다:

```ts
setInferenceEngine(new HttpInferenceEngine('http://<서버>:<포트>'));
```

요청·응답 형태는 [MODEL_CONTRACT.md](MODEL_CONTRACT.md) §4.
서버는 노트북의 `predict_final_wafer()`를 그대로 감싸면 되고, 필드명을 노트북과 같게 맞춰 두었다.

체크할 것:

- `probabilities` 9개 전부 내려주기 (top-k만 오면 계통 합이 낮아진다)
- `CLASS_NAMES` 순서가 `config/model.ts`와 동일한지
- CORS 허용
- `review_reasons`를 내려주면 UI 규칙 대신 그쪽을 쓴다

---

## 3. 검사 이력 (MES · DB)

**파일** `src/services/history.ts`

함수 시그니처를 전부 `Promise`로 잡아 뒀으므로 `localStorage` 호출부만 `fetch`로 바꾸면
호출하는 쪽은 안 바뀐다.

```
loadHistory()                    → GET  /inspections?lot=&from=&to=
saveInspection(item)             → POST /inspections
updateInspection(id, patch)      → PATCH /inspections/:id
```

`buildSeed()`는 가상 데이터 생성기이므로 실제 연결 시 제거한다.

로트/웨이퍼 번호는 지금 사용자가 직접 입력한다. MES에 붙으면 현재 처리 중인 로트를 자동으로
가져오고, 로트의 공정 경로(어느 장비를 지나왔는지)까지 받으면 **원인 추적의 commonality 분석이
자동화된다** — 지금은 "이력 대조 필요"로만 표시하고 사람이 직접 보게 되어 있는 부분이다.

---

## 4. 지식베이스 채우기

**원본** `data/반도체 불량 분석 개선안.xlsx` · `data/불량 대응 log.xlsx`
**생성** `UI/frontend/scripts/gen_from_xlsx.py` → `causeMatrix.generated.ts` · `historySeed.generated.ts`

지식베이스는 코드가 아니라 엑셀이 정본이다. 비는 칸을 채우려면 엑셀을 고치고 스크립트를
다시 돌린다 — 코드나 생성 파일을 직접 고치면 다음 생성 때 덮어써진다.

- **매핑이 없는 공정 × 패턴 조합은 화면에 그대로 드러낸다.** 안 보이는 것과 "배제되었다"는
  건 다르므로, 공정 탭에 `매핑된 원인이 없는 공정`으로 이름만 남긴다.
- **"유발하지 않는다"는 빈칸이 아니다.** 엑셀에 판단 근거가 적힌 칸 4개는 `EXCLUSION_NOTES`로
  들어가 공정 탭 하단에 근거째로 뜬다.
- 방향성이 `장비 구조 의존`으로만 적힌 6건은 `⚙ 설비 배치 실측 필요`로 갈라 둔다. 설비 배치
  각도를 받으면 이들도 방위 대조 대상이 된다.

---

## 5. 규칙을 고칠 때

`npm run verify`가 프리셋 9종의 판정을 회귀 기준선과 대조한다. 판정 규칙(`classify.ts`),
피처(`features.ts`), 계획(`plan.ts`)을 건드렸으면 반드시 돌릴 것.

실제 모델이 붙으면 이 하네스의 대상은 `classify.ts`가 아니라 모델이 되므로, 그때는
`scripts/verify-presets.ts`가 모델 서버를 호출하도록 바꿔서 **회귀 테스트로 계속 쓰면 된다.**
