---
title: Nepo Mall FIRS Classifier
emoji: 🏬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---
<!-- deploy -->
# Nepo Mall FIRS — Inference Service

Serves the fine-tuned XLM-RoBERTa-large classifier used by the Nepo Mall
Facility Issue Reporting System. Returns a facility category and a priority
level for unstructured Taglish maintenance reports.

## Endpoints

- `GET /health` — status, model name, device, class count
- `POST /classify` — `{"text": "...", "user_category": null}`

## Setup

1. Create a **model repo** on Hugging Face and upload the contents of
   `serving/model/` (backbone/, head.pt, priority_head.pt, issue_head.pt,
   tokenizer.json, meta.json, label_map.json, priority_map.json).
2. Create this Space with **SDK: Docker**.
3. In Space **Settings → Variables**, add build argument `MODEL_REPO`
   set to your model repo id, e.g. `your-username/firs-xlmr-large`.
4. Push `Dockerfile`, `README.md`, and the three Python files from
   `serving/` (`serve.py`, `checkpoint.py`, `roberta_model.py`).

## Note on sleeping

Free Spaces sleep after 48 hours idle and take ~40 s to wake. The web client
gives up after 8 s, so the first report after a sleep falls back to keyword
scoring. Ping `/health` before a demo to wake it.
