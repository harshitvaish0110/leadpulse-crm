# ── Models: download the int8 ONNX models once, at build time ───────────────────
FROM python:3.11-slim AS models
RUN pip install --no-cache-dir huggingface-hub==0.33.0
COPY scripts/fetch_models.py /tmp/fetch_models.py
ENV ONNX_MODEL_DIR=/opt/models/onnx
RUN python /tmp/fetch_models.py

# ── Service ─────────────────────────────────────────────────────────────────────
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    ONNX_MODEL_DIR=/opt/models/onnx

WORKDIR /app
COPY requirements.txt .
# sympy (onnxruntime's offline tooling) and matplotlib (Prophet's optional
# plotting) are never imported at runtime; dropping them saves ~180 MB.
RUN pip install --no-cache-dir -r requirements.txt  && pip uninstall -y -q sympy mpmath matplotlib fonttools pillow kiwisolver contourpy cycler

# Models live outside /app, so a development bind mount of the source does not hide them.
COPY --from=models /opt/models /opt/models
COPY . .

RUN useradd --create-home --uid 10001 ml && chown -R ml /app
USER ml

EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=4).status == 200 else 1)"

CMD ["gunicorn", "app:create_app()", "--bind", "0.0.0.0:5001", "--workers", "1", "--threads", "4", "--timeout", "120"]
