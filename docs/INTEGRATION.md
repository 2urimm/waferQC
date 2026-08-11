# 실제 연결 체크리스트

지금은 전부 대체물로 돌아간다. 각 항목은 **해당 파일 하나만** 바꾸면 UI는 손대지 않아도 되게 짜 두었다.

---

## 1. 하드웨어 (74HC595 + CD4067)

**파일** `src/services/deviceLink.ts` → `SerialDeviceLink`

현재 `MockDeviceLink`가 스캔 시퀀스와 타이밍을 재현한다. 실제 보드가 준비되면:

1. `SerialDeviceLink.connect()`에 Web Serial 구현
   - `navigator.serial.requestPort()`는 **사용자 제스처(버튼 클릭) 안에서** 호출해야 한다.
     `장비` 탭의 연결 버튼 핸들러가 그 자리다.
   - secure context 필요 — `localhost`면 된다 (dev 서버가 `127.0.0.1:5180`).
2. `scan()`에서 프레임을 읽어 `ScanFrame`으로 변환
3. `createDeviceLink()`는 이미 `linkKind`로 분기하므로 그대로 둔다

### 시리얼 프로토콜 초안

`deviceLink.ts`의 `WIRE_PROTOCOL` 문자열에 있고 `장비` 탭 화면에도 그대로 뜬다.
펌웨어 담당과 맞춰야 하는 계약이라 코드 옆에 두었다.

```
호스트 → 보드
  V\n                     펌웨어 버전 질의
  W <hex...>\n            패턴 래치 (셀당 1바이트)
  P <addrUs> <settleUs>\n MUX 타이밍 설정
  S\n                     1프레임 스캔 요청

보드 → 호스트
  VER <문자열>
  OK
  FRAME <n> <v0> ... <v_{n-1}>   ADC 원시값 0~1023, 스캔 순서대로
  ERR <메시지>
```

**반드시 합의할 것**

- `FRAME`의 순서가 UI의 `buildScanSequence(order, circleMask)`와 같아야 한다.
  보드가 뱅크 순으로 보내는데 UI가 래스터로 읽으면 맵이 뒤섞이는데, **에러가 안 난다.**
- 웨이퍼 밖 12칸을 보드가 보내는지(`n`=64) 안 보내는지(`n`=52).

### 타이밍 예산 교정

`config/hardware.ts`의 `DEFAULT_TIMING`은 데이터시트 + Arduino Uno 기준 **추정치**다.
오실로스코프로 실측해 교체할 것. `장비` 탭의 슬라이더로 값을 바꿔 가며 프레임 시간을 맞춰 볼 수 있다.

### 전압 → 셀 상태 교정

`ADC_DEFECT_CUTOFF` (`config/hardware.ts`). 알려진 정상/불량 웨이퍼의 전압 히스토그램에서
두 분포가 갈리는 지점으로 잡는다. 자세한 건 [MODEL_CONTRACT.md](MODEL_CONTRACT.md) §1.

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

## 4. 매뉴얼

**파일** `src/services/manuals.ts`

브라우저는 보안상 UNC 경로(`\\fileserver\...`)를 링크로 열 수 없어서 지금은 경로를 클립보드에
복사해 준다. 선택지:

- 사내 문서 포털에 http URL이 있으면 `url` 필드만 채우면 링크가 된다 (코드는 이미 분기되어 있다)
- 파일 서버를 WebDAV/HTTP로 노출
- 데스크톱 앱(Electron/Tauri)으로 감싸면 로컬 경로를 직접 열 수 있다

`MANUALS` 배열의 `causeIds`가 `causes.ts`의 원인 항목 id와 연결되어 있다. 매뉴얼을 추가하려면
여기에 한 줄 넣으면 해당 원인 카드에 자동으로 붙는다.

---

## 5. 보안 — ⚠ 가장 중요

**파일** `src/services/security.ts`

