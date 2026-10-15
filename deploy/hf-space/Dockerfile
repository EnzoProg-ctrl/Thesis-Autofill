# ============================================================
#  Hugging Face Space — FIRS inference service
#
#  Serves serving/serve.py (XLM-RoBERTa-large) over HTTPS so the Vercel front
#  end can reach it. HF Spaces expect the app on port 7860.
#
#  The 1.15 GB checkpoint is not in the Space repo. It is downloaded at build
#  time by get_model.py from the public `model-v1` release of the GitHub
#  repository, and its SHA-256 checksum is verified before it is unpacked.
#  No account, token or Space secret is needed, so any Hugging Face account
#  (or any Docker host) can build this image.
#
#  Upload to the Space: this Dockerfile, README.md, and serve.py,
#  checkpoint.py, roberta_model.py and get_model.py from serving/.
# ============================================================
FROM python:3.11-slim

# CPU-only torch. A report takes ~250 ms on CPU, so no GPU is needed, and the
# CPU wheel is roughly a third the size of the CUDA build.
RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
      "fastapi>=0.110" "uvicorn>=0.27" "pydantic>=2.0" \
      "transformers>=4.40"

WORKDIR /app

# Service code only — no model weights.
COPY serve.py checkpoint.py roberta_model.py get_model.py ./

# Download, verify and unpack the checkpoint into /app/model. get_model.py
# deletes the zip after unpacking, within this same layer, so the image holds
# the model once rather than twice.
RUN python get_model.py

# Fail the build loudly if the download did not produce a usable checkpoint,
# rather than starting a service that 500s on every request.
RUN test -f /app/model/meta.json \
 && test -f /app/model/head.pt \
 && test -f /app/model/priority_head.pt \
 && test -f /app/model/backbone/model.safetensors \
 && echo "checkpoint present" \
 || (echo "ERROR: model files missing after download" && exit 1)

# serve.py reads all three from the environment — no code change needed.
ENV FIRS_MODEL_DIR=/app/model \
    FIRS_HOST=0.0.0.0 \
    FIRS_PORT=7860

EXPOSE 7860

# Loading the checkpoint takes ~40 s. HF waits for the port to open, so this
# is fine; the Space shows as "Building" until then.
CMD ["python", "-u", "serve.py"]
