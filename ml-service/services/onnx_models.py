"""
Quantized (int8) ONNX models for sentiment and sentence embeddings.

Sessions are created lazily, once per process, with the CPU memory arena off and
one intra-op thread: it keeps resident memory small on a 512 MB instance.
Model files are downloaded at image build time by scripts/fetch_models.py.
"""

import os
import threading
from pathlib import Path

import numpy as np

SENTIMENT = "sentiment"
EMBEDDER = "embedder"
MAX_TOKENS = 256

_LOCK = threading.Lock()
_CACHE = {}


def model_dir() -> Path:
    """Where the ONNX models live: $ONNX_MODEL_DIR, else ml-service/models/onnx."""
    configured = os.getenv("ONNX_MODEL_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "models" / "onnx"


def available(name: str) -> bool:
    folder = model_dir() / name
    return (folder / "model_quantized.onnx").exists() and (folder / "tokenizer.json").exists()


def _load(name: str):
    with _LOCK:
        if name in _CACHE:
            return _CACHE[name]
        import onnxruntime as ort
        from tokenizers import Tokenizer

        folder = model_dir() / name
        tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        tokenizer.enable_truncation(MAX_TOKENS)
        tokenizer.enable_padding()

        options = ort.SessionOptions()
        options.enable_cpu_mem_arena = False
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(folder / "model_quantized.onnx"), options, providers=["CPUExecutionProvider"])
        _CACHE[name] = (session, tokenizer)
        return _CACHE[name]


def _run(name: str, texts: list[str]):
    session, tokenizer = _load(name)
    encoded = tokenizer.encode_batch(texts)
    ids = np.array([e.ids for e in encoded], dtype=np.int64)
    mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
    feeds = {"input_ids": ids, "attention_mask": mask}
    if "token_type_ids" in {i.name for i in session.get_inputs()}:
        feeds["token_type_ids"] = np.zeros_like(ids)
    return session.run(None, feeds)[0], mask


def positive_probability(texts: list[str]) -> np.ndarray:
    """P(positive) per text from the SST-2 sentiment model."""
    logits, _ = _run(SENTIMENT, texts)
    logits = logits - logits.max(axis=1, keepdims=True)
    probs = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)
    return probs[:, 1]


def embed(texts: list[str]) -> np.ndarray:
    """384-dim, L2-normalised mean-pooled sentence embeddings (all-MiniLM-L6-v2)."""
    hidden, mask = _run(EMBEDDER, texts)
    weights = mask[..., None].astype(np.float32)
    pooled = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
    return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
