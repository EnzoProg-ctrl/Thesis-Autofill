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
import threading
import time
import urllib.request
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
# The terms are managed by admins (admin/terms.html) and stored in the
# Supabase table public.safety_terms (migration_008). This service reads them
# through get_safety_terms() at startup and every SAFETY_TERMS_REFRESH_S after,
# and keeps _BUILTIN_SAFETY_TERMS in force whenever the table cannot be read.
#
# MIRRORED IN js/safety-floor.js — same built-in rows, same matching rules.

SAFETY_FLOOR_LABEL = "High"
# The bottom of the app's High band (js/keyword-classifier.js scorePriority:
# >=80 critical, >=60 high, >=40 medium). The floor lifts to exactly this, not to
# the band centre of 70 — the claim being made is "at least High", and 70
# would assert a confidence the floor has not earned.
SAFETY_FLOOR_SCORE = 60

# One row per matched string, in the shape get_safety_terms() returns:
#   (kind, match_type, term, label, sort_order)
#
# Tagalog stems are SUBSTRINGS — infixes and reduplication wrap the root, so
# "usok" must also match "umuusok". English terms are WHOLE WORDS, so "spark"
# does not fire on "sparkling"; their inflections are separate rows sharing a
# label. Exclusions are device names and signage, blanked BEFORE matching, so
# "the smoke detector is going off and the hall is full of smoke" still trips
# on the second "smoke".
#
# "apoy" was added 2026-08-13 after the only genuine severe underestimate in
# the test set ("May apoy na maliit na lumalabas pag sinasaksak namin ung
# kettle", true High, predicted Low); 46 corpus rows contain it, none Low or
# Medium. Bare "kuryente" (electricity) and English "fire" (fire exit, fire
# drill) are deliberately absent.
_BUILTIN_SAFETY_TERMS = (
    ("danger", "substring", "sunog", "sunog", 10),
    ("danger", "substring", "usok", "usok", 20),
    ("danger", "substring", "apoy", "apoy", 30),
    ("danger", "substring", "nakuryente", "nakuryente", 40),
    ("danger", "substring", "nakoryente", "nakoryente", 50),
    ("danger", "substring", "naipit", "naipit", 60),
    ("danger", "substring", "naiipit", "naiipit", 70),
    ("danger", "word", "trapped", "trapped", 110),
    ("danger", "word", "smoke", "smoke", 120),
    ("danger", "word", "smokes", "smoke", 121),
    ("danger", "word", "smoking", "smoke", 122),
    ("danger", "word", "smoky", "smoke", 123),
    ("danger", "word", "spark", "sparks", 130),
    ("danger", "word", "sparks", "sparks", 131),
    ("danger", "word", "sparked", "sparks", 132),
    ("danger", "word", "sparking", "sparks", 133),
    ("exclusion", "phrase", "smoke detector", "smoke detector", 210),
    ("exclusion", "phrase", "smoke detectors", "smoke detector", 211),
    ("exclusion", "phrase", "smoke alarm", "smoke alarm", 220),
    ("exclusion", "phrase", "smoke alarms", "smoke alarm", 221),
    ("exclusion", "phrase", "smoke sensor", "smoke sensor", 230),
    ("exclusion", "phrase", "smoke sensors", "smoke sensor", 231),
    ("exclusion", "phrase", "no smoking", "no smoking", 240),
    ("exclusion", "phrase", "smoking area", "smoking area", 250),
    ("exclusion", "phrase", "smoke free", "smoke free", 260),
)

# Explicit lookarounds rather than \b, over the same character class
# js/safety-floor.js uses — JavaScript's \b is ASCII-only and Python's is
# Unicode-aware, so \b would let the two disagree on text containing ñ.
_WORD_CHAR = "a-z0-9_ñ"
_BEFORE = rf"(?<![{_WORD_CHAR}])"
_AFTER = rf"(?![{_WORD_CHAR}])"


def _term_order(row) -> tuple:
    return (row[4] if row[4] is not None else 500, row[2])


