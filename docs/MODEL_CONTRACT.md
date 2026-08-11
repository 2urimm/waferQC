# 모델 계약

UI와 모델이 맞춰야 하는 것들. 출처는 `ConvNeXt_CNN.ipynb`가 내보내는
`final_hardware_inference_policy.json`이며, 코드에서는 **`src/config/model.ts` 하나**가 정본이다.

> 여기가 어긋나면 판정이 **조용히** 틀어진다. 에러도 안 나고 화면도 정상으로 보이는데
> 라벨만 밀려 있는 상태가 된다. 모델을 재학습하면 policy JSON을 받아 아래를 대조할 것.

---

## 1. 입력

| 항목 | 값 |
| --- | --- |
| 형태 | `[8, 8]` 정수 배열 |
| 값 | `0` = 웨이퍼 밖 · `1` = 정상 die · `2` = 불량 die |
| 모델 전처리 | `F.one_hot(map, 3).permute(2,0,1).float()` → `(3, 8, 8)` |

원형 웨이퍼를 8×8에 얹으면 네 모서리 12칸이 밖이므로 실제 유효 셀은 **52칸**이다.
`0` 칸은 불량 비율 계산의 분모에서 빠진다.

### ⚠ 임계값 두 개를 혼동하지 말 것

노트북과 UI에 비슷한 이름의 임계값이 있는데 **서로 다른 것**이다.

| | 노트북 | UI (`config/hardware.ts`) |
| --- | --- | --- |
| 이름 | `CONVERSION_DEFECT_THRESHOLD` = 0.05 | `ADC_DEFECT_CUTOFF` = 0.55 |
| 재는 것 | 한 칸 안의 die 중 **불량 비율** | 센서 하나의 **전압** |
| 왜 필요한가 | 고해상도 WM-811K 맵을 8×8로 줄일 때 | 8×8을 직접 재는 하드웨어에서 |

노트북은 이미 있는 고해상도 맵을 다운샘플링한다. 우리 하드웨어는 한 칸이 곧 센서 하나라
다운샘플링이 없고, 대신 "이 전압이 불량인가"를 가르는 별도 임계가 필요하다.

**실제 보드가 나오면** 알려진 정상/불량 웨이퍼로 전압 히스토그램을 떠서 두 분포가 갈리는 지점으로
`ADC_DEFECT_CUTOFF`를 잡고, 그렇게 만들어진 8×8 분포가 모델 학습 분포와 맞는지도 확인해야 한다.
여기가 틀어지면 모델이 아무리 좋아도 판정이 통째로 어긋난다.

---

## 2. 출력 — 9클래스

**순서가 곧 모델 출력 인덱스다.** 바꾸면 라벨이 전부 밀린다.

```
0 Center   1 Donut     2 Edge-Loc   3 Edge-Ring   4 Loc
5 Random   6 Scratch   7 Near-full  8 None
```

| 모델 | 역할 |
| --- | --- |
| `WaferCNNV2` (primary) | 9클래스 최종 예측 |
| `WaferHierarchicalCNNV3` (auxiliary) | 검토 판단 보조, 이진(정상/불량) 임계 보유 |

### 계통 매핑

UI는 9클래스를 6계통으로 묶어 헤드라인을 만든다. 각 클래스는 **정확히 한 계통에만** 속한다 —
겹치면 계통 확률의 합이 1을 넘는다.

| 계통 | 클래스 |
| --- | --- |
| NORMAL 정상 | None |
| RADIAL_INNER 중심계 | Center, Donut |
| RADIAL_OUTER 외곽계 | Edge-Ring, Edge-Loc |
| LOCAL 국부계 | Loc, Scratch |
| SCATTER 산발계 | Random |
| GLOBAL 전면계 | Near-full |

---

## 3. 검토(review) 정책

모델이 낸 판정을 자동으로 채택해도 되는지 판단한다. UI는 이 결과를 판정 카드 **위에** 띄운다.

| 상수 | 값 | 뜻 |
| --- | --- | --- |
| `LOW_PRIMARY_SCORE` | 0.60 | 1순위 확률이 이 아래면 검토 |
| `ALWAYS_REVIEW_CLASSES` | `Random`, `Near-full` | 확률과 무관하게 항상 검토 |
| `HIGH_DEFECT_CELL_THRESHOLD` | 50 | 불량 칸이 이 개수 이상이면 검토 |
| `NONE_REVIEW_THRESHOLD` | 0.5 | 정상 판정인데 불량 근거가 이만큼 있으면 검토 |
| `V3_BINARY_THRESHOLD` | 0.5 | 보조 모델 이진 임계 |

노트북이 내보내는 `review_reasons` 코드 11종은 `REVIEW_REASON_COPY`에 한국어 설명과 조치까지
같이 적어 두었다. 코드만 화면에 띄우면 엔지니어가 읽을 수 없다.

**서버가 `review_reasons`를 내려주면 그쪽이 정본이다.** UI의 `domain/review.ts`는 서버가 없을 때만
같은 규칙을 대신 돌린다.

---

## 4. HTTP 계약

```
POST {baseUrl}/predict
요청  { "hardware_map": number[8][8] }        // 0 / 1 / 2
```

응답 (`services/inference.ts`의 `PredictResponse`):

```jsonc
{
  "probabilities": [0.02, 0.01, 0.31, 0.03, 0.30, 0.03, 0.25, 0.03, 0.02],
  "final_prediction": "Edge-Loc",
  "final_score": 0.31,
  "primary_model": "WaferCNNV2",
  "v2_top_predictions": [{ "class": "Edge-Loc", "score": 0.31 }],
  "auxiliary_used": true,
  "v3_binary_defect_score": 0.88,
  "v3_auxiliary_prediction": "Edge-Loc",
  "v3_auxiliary_score": 0.74,
  "needs_review": true,
  "review_reasons": ["low_primary_score"],
  "defect_cell_count": 8
}
```

`probabilities`는 **9개 전부** 내려주는 게 좋다. `v2_top_predictions`만 오면 나머지 클래스가 0으로
채워져 계통 합이 실제보다 낮게 나온다.

---

## 5. UI가 스스로 계산하는 것

모델이 확률만 줘도 아래는 UI가 순수하게 피처에서 계산하므로 모델과 어긋나지 않는다
(`classify.ts`의 `verdictFromProbabilities()`).

- 공간 통계 (반경 무게중심 · 반경 프로파일 · 군집 · 이방성 · 각도 분산 · 방위)
- 판정 근거 목록과 그 설명
- 저해상도 한계 경고
- 계통 집계
- 공정별 점검 계획

모델이 바뀌어도 이 부분은 그대로 쓴다.
