from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class ResidualBlockV2(nn.Module):
    def __init__(self, channels: int, dropout: float = 0.0):
        super().__init__()

        self.conv1 = nn.Conv2d(
            channels, channels,
            kernel_size=3, padding=1, bias=False
        )
        self.norm1 = nn.GroupNorm(
            num_groups=8,
            num_channels=channels,
        )

        self.conv2 = nn.Conv2d(
            channels, channels,
            kernel_size=3, padding=1, bias=False
        )
        self.norm2 = nn.GroupNorm(
            num_groups=8,
            num_channels=channels,
        )

        self.activation = nn.GELU()
        self.dropout = nn.Dropout2d(dropout)

    def forward(self, x):
        residual = x

        x = self.conv1(x)
        x = self.norm1(x)
        x = self.activation(x)
        x = self.dropout(x)

        x = self.conv2(x)
        x = self.norm2(x)

        x = x + residual
        x = self.activation(x)

        return x


class WaferCNNV2(nn.Module):
    """
    최종 9-class 분류 모델.
    현재 노트북의 최종 predict_hardware_wafer_final()에서
    실제 Failure Type을 결정하는 메인 모델과 동일한 구조.
    """

    def __init__(self, num_classes: int = 9):
        super().__init__()

        self.stem = nn.Sequential(
            nn.Conv2d(
                3, 32,
                kernel_size=3, padding=1, bias=False
            ),
            nn.GroupNorm(8, 32),
            nn.GELU(),
        )

        self.stage1 = nn.Sequential(
            ResidualBlockV2(32, dropout=0.05),
            ResidualBlockV2(32, dropout=0.05),
        )

        self.downsample1 = nn.Sequential(
            nn.Conv2d(
                32, 64,
                kernel_size=3, stride=2,
                padding=1, bias=False
            ),
            nn.GroupNorm(8, 64),
            nn.GELU(),
        )

        self.stage2 = nn.Sequential(
            ResidualBlockV2(64, dropout=0.10),
            ResidualBlockV2(64, dropout=0.10),
        )

        self.downsample2 = nn.Sequential(
            nn.Conv2d(
                64, 128,
                kernel_size=3, stride=2,
                padding=1, bias=False
            ),
            nn.GroupNorm(8, 128),
            nn.GELU(),
        )

        self.stage3 = nn.Sequential(
            ResidualBlockV2(128, dropout=0.15),
            ResidualBlockV2(128, dropout=0.15),
        )

        self.pool = nn.AdaptiveAvgPool2d(output_size=1)

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(0.30),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        x = self.stem(x)
        x = self.stage1(x)

        x = self.downsample1(x)
        x = self.stage2(x)

        x = self.downsample2(x)
        x = self.stage3(x)

        x = self.pool(x)
        x = self.classifier(x)

        return x


class WaferHierarchicalCNNV3(nn.Module):
    """
    최종 분류값을 덮어쓰지는 않고,
    None/Defect 및 defect-class 불일치 여부를 이용해
    REVIEW 여부를 판단하는 보조 모델.
    """

    def __init__(self, num_defect_classes: int = 8):
        super().__init__()

        self.stem = nn.Sequential(
            nn.Conv2d(
                3, 32,
                kernel_size=3, padding=1, bias=False
            ),
            nn.GroupNorm(8, 32),
            nn.GELU(),
        )

        self.stage1 = nn.Sequential(
            ResidualBlockV2(32, dropout=0.05),
            ResidualBlockV2(32, dropout=0.05),
        )

        self.downsample1 = nn.Sequential(
            nn.Conv2d(
                32, 64,
                kernel_size=3, stride=2,
                padding=1, bias=False
            ),
            nn.GroupNorm(8, 64),
            nn.GELU(),
        )

        self.stage2 = nn.Sequential(
            ResidualBlockV2(64, dropout=0.10),
            ResidualBlockV2(64, dropout=0.10),
        )

        self.downsample2 = nn.Sequential(
            nn.Conv2d(
                64, 128,
                kernel_size=3, stride=2,
                padding=1, bias=False
            ),
            nn.GroupNorm(8, 128),
            nn.GELU(),
        )

        self.stage3 = nn.Sequential(
            ResidualBlockV2(128, dropout=0.15),
            ResidualBlockV2(128, dropout=0.15),
        )

        self.shared_projection = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 2 * 2, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Dropout(0.25),
        )

        # 0 = None, 1 = Defect
        self.binary_head = nn.Sequential(
            nn.Linear(256, 64),
            nn.GELU(),
            nn.Dropout(0.20),
            nn.Linear(64, 2),
        )

        # Center ~ Near-full (8 classes)
        self.defect_head = nn.Sequential(
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Dropout(0.25),
            nn.Linear(128, num_defect_classes),
        )

    def extract_features(self, x):
        x = self.stem(x)
        x = self.stage1(x)

        x = self.downsample1(x)
        x = self.stage2(x)

        x = self.downsample2(x)
        x = self.stage3(x)

        x = self.shared_projection(x)
        return x

    def forward(self, x):
        features = self.extract_features(x)

        return {
            "binary_logits": self.binary_head(features),
            "defect_logits": self.defect_head(features),
            "features": features,
        }


