# FIRS Inference Service

Serves the trained classifier that the tenant form calls. Category, priority,
and a deterministic keyword safety floor.

Without this running the app still works — `js/bert-api.js` falls back to the
keyword scorer in `js/keyword-classifier.js`. **It does not announce that it
has done so.** The fallback is much weaker on Taglish (it rated *"May naipit na tao sa
pinto"* — a person trapped in a door — at 38/low), so a system that looks
healthy while running it is the main risk this README exists to prevent.

---

## Setup

**1. Install torch** (separately, because the right build depends on your machine):

```bash
# CPU is fine — a report takes ~250 ms
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

**2. Install the rest:**

```bash
pip install -r serving/requirements.txt
```

**3. Fetch the model** (~1.1 GB, once).

It is not in the repository because its largest file is 1068 MB and GitHub
rejects anything over 100 MB in git. It ships as a Release asset instead.

**This repository is private**, so an unauthenticated download returns 404 even
though you can see the release fine in your browser. Pick either:

*Option A — browser (simplest, no token):*

1. Open <https://github.com/EnzoProg-ctrl/Thesis-Autofill/releases/tag/model-v1>
2. Download `firs-model-f7-fp16.zip` and save it into `serving/`
3. Run `python serving/get_model.py` — it finds the local file, verifies the
   checksum and extracts it without downloading anything

*Option B — token (one command):*

```bash
GITHUB_TOKEN=ghp_xxx python serving/get_model.py
```

Create a token at <https://github.com/settings/tokens> with `repo` scope
(classic) or read access to this repository (fine-grained).

Either way the checksum is verified. A truncated checkpoint does **not** crash
on load — it produces confident nonsense — so don't skip the script and extract
the zip by hand.

**4. Run:**

```bash
cd serving
python serve.py
```

```bash
curl http://127.0.0.1:8000/health
```

Expect `"num_labels": 7`.

---

## Pointing the web app at it

Same machine — nothing to configure; the default is `http://127.0.0.1:8000`.

**Serve the app over HTTP, not `file://`.** Opening the HTML directly makes
every request fail CORS, and the app falls back silently:

```bash
python -m http.server 5500 -d .
```

Then use `http://localhost:5500/tenant/`.

For teammates on other devices, run the service with:

```bash
FIRS_HOST=0.0.0.0 python serve.py
```

and have them set, before the module loads:

```html
<script>window.FIRS_API_BASE = 'http://192.168.1.50:8000';</script>
```

---

## Confirming the model is actually being used

This is the check that matters. After submitting a report, look at the row:

```
ai_priority_source = model        the classifier ran
ai_priority_source = keyword      the service was unreachable — fallback ran
ai_priority_source = safety_floor keywords overrode a lower model prediction
```

Requires `supabase/migration_002_ai_provenance.sql` to have been applied.

---

## What it returns

`POST /classify {"text": "..."}`

```json
{
  "category": "electrical", "confidence": 98, "margin": 95,
  "priority": {"priority_level": "critical", "priority_score": 87,
               "priority_confidence": 90},
  "safety_override": {"applied": false, "matched_terms": ["usok", "apoy"],
                      "floor": "high"}
}
```

`matched_terms` is populated whenever danger words are present.
`applied` is true only when the floor actually **raised** the priority — if
the model already reached High or above, there was nothing to lift.

---

## Model

`xlm-roberta-large`, 7 categories, multi-task with a priority head.

| | |
|---|---|
| Category macro-F1 | 0.9325 ± 0.010 |
| Priority accuracy | 0.8883 ± 0.014 |
| Severe underestimates | 1.0 ± 1.0 of 1788 |
| Critical routed below High | 0 |

Three seeds on identical hardware. Priority is genuinely below 0.90 — it was
measured against held-out severity phrasings the model never trained on, and
the honest figure is the one quoted.

The backbone is stored in **fp16** to halve the download. Verified lossless
across all 1788 test rows: 0 category and 1 priority prediction changed versus
fp32. `checkpoint.py` casts back to fp32 when serving on CPU, since CPUs are
slower at fp16 arithmetic.

Confidence is temperature-scaled — **1.204** for category, **2.481** for
priority, fitted separately on validation data. The priority head's raw
calibration error was 0.157, meaning uncalibrated confidence was off by ~16
points; any threshold set on it would have been meaningless. Refit with
`calibrate_checkpoint.py` in the research repo after any retrain.

---

## Safety floor

Reports containing **sunog, usok, apoy, nakuryente, naipit, trapped, smoke,
sparks** can never be routed below High. The model may escalate above the
floor; it can never pull one below it.

Tagalog stems match as substrings because the language infixes around them
(*usok* → *umuusok*); English matches at word boundaries so "sparkling" does
not trigger. Bare *kuryente* ("electricity") and English *fire* are
deliberately excluded — "walang kuryente" and "fire exit" are ordinary
reports. "smoke detector" is stripped before matching so scheduled compliance
work stays out of the emergency queue.

It does **not** parse negation: *"wala pang usok"* ("no smoke yet") trips it.
That is intentional. A false High costs a wasted call-out; a false Low can
cost someone their life.

The same list is mirrored in `js/bert-api.js` so the guarantee survives the
service being unreachable. `test_safety_floor.py` in the research repo runs
both implementations over the same cases and fails on any disagreement.
