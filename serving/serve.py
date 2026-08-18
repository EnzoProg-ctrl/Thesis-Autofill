"""
serve.py
========
HTTP inference service for the Nepo Mall FIRS category classifier.

Why this exists
---------------
The web app calls its classifier as a browser-side ES module
(``js/keyword-classifier.js``). The trained model is a 2.2 GB XLM-RoBERTa-large
checkpoint and cannot run client-side, so the browser has to call a service
that holds the model warm instead.

Run it
------
    pip install fastapi uvicorn
    python serve.py                       # http://127.0.0.1:8000

    curl -X POST http://127.0.0.1:8000/classify \\
         -H "Content-Type: application/json" \\
         -d '{"text": "May tumutulo sa kisame namin, basa na ang sahig"}'

Contract
--------
POST /classify  {"text": str, "user_category": str|null}
    -> {"category": "<system category id>",
        "category_label": "<model label>",
        "confidence": int (0-100),
        "margin": int (0-100),
        "all_probabilities": {system_id: int},
        "priority": {...} | null,
        "safety_override": {"applied": bool, "matched_terms": [str],
                            "floor": "high", ...},
        "model": str,
        "elapsed_ms": int}

GET /health -> {"status": "ok", "model": ..., "device": ..., "num_labels": ...}

Notes
-----
* Confidence is a **temperature-scaled** probability, with the category and
  priority heads scaled separately — see CATEGORY_TEMPERATURE below. Raw
  softmax from this model is overconfident, and thresholds set on uncalibrated
  scores would auto-approve wrong answers. Both values are currently STALE
  (fitted against the 8-class model); refit with calibrate_checkpoint.py.
* Priority is returned only when the checkpoint carries a priority head. On a
  category-only checkpoint it is null and the web app falls back to its keyword
  scorer, rather than receiving a fabricated priority from here.
* A deterministic keyword floor (see below) can raise a priority the model
  scored too low. It never lowers one.
* Language is still the client's job — the model was never trained for it.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from checkpoint import load_checkpoint, load_priority_map

# Overridable so a new checkpoint can be served without editing this file.
#   FIRS_MODEL_DIR=models/c6s42 python serve.py
MODEL_DIR = Path(os.environ.get("FIRS_MODEL_DIR", "model"))

# Separate temperatures per head. The category and priority heads have
# different class counts and different degrees of overconfidence, and a single
# shared scalar assumed they were miscalibrated identically — they are not.
#
# Refit with `python calibrate_checkpoint.py <ckpt>` after ANY retrain and
# paste the values here. A stale temperature is worse than none: it never
# changes which class wins, so nothing looks broken, but it corrupts the
# confidence number that HITL thresholds key on.
#
# Fitted 2026-08-13 against models/f7 on the VALIDATION split:
#
#   CATEGORY  ECE 0.0262 -> 0.0190   T = 1.204
#   PRIORITY  ECE 0.1574 -> 0.0251   T = 2.481
#
# The two differ by 1.28, which retires the old shared 2.002 for good: it was
# over-smoothing category (true T 1.204, so confidence read LOWER than earned)
# and under-smoothing priority (true T 2.481, so confidence read HIGHER than
# earned). Wrong in both directions at once, and invisible either way, since
# temperature never changes which class wins.
#
# The priority head was badly miscalibrated raw — ECE 0.157 means its stated
# confidence was off by ~16 points on average. Any threshold set on the
# uncalibrated number would have been meaningless.
CATEGORY_TEMPERATURE = 1.204
PRIORITY_TEMPERATURE = 2.481

# The model's own class names -> the category ids used by the web app
# (js/app-data.js CATEGORIES). Only "hvac" differs in spelling.
#
# The app's CATEGORIES and this mapping now line up exactly, 7 for 7. The app
# previously carried an extra "elevator" ("Escalator") category that this model
# could never produce — lift/escalator complaints were trained as "Other" — and
# it was removed from the app on 2026-08-17 rather than left as a choice the
# classifier could not return.
#
# "Security" was removed from the taxonomy on 2026-08-13. A checkpoint trained
# before that date still emits it and will fail the startup check below — that
# is deliberate. Serving an 8-class model against a 7-class mapping would route
# real reports to a category the app no longer has.
LABEL_TO_SYSTEM_ID = {
    "Air Conditioning": "hvac",
    "Electrical": "electrical",
    "Fire Safety": "fire_safety",
    "Housekeeping": "housekeeping",
    "Other": "other",
    "Plumbing": "plumbing",
    "Structural": "structural",
}

# The web app stores ai_priority_score as an INTEGER 0-100 and derives its
# badge from bands (>=80 critical, >=60 high, >=40 medium, else low). The model
# predicts one of four classes, so these are the band centres used to turn a
# probability distribution back into a score the existing UI understands.
PRIORITY_BAND_CENTRE = {"Low": 25, "Medium": 50, "High": 70, "Critical": 90}
PRIORITY_TO_SYSTEM_ID = {"Low": "low", "Medium": "medium",
                         "High": "high", "Critical": "critical"}
PRIORITY_RANK = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}

# ──────────────────────────────────────────────
#  Deterministic keyword safety floor
# ──────────────────────────────────────────────
#
# Priority accuracy is 0.7848. Most of the remaining error is harmless — a
# Medium called Low — but 0.34% of reports are SEVERE underestimates, and a
# fire or an electrocution routed as Low is the one failure mode with a body
# attached to it. The floor removes that class of error for the words that
# name it, without touching the model.
#
# Contract: matching text can never be routed below High. The model may
# escalate above the floor (Critical stays Critical) and is never pulled down.
# The floor is not a classifier and does not try to be — it is a backstop with
# a deliberate bias: a false High costs a wasted call-out, a false Low can cost
# someone their life. It therefore does NOT parse negation. "wala pang usok"
# ("no smoke yet") will trip it, and that is the correct trade.
#
# MIRRORED IN js/bert-api.js — the two lists must stay identical. Run
# test_safety_floor.py, which parses both files and fails if they drift.

SAFETY_FLOOR_LABEL = "High"
# The bottom of the app's High band (js/keyword-classifier.js scorePriority:
# >=80 critical, >=60 high, >=40 medium). The floor lifts to exactly this, not to
# the band centre of 70 — the claim being made is "at least High", and 70
# would assert a confidence the floor has not earned.
SAFETY_FLOOR_SCORE = 60

# Tagalog infixes and reduplicates around the stem — "usok" becomes "umuusok",
# "sunog" becomes "nasusunog" — so a word-boundary match would miss exactly the
# phrasings tenants actually write. These are matched as SUBSTRINGS.
_DANGER_SUBSTRINGS = (
    "sunog",       # sunog, nasusunog, nasunog, sinusunog, AMOY SUNOG
    "usok",        # usok, umuusok, mausok, inuusukan
    "apoy",        # apoy, umaapoy, nag-aapoy — added 2026-08-13, see below
    "nakuryente",  # nakuryente, na-kuryente, nakuryenteng
    "nakoryente",  # the same word as spelled by half the corpus
    "naipit",      # naipit, na-ipit
    "naiipit",     # naiipit, nai-ipit — not a substring of "naipit"
)

# "apoy" (flame) was added after the 7-class evaluation surfaced the only
# genuine severe underestimate in the test set:
#
#   "May apoy na maliit na lumalabas pag sinasaksak namin ung kettle"
#   ("a small flame comes out when we plug in our kettle")  true High, predicted Low
#
# It is the Tagalog noun and carries none of the ambiguity that kept English
# "fire" out of this list — there is no apoy equivalent of "fire exit" or
# "fire drill". Verified across the corpus before adding: 46 rows contain it,
# all Electrical, 43 Critical and 3 High, none Low or Medium, and the only word
# containing the substring is "apoy" itself.

# NOTE: bare "kuryente" is deliberately absent. It just means "electricity",
# and "walang kuryente" (no power) is an ordinary Medium report. Only the
# na- form, which means a person was shocked, is a danger word. "fire" is
# absent for the same reason: "fire exit", "fire drill" and "fire
# extinguisher" are routine Fire Safety vocabulary, and the corpus is full of
# non-urgent reports containing them.

# English terms, matched at word boundaries. "\bspark\b" will not fire on
# "sparkling", which substring matching would.
_DANGER_WORDS = (
    ("trapped", r"trapped"),
    ("smoke", r"smok(?:e|es|ing|y)"),
    ("sparks", r"spark(?:s|ed|ing)?"),
)
_DANGER_WORD_RES = tuple(
    (name, re.compile(rf"\b{pattern}\b")) for name, pattern in _DANGER_WORDS
)

# Device names, not events. "Please test our smoke detector" is a scheduled
# Fire Safety chore, not a fire, and flooring it to High would push routine
# compliance work into the emergency queue and train staff to ignore the flag.
# These are blanked out BEFORE matching, so "the smoke detector is going off
# and the corridor is full of smoke" still trips on the second "smoke".
_NOT_DANGER_RE = re.compile(
    r"\bsmoke[\s-]?(?:detector|detectors|alarm|alarms|sensor|sensors)\b"
    r"|\bno[\s-]smoking\b"
    r"|\bsmoking[\s-]area\b"
    r"|\bsmoke[\s-]free\b"
)


def safety_floor_terms(text: str) -> list[str]:
    """Danger terms present in `text`, in a stable order. Empty if none."""
    haystack = _NOT_DANGER_RE.sub(" ", text.lower())
    # Taglish writes the same word with and without a hyphen ("na-kuryente").
    # Only the substring pass gets the de-hyphenated form: stripping hyphens
    # would DESTROY a word-boundary match, turning "nag-spark" into "nagspark".
    dehyphenated = haystack.replace("-", "")

    hits = [t for t in _DANGER_SUBSTRINGS if t in haystack or t in dehyphenated]
    hits += [name for name, rx in _DANGER_WORD_RES if rx.search(haystack)]
    return hits


def apply_safety_floor(text: str, priority: dict | None) -> dict:
    """Raise `priority` to at least High when a danger term is present.

    Mutates `priority` in place and returns an audit record. The record is
    returned even when nothing matched, and even when the checkpoint has no
    priority head — a category-only server still tells the client which terms
    fired so the client can floor its own keyword score.
    """
    terms = safety_floor_terms(text)
    record: dict = {
        "applied": False,
        "matched_terms": terms,
        "floor": PRIORITY_TO_SYSTEM_ID[SAFETY_FLOOR_LABEL],
    }
    if not terms or priority is None:
        return record

    # Label and score are floored independently. The score is a probability-
    # weighted mean, so a report whose argmax is High can still score 55 when
    # the distribution has a long tail into Low — and the app badges from the
    # SCORE. Checking only the label would leave that report showing Medium.
    label = priority["priority_label"]
    floored_label = (label if PRIORITY_RANK[label] >= PRIORITY_RANK[SAFETY_FLOOR_LABEL]
                     else SAFETY_FLOOR_LABEL)
    floored_score = max(priority["priority_score"], SAFETY_FLOOR_SCORE)

    if floored_label == label and floored_score == priority["priority_score"]:
        return record  # model was already at or above the floor

    record.update(
        applied=True,
        model_priority_label=label,
        model_priority_level=priority["priority_level"],
        model_priority_score=priority["priority_score"],
    )
    priority["priority_label"] = floored_label
    priority["priority_level"] = PRIORITY_TO_SYSTEM_ID[floored_label]
    priority["priority_score"] = floored_score
    # priority_probabilities is left untouched. It is what the model actually
    # believed; rewriting it to agree with the floor would erase the evidence
    # that the two disagreed, which is the one thing a reviewer needs to see.
    return record


app = FastAPI(title="FIRS Category Classifier", version="1.1")

# Restricted to the deployed front end plus the local dev servers.
#
# This was allow_origins=["*"] during development. A public Space endpoint is
# reachable by anyone, and while CORS does not stop a direct (non-browser)
# request, it does stop another website from making a visitor's browser call
# this service under that visitor's identity.
#
# Vercel preview deployments get their own subdomain per branch, so the regex
# admits *.vercel.app; tighten it to the exact production host if previews are
# not needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://thesis-autofill.vercel.app",   # production
        "http://localhost:5500",                # Live Server
        "http://127.0.0.1:5500",
    ],
    allow_origin_regex=r"https://thesis-autofill-.*\.vercel\.app",
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

_state: dict = {}


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    user_category: str | None = None


@app.on_event("startup")
def load_model() -> None:
    """Load the checkpoint once. A per-request load would cost ~20 s each."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, tokenizer, label_map = load_checkpoint(MODEL_DIR, device)
    meta = json.loads((MODEL_DIR / "meta.json").read_text(encoding="utf-8"))

    missing = set(label_map.values()) - set(LABEL_TO_SYSTEM_ID)
    if missing:
        raise RuntimeError(
            f"Model emits labels with no system id mapping: {sorted(missing)}. "
            f"Add them to LABEL_TO_SYSTEM_ID before serving."
        )

    # Priority head is optional: a category-only checkpoint still serves, and
    # the web app keeps using its keyword priority. That keeps the service
    # working across both model generations rather than hard-failing on the
    # older one.
    priority_map = load_priority_map(MODEL_DIR) if meta.get("multitask") else None
    if priority_map:
        unmapped = set(priority_map.values()) - set(PRIORITY_BAND_CENTRE)
        if unmapped:
            raise RuntimeError(f"Priority labels with no band centre: {sorted(unmapped)}")

    _state.update(model=model, tokenizer=tokenizer, label_map=label_map,
                  device=device, max_length=meta["max_length"],
                  model_name=meta["model_name"], priority_map=priority_map)
    print(f"[serve] loaded {meta['model_name']} on {device} "
          f"({len(label_map)} classes, temps cat={CATEGORY_TEMPERATURE}/pri={PRIORITY_TEMPERATURE}, "
          f"priority={'yes' if priority_map else 'NO — app will use keyword fallback'})")


