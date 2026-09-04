from pathlib import Path
import shutil
import zipfile

SOURCE = Path(
    "/content/drive/MyDrive/wafer_project/wafer_v2/checkpoints"
)

TARGET = Path("models")
TARGET.mkdir(parents=True, exist_ok=True)

FILES = [
    "wafer_cnn_v2_best.pt",
    "wafer_hierarchical_cnn_v3_best.pt",
]

for filename in FILES:
    src = SOURCE / filename
    dst = TARGET / filename

    if not src.exists():
        raise FileNotFoundError(src)

    shutil.copy2(src, dst)
    print("복사:", src, "->", dst)

print("\n모델 파일 복사 완료")