DIRECTION_NAMES = {
    "top_left": "왼쪽 위",
    "top_right": "오른쪽 위",
    "bottom_left": "왼쪽 아래",
    "bottom_right": "오른쪽 아래",
}


def validate_hardware_map(hardware_map) -> np.ndarray:
    arr = np.asarray(hardware_map, dtype=np.int64)

    if arr.shape != (8, 8):
        raise ValueError(
            f"입력은 반드시 8×8이어야 합니다. 현재 shape={arr.shape}"
        )

    unique_values = set(np.unique(arr).tolist())
    if not unique_values.issubset({0, 1, 2}):
        raise ValueError(
            "입력값은 0, 1, 2만 가능합니다. "
            f"현재 값={sorted(unique_values)}"
        )

    return arr


def hardware_map_to_tensor(hardware_map) -> torch.Tensor:
    arr = validate_hardware_map(hardware_map)

    map_tensor = torch.from_numpy(arr).long()

    one_hot_tensor = F.one_hot(
        map_tensor,
        num_classes=3,
    ).permute(
        2, 0, 1
    ).float()

    return one_hot_tensor


def analyze_defect_direction(
    hardware_map,
    min_gap=2.0,
):
    """
    Scratch / Loc / Edge-Loc 방향 판정.

    8×8 wafer map을 4개의 4×4 영역으로 나눈 뒤,

        가장 많은 영역의 defect 개수
        - 나머지 3개 영역의 평균 defect 개수

    가 min_gap 이상일 때만 방향성이 있다고 판단한다.

    최종 기준:
        min_gap = 2

    좌표 기준:
        row 0 = 위
        col 0 = 왼쪽
    """

    wafer_map = validate_hardware_map(
        hardware_map
    )

    # defect cell = 2
    defect_mask = (
        wafer_map == 2
    )

    total_defect_count = int(
        defect_mask.sum()
    )

    # ==============================
    # 1. 4개 영역 defect 개수 계산
    # ==============================

    quadrant_counts = {
        "top_left":
            int(
                defect_mask[
                    0:4,
                    0:4
                ].sum()
            ),

        "top_right":
            int(
                defect_mask[
                    0:4,
                    4:8
                ].sum()
            ),

        "bottom_left":
            int(
                defect_mask[
                    4:8,
                    0:4
                ].sum()
            ),

        "bottom_right":
            int(
                defect_mask[
                    4:8,
                    4:8
                ].sum()
            ),
    }


    # ==============================
    # 2. defect 자체가 없는 경우
    # ==============================

    if total_defect_count == 0:

        return {
            "direction": None,
            "direction_key": None,

            "direction_status":
                "NO_DEFECT",

            "defect_count":
                0,

            "quadrant_counts":
                quadrant_counts,

            "max_count":
                0,

            "other_mean":
                0.0,

            "direction_gap":
                0.0,

            "direction_confidence":
                0.0,

            "decision_method":
                "no_defect",
        }


    # ==============================
    # 3. 최대 defect 영역 찾기
    # ==============================

    max_count = max(
        quadrant_counts.values()
    )

    max_directions = [
        direction
        for direction, count
        in quadrant_counts.items()

        if count == max_count
    ]


    # ==============================
    # 4. 최대값이 공동 1등이면
    #    방향성 불명확
    # ==============================

    if len(max_directions) != 1:

        return {
            "direction": None,
            "direction_key": None,

            "direction_status":
                "UNCLEAR",

            "defect_count":
                total_defect_count,

            "quadrant_counts":
                quadrant_counts,

            "max_count":
                max_count,

            "other_mean":
                None,

            "direction_gap":
                0.0,

            "direction_confidence":
                0.0,

            "decision_method":
                "max_tie",
        }


    max_direction = (
        max_directions[0]
    )


    # ==============================
    # 5. 나머지 3개 영역 평균
    # ==============================

    other_counts = [
        count
        for direction, count
        in quadrant_counts.items()

        if direction != max_direction
    ]


    other_mean = float(
        np.mean(
            other_counts
        )
    )


    # ==============================
    # 6. 방향성 차이 계산
    # ==============================

    direction_gap = (
        max_count
        - other_mean
    )


    # ==============================
    # 7. N=2 기준 방향성 판단
    # ==============================

    if direction_gap >= min_gap:

        direction = (
            DIRECTION_NAMES[
                max_direction
            ]
        )

        direction_key = (
            max_direction
        )

        direction_status = (
            "DIRECTIONAL"
        )

        decision_method = (
            "max_vs_other_mean"
        )

    else:

        direction = None

        direction_key = None

        direction_status = (
            "UNCLEAR"
        )

        decision_method = (
            "below_min_gap"
        )


    # 가장 많은 영역에 전체 defect 중
    # 몇 %가 존재하는지
    direction_confidence = (
        max_count
        / total_defect_count
    )


    return {
        "direction":
            direction,

        "direction_key":
            direction_key,

        "direction_status":
            direction_status,

        "defect_count":
            total_defect_count,

        "quadrant_counts":
            quadrant_counts,

        "max_count":
            max_count,

        "other_mean":
            other_mean,

        "direction_gap":
            float(
                direction_gap
            ),

        "min_gap":
            float(
                min_gap
            ),

        "direction_confidence":
            float(
                direction_confidence
            ),

        "decision_method":
            decision_method,
    }

