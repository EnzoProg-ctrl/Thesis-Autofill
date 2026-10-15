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

Any free Hugging Face account can host this. No model repo, token or secret
is needed: the build downloads the trained model from the public
[`model-v1` release](https://github.com/EnzoProg-ctrl/Thesis-Autofill/releases/tag/model-v1)
and verifies its checksum.

1. On Hugging Face, **New Space**: any name, **SDK: Docker**, **Blank**
   template, hardware **CPU basic** (free).
2. In the Space's **Files** tab, upload this `Dockerfile` and `README.md`,
   and these four files from `serving/`: `serve.py`, `checkpoint.py`,
   `roberta_model.py` and `get_model.py`.
3. Optional: under **Settings → Variables and secrets**, add the variables
   `FIRS_SUPABASE_URL` and `FIRS_SUPABASE_ANON_KEY` to read the safety terms
   from your own Supabase project instead of the original one.
4. Wait for the build (about 5–10 minutes) until the Space shows **Running**,
   then open `https://<username>-<space-name>.hf.space/health`.
5. Point the website at it (`window.FIRS_API_BASE` in `tenant/index.html` and
   `tenant/home.html`), and if the website is not on one of the addresses in
   `allow_origins` in `serve.py`, add it there before uploading.

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