@app.get("/health")
def health() -> dict:
    if not _state:
        return {"status": "loading"}
    return {
        "status": "ok",
        "model": _state["model_name"],
        "device": str(_state["device"]),
        "num_labels": len(_state["label_map"]),
        "category_temperature": CATEGORY_TEMPERATURE,
        "priority_temperature": PRIORITY_TEMPERATURE,
    }


@app.post("/classify")
def classify(req: ClassifyRequest) -> dict:
    started = time.perf_counter()
    model, tok = _state["model"], _state["tokenizer"]
    label_map, device = _state["label_map"], _state["device"]

    enc = tok(req.text, truncation=True, max_length=_state["max_length"],
              return_tensors="pt").to(device)

    with torch.no_grad():
        out = model(input_ids=enc["input_ids"], attention_mask=enc["attention_mask"])
        # Temperature scaling before softmax — see module docstring.
        probs = torch.softmax(out.logits.float() / CATEGORY_TEMPERATURE, dim=1)[0].cpu()

    ranked = torch.argsort(probs, descending=True)
    top, second = int(ranked[0]), int(ranked[1])
    label = label_map[top]

    priority: dict | None = None
    pmap = _state.get("priority_map")
    if pmap is not None and out.priority_logits is not None:
        pprobs = torch.softmax(out.priority_logits.float() / PRIORITY_TEMPERATURE, dim=1)[0].cpu()
        pidx = int(pprobs.argmax())
        plabel = pmap[pidx]
        # Score is the probability-weighted mean of the band centres, not just
        # the winning class's centre. A report split evenly between High and
        # Critical lands around 80 rather than snapping to one or the other,
        # which is a more faithful severity estimate for the 0-100 field.
        score = sum(float(pprobs[i]) * PRIORITY_BAND_CENTRE[pmap[i]] for i in pmap)
        priority = {
            "priority_level": PRIORITY_TO_SYSTEM_ID[plabel],
            "priority_label": plabel,
            "priority_score": int(round(score)),
            "priority_confidence": int(round(float(pprobs[pidx]) * 100)),
            "priority_probabilities": {
                PRIORITY_TO_SYSTEM_ID[pmap[i]]: int(round(float(pprobs[i]) * 100))
                for i in pmap
            },
        }

    # Applied last, so it overrides the model rather than being averaged with
    # it. Runs even when `priority` is None, so a category-only checkpoint
    # still reports which terms fired for the client to act on.
    safety_override = apply_safety_floor(req.text, priority)

    return {
        "category": LABEL_TO_SYSTEM_ID[label],
        "category_label": label,
        "confidence": int(round(float(probs[top]) * 100)),
        # Gap to the runner-up. A wide gap means a clean decision; a narrow one
        # means the model was torn, which is worth routing to a human even when
        # the top confidence looks acceptable.
        "margin": int(round(float(probs[top] - probs[second]) * 100)),
        "all_probabilities": {
            LABEL_TO_SYSTEM_ID[label_map[i]]: int(round(float(probs[i]) * 100))
            for i in range(len(label_map))
        },
        "model": _state["model_name"],
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
        # None when serving a category-only checkpoint; the client then falls
        # back to its keyword priority rather than receiving a fabricated one.
        "priority": priority,
        # Always present. "applied" says whether the floor actually moved the
        # answer; "matched_terms" is populated whenever danger words are found,
        # even if the model had already reached High on its own.
        "safety_override": safety_override,
    }


if __name__ == "__main__":
    import uvicorn
    # 127.0.0.1 accepts only connections from this machine. Set
    # FIRS_HOST=0.0.0.0 to let other devices on the network reach it —
    # required if teammates or tenants are testing from their own
    # phones or laptops rather than from this one.
    uvicorn.run(app, host=os.environ.get("FIRS_HOST", "127.0.0.1"),
                port=int(os.environ.get("FIRS_PORT", "8000")))
