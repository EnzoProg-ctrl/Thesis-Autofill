# ============================================================
#  Hugging Face Space — FIRS inference service
#
#  Serves serving/serve.py (XLM-RoBERTa-large) over HTTPS so the Vercel front
#  end can reach it. HF Spaces expect the app on port 7860.
#
#  The 1.15 GB checkpoint is NOT baked into this image — it is pulled from a
#  PRIVATE Hugging Face model repo at build time. That keeps the Space repo
#  small and lets the model be replaced without touching this file.
#
#  REQUIRED SPACE SETTINGS
#  -----------------------
#    Settings > Variables and secrets:
#      MODEL_REPO  (variable)  e.g. Chompyy/firs-model
#      HF_TOKEN    (secret)    a READ token from
#                              huggingface.co/settings/tokens
#
#  HF_TOKEN must be a SECRET, not a variable — secrets are mounted at build
#  time and are not baked into the image layers, so the token does not travel
#  with the built image.
# ============================================================
FROM python:3.11-slim

# CPU-only torch. A report takes ~250 ms on CPU, so no GPU is needed, and the
# CPU wheel is roughly a third the size of the CUDA build.
RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
      "fastapi>=0.110" "uvicorn>=0.27" "pydantic>=2.0" \
      "transformers>=4.40" "huggingface_hub>=0.23"

WORKDIR /app

# Service code only — no model weights.
COPY serve.py checkpoint.py roberta_model.py ./

ARG MODEL_REPO
ENV MODEL_REPO=${MODEL_REPO}

# Pull the checkpoint into /app/model. The token is mounted only for this
# instruction, so it never becomes part of a stored image layer.
RUN --mount=type=secret,id=HF_TOKEN,mode=0444 \
    HF_TOKEN="$(cat /run/secrets/HF_TOKEN)" python -c "\
import os; from huggingface_hub import snapshot_download; \
snapshot_download(repo_id=os.environ['MODEL_REPO'], \
                  local_dir='/app/model', \
                  token=os.environ['HF_TOKEN'])"

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