def _load_checkpoint(path: Path, device):
    try:
        return torch.load(
            path,
            map_location=device,
            weights_only=False,
        )
    except TypeError:
        return torch.load(
            path,
            map_location=device,
        )


class WaferInferenceSystem:
    def __init__(
        self,
        model_dir: str | Path = "models",
        config_path: str | Path = "config.json",
        device: str | None = None,
    ):
        self.model_dir = Path(model_dir)
        self.config_path = Path(config_path)

        if not self.config_path.exists():
            raise FileNotFoundError(
                f"설정 파일을 찾을 수 없습니다: {self.config_path}"
            )

        self.config = json.loads(
            self.config_path.read_text(encoding="utf-8")
        )

        self.class_names = self.config["class_names"]
        self.none_idx = int(self.config["none_index"])
        self.class_to_idx = {
            name: i for i, name in enumerate(self.class_names)
        }

        self.classwise_thresholds = {
            str(k): float(v)
            for k, v in self.config[
                "classwise_score_thresholds"
            ].items()
        }

        self.always_review_classes = set(
            self.config["always_review_classes"]
        )

        self.none_review_threshold = float(
            self.config["balanced_none_review_threshold"]
        )

        self.high_defect_cell_threshold = int(
            self.config["high_defect_cell_threshold"]
        )

        self.direction_target_classes = set(
            self.config["direction_target_classes"]
        )

        if device is None:
            self.device = torch.device(
                "cuda" if torch.cuda.is_available() else "cpu"
            )
        else:
            self.device = torch.device(device)

        self.v2_path = self.model_dir / "wafer_cnn_v2_best.pt"
        self.v3_path = self.model_dir / "wafer_hierarchical_cnn_v3_best.pt"

        missing = [
            str(p) for p in (self.v2_path, self.v3_path)
            if not p.exists()
        ]
        if missing:
            raise FileNotFoundError(
                "모델 체크포인트가 없습니다.\n"
                + "\n".join(missing)
                + "\nREADME_KR.md의 '모델 파일 준비'를 확인하세요."
            )

        self.v2 = WaferCNNV2(
            num_classes=len(self.class_names)
        ).to(self.device)

        self.v3 = WaferHierarchicalCNNV3(
            num_defect_classes=8
        ).to(self.device)

        v2_checkpoint = _load_checkpoint(
            self.v2_path, self.device
        )
        v3_checkpoint = _load_checkpoint(
            self.v3_path, self.device
        )

        self.v2.load_state_dict(
            v2_checkpoint["model_state_dict"]
        )
        self.v3.load_state_dict(
            v3_checkpoint["model_state_dict"]
        )

        self.v2.eval()
        self.v3.eval()

        self.v3_binary_threshold = float(
            v3_checkpoint.get(
                "binary_threshold",
                self.config["v3_binary_threshold_fallback"],
            )
        )

    @torch.inference_mode()
    def predict(self, hardware_map, top_k: int = 3) -> Dict[str, Any]:
        hardware_map = validate_hardware_map(hardware_map)

        model_input = (
            hardware_map_to_tensor(hardware_map)
            .unsqueeze(0)
            .to(self.device)
        )

        # -----------------------
        # V2: 최종 class 결정
        # -----------------------
        v2_logits = self.v2(model_input)
        v2_probabilities = torch.softmax(
            v2_logits, dim=1
        )[0]

        v2_score_tensor, v2_index_tensor = torch.max(
            v2_probabilities, dim=0
        )

        v2_index = int(v2_index_tensor.item())
        v2_score = float(v2_score_tensor.item())
        v2_prediction = self.class_names[v2_index]

        # -----------------------
        # V3: REVIEW 판단 보조
        # -----------------------
        v3_output = self.v3(model_input)

        v3_binary_probabilities = torch.softmax(
            v3_output["binary_logits"],
            dim=1,
        )[0]

        v3_defect_probabilities = torch.softmax(
            v3_output["defect_logits"],
            dim=1,
        )[0]

        v3_defect_score = float(
            v3_binary_probabilities[1].item()
        )

        v3_is_defect = (
            v3_defect_score
            >= self.v3_binary_threshold
        )

        v3_score_tensor, v3_index_tensor = torch.max(
            v3_defect_probabilities,
            dim=0,
        )

        v3_index = int(v3_index_tensor.item())
        v3_score = float(v3_score_tensor.item())
        v3_prediction = self.class_names[v3_index]

        v2_is_defect = v2_prediction != "None"

        class_threshold = float(
            self.classwise_thresholds[v2_prediction]
        )

        defect_cell_count = int(
            np.sum(hardware_map == 2)
        )

        review_reasons = []

        if v2_prediction in self.always_review_classes:
            review_reasons.append(
                "structurally_ambiguous_class"
            )

        if v2_score < class_threshold:
            review_reasons.append(
                "below_class_threshold"
            )

        if (
            v2_prediction == "None"
            and v3_defect_score >= self.none_review_threshold
        ):
            review_reasons.append(
                "suspicious_none_prediction"
            )

        if v2_is_defect != v3_is_defect:
            review_reasons.append(
                "none_defect_disagreement"
            )

        if (
            v2_is_defect
            and v3_is_defect
            and v2_prediction != v3_prediction
        ):
            review_reasons.append(
                "defect_class_disagreement"
            )

        if (
            defect_cell_count >= self.high_defect_cell_threshold
            and v2_prediction in {"Random", "None"}
        ):
            review_reasons.append(
                "extreme_defect_density"
            )

        review_reasons = list(dict.fromkeys(review_reasons))
        needs_review = len(review_reasons) > 0

        top_k = min(max(int(top_k), 1), len(self.class_names))
        top_scores, top_indices = torch.topk(
            v2_probabilities,
            k=top_k,
        )

        top_predictions = [
            {
                "class": self.class_names[int(index)],
                "score": float(score),
            }
            for score, index in zip(
                top_scores.cpu().numpy(),
                top_indices.cpu().numpy(),
            )
        ]

        result = {
            "prediction": v2_prediction,
            "score": v2_score,
            "status": "REVIEW" if needs_review else "ACCEPT",
            "review_reason": review_reasons,
            "class_threshold": class_threshold,
            "none_review_threshold": self.none_review_threshold,
            "top_predictions": top_predictions,
            "auxiliary_prediction": v3_prediction,
            "auxiliary_score": v3_score,
            "v3_defect_score": v3_defect_score,
            "v3_binary_threshold": self.v3_binary_threshold,
            "defect_cell_count": defect_cell_count,
        }

        # -----------------------
        # Scratch / Loc / Edge-Loc 방향
        # -----------------------
        if v2_prediction in self.direction_target_classes:
            direction_result = analyze_defect_direction(
                hardware_map
            )

            result["direction"] = direction_result["direction"]
            result["direction_confidence"] = (
                direction_result["direction_confidence"]
            )
            result["quadrant_counts"] = (
                direction_result["quadrant_counts"]
            )
            result["direction_method"] = (
                direction_result["decision_method"]
            )
        else:
            result["direction"] = None
            result["direction_confidence"] = None
            result["quadrant_counts"] = None
            result["direction_method"] = None

        return result
