"""
Downloads the int8 ONNX models and tokenizers used by the service.
Runs at image build time (and once locally); serving never touches the network.

    python scripts/fetch_models.py            # into $ONNX_MODEL_DIR or ml-service/models/onnx
"""

import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

MODELS = {
    "sentiment": ("Xenova/distilbert-base-uncased-finetuned-sst-2-english", "0b6928efcb76139cae2c6881d49cda67fe119f42"),
    "embedder": ("Xenova/all-MiniLM-L6-v2", "751bff37182d3f1213fa05d7196b954e230abad9"),
}
FILES = ("onnx/model_quantized.onnx", "tokenizer.json")


def main() -> int:
    target = Path(os.getenv("ONNX_MODEL_DIR") or Path(__file__).resolve().parent.parent / "models" / "onnx")
    for name, (repo, revision) in MODELS.items():
        folder = target / name
        folder.mkdir(parents=True, exist_ok=True)
        for file in FILES:
            # Pinned revisions keep builds reproducible.
            path = hf_hub_download(repo, file, revision=revision)
            shutil.copyfile(path, folder / Path(file).name)
        print(f"[fetch] {name}: {repo} -> {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
