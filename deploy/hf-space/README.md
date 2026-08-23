---
title: Nepo Mall FIRS Classifier
emoji: 🏬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---
<!--deploy-->
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

Free Spaces sleep after 48 hours idle and take ~40 s to wake. A Space that is
merely cold rather than asleep is much quicker: measured at 7694 ms on
2026-08-19, against ~1 s once warm.

The web client gives up after **15 s** (`TIMEOUT_MS` in `js/bert-api.js`) and
falls back to keyword scoring, which is markedly worse on Taglish and says so
nowhere in the UI — it was 8 s until the cold measurement above showed only
306 ms of margin. Keep these two numbers in step: raising one without the
other is how a report silently gets the wrong scorer.

Both tenant pages ping `/health` on load to start the wake early. Ping it
yourself before a demo anyway:

    curl https://chompyy-firs-classifier.hf.space/health

Confirm afterwards that the model actually ran — `ai_priority_source` should
read `model`, never `keyword`:

    SELECT ai_priority_source, count(*) FROM issues GROUP BY 1;