> **지금 마스킹은 화면 표시 제어일 뿐이다.** 원인 지식베이스가 프론트엔드 번들에 그대로 들어
> 있어서 개발자 도구를 열면 전부 보인다. 실제 배포에서 기밀이 의미를 가지려면 아래가 필요하다.

1. **원인 매트릭스를 서버로 옮기고, 서버가 세션 역할에 따라 필터링해서 내려준다.**
   클라이언트가 받은 뒤 가리는 방식으로는 안 된다.
   `services/inference.ts`의 모델 서버와 같은 자리에 두면 된다.
2. **감사 로그를 서버에 남긴다.** 지금은 `localStorage`라 사용자가 지울 수 있다.
3. **인증을 사내 SSO에 붙인다.** `DEMO_USERS`는 역할 전환 데모용 가짜 계정이다.
4. **보고서 반출을 서버 경유로.** 지금은 브라우저가 로컬에서 `.md`를 만들어 다운로드한다.

권한 판정 함수(`visibilityFor`, `canSeeDetail`, `canSeeCause`)와 마스킹이 걸리는 지점,
감사 이벤트 종류는 그대로 두고 **데이터 출처만** 서버로 옮기면 되도록 짜 두었다.

### 현재 정책

| 역할 | 볼 수 있는 것 |
| --- | --- |
| 공정기술 총괄 | 전부 |
| 공정 담당 엔지니어 | 담당 공정은 전부, 타 공정은 기밀 등급에 따라 요약 또는 공정명까지 |
| 설비 오퍼레이터 | 제한 등급 공정은 공정명까지, 나머지는 원인·기전까지 |
| 참관 · 교육 | 사내 일반 등급만 요약, 나머지는 공정명까지 |

공정별 기밀 등급은 `PROCESS_CLASSIFICATION`에 있다. 실제로는 사내 정보보호 정책 테이블에서
내려와야 한다.

---

## 6. 지식베이스 채우기

**파일** `src/domain/causes.ts`

원본 표를 그대로 옮긴 것이고, 비어 있던 5열 "핵심 제어 및 개선안"만 초안으로 채웠다.

- 초안 항목은 전부 `actionable.draft = true` → 화면에 *"초안 (검토 필요)"*로 표시된다.
  공정 담당이 검토한 뒤 `draft: false`로 바꾼다.
- 원본 표를 옮기며 확인이 필요하다고 본 지점은 `note`에 남겼다. 대시보드의
  "지식베이스 상태 · 확인 필요"에 개수가 뜬다.
  - `Donut` 행의 Cleaning·Photo 항목이 정적/경시 양쪽에 중복 기재
  - `Near-full`의 CMP 패드 항목이 R2R 열에 있으나 내용은 경시 변화 성격
  - `Edge-Ring`의 RTP 항목이 "donut 유사"로 기재 — 저해상도에서 특히 안 갈리는 쌍
- **`Loc`과 `Random`은 원본 표가 비어 있다.** 이 패턴으로 판정되면 UI가 어느 공정도 제시하지
  못한다. 대시보드에 "원인 매핑이 비어 있는 패턴"으로 표시되므로 우선 채울 것.

공정 목록(`PROCESSES`)은 8대 공정 + CMP · 세정 + 공통 설비로 구성했다. 팀에서 쓰는 공정 구분이
다르면 이 레지스트리만 갈아끼우면 된다 — `CauseEntry.process`가 그 id를 참조한다.

---

## 7. 규칙을 고칠 때

`npm run verify`가 프리셋 9종의 판정을 회귀 기준선과 대조한다. 판정 규칙(`classify.ts`),
피처(`features.ts`), 계획(`plan.ts`)을 건드렸으면 반드시 돌릴 것.

실제 모델이 붙으면 이 하네스의 대상은 `classify.ts`가 아니라 모델이 되므로, 그때는
`scripts/verify-presets.ts`가 모델 서버를 호출하도록 바꿔서 **회귀 테스트로 계속 쓰면 된다.**