def _compile_terms(rows) -> dict | None:
    """Build a matcher from term rows. None when there is no danger term, so
    the caller keeps its current list rather than switching the floor off."""
    clean = [r for r in rows if r[2] and r[3]]
    danger = sorted((r for r in clean if r[0] == "danger"), key=_term_order)
    if not danger:
        return None

    def group(match_type: str) -> list[tuple[str, list[str]]]:
        groups: dict[str, list[str]] = {}
        for _, mt, term, label, _ in danger:
            if mt == match_type:
                groups.setdefault(label, []).append(term.lower())
        return list(groups.items())

    words = [(label, re.compile(_BEFORE + "(?:" + "|".join(map(re.escape, terms)) + ")" + _AFTER))
             for label, terms in group("word")]
    exclusions = sorted((r for r in clean if r[0] == "exclusion" and r[1] == "phrase"), key=_term_order)
    phrases = [r"[\s-]?".join(map(re.escape, re.split(r"[ -]+", r[2].lower()))) for r in exclusions]
    return {
        "substrings": group("substring"),
        "words": words,
        "exclusion": re.compile(_BEFORE + "(?:" + "|".join(phrases) + ")" + _AFTER) if phrases else None,
        "danger_count": len(danger),
        "exclusion_count": len(phrases),
    }


_BUILTIN_COMPILED = _compile_terms(_BUILTIN_SAFETY_TERMS)

# Replaced as one reference, so a request never sees half a list.
_safety_terms: dict = {"compiled": _BUILTIN_COMPILED, "source": "builtin",
                       "loaded_at": None, "error": None}

# The same public project URL and anon key the web app already ships to every
# browser (js/supabase-client.js). The anon key grants nothing beyond what RLS
# allows, and get_safety_terms() is the only thing this service calls with it.
SUPABASE_URL = os.environ.get("FIRS_SUPABASE_URL", "https://ljlxyfznsobfgalablqe.supabase.co")
SUPABASE_ANON_KEY = os.environ.get(
    "FIRS_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqbHh5Znpuc29iZmdhbGFibHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwODUxMTIsImV4cCI6MjA5ODY2MTExMn0.9arQevnafCN4rSk1zIM8KyZM1_Ye6_sdStlmAYUtLa0",
)
SAFETY_TERMS_REFRESH_S = int(os.environ.get("FIRS_SAFETY_TERMS_REFRESH_S", "300"))


def refresh_safety_terms() -> str:
    """Fetch the admin-managed list. Never raises: on any failure, or if the
    table returns no danger term, the list already in force stays."""
    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/rpc/get_safety_terms",
            data=b"{}", method="POST",
            headers={"apikey": SUPABASE_ANON_KEY,
                     "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode("utf-8"))
        rows = [(d.get("kind"), d.get("match_type"), d.get("term"), d.get("label"), d.get("sort_order"))
                for d in data]
        compiled = _compile_terms(rows)
        if compiled is None:
            raise ValueError("no active danger terms returned")
        _safety_terms.update(compiled=compiled, source="database", error=None,
                             loaded_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    except Exception as exc:  # noqa: BLE001 — any failure keeps the current list
        _safety_terms["error"] = f"{type(exc).__name__}: {exc}"
        print(f"[serve] safety terms not refreshed, keeping {_safety_terms['source']} list: {exc}")
    return _safety_terms["source"]


def _refresh_safety_terms_forever() -> None:
    while True:
        time.sleep(SAFETY_TERMS_REFRESH_S)
        refresh_safety_terms()


def safety_floor_terms(text: str) -> list[str]:
    """Danger terms present in `text`, in a stable order. Empty if none."""
    compiled = _safety_terms["compiled"]
    haystack = text.lower()
    if compiled["exclusion"] is not None:
        haystack = compiled["exclusion"].sub(" ", haystack)
    # Taglish writes the same word with and without a hyphen ("na-kuryente").
    # Only the substring pass gets the de-hyphenated form: stripping hyphens
    # would DESTROY a whole-word match, turning "nag-spark" into "nagspark".
    dehyphenated = haystack.replace("-", "")

    hits = [label for label, terms in compiled["substrings"]
            if any(t in haystack or t in dehyphenated for t in terms)]
    hits += [label for label, rx in compiled["words"]
             if label not in hits and rx.search(haystack)]
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
    # Terms first and briefly: a failed fetch leaves the built-in list, and the
    # background thread keeps retrying, so the model load is never held up.
    refresh_safety_terms()
    threading.Thread(target=_refresh_safety_terms_forever, daemon=True).start()
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
        "safety_terms": {
            "source": _safety_terms["source"],          # "database" | "builtin"
            "danger_terms": _safety_terms["compiled"]["danger_count"],
            "exclusion_phrases": _safety_terms["compiled"]["exclusion_count"],
            "loaded_at": _safety_terms["loaded_at"],
            "last_error": _safety_terms["error"],
        },
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
