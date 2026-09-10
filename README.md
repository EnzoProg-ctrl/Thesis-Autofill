# Nepo Mall — Facility Issue Reporting System

A web application that lets mall tenants report maintenance problems in their own
words, then classifies each report by **facility category** and **urgency** using a
fine-tuned XLM-RoBERTa model. Every classification is reviewed by a person before
the report is dispatched.

Reports arrive in colloquial **Taglish** — Tagalog and English mixed inside a single
sentence. Keyword systems treat that as noise and translating it first strips out the
urgency the tenant was expressing, so the model reads both languages natively.

Undergraduate thesis, BS Computer Science, Holy Angel University.

---

## What it does

A tenant types what is wrong. The model answers two questions:

| Question | Answers |
|---|---|
| What kind of problem? | Electrical · Plumbing · Air Conditioning · Structural · Fire Safety · Housekeeping · Other |
| How urgent? | Low · Medium · High · Critical |

An administrator confirms or corrects every answer before the report reaches the
maintenance team. When they correct it, the model's original answer is kept alongside
the correction, so disagreement between the two stays measurable.

---

## Architecture

```
Browser (static HTML/CSS/ES modules)
   │
   ├── Supabase ──── PostgreSQL + Auth + row-level security
   │
   └── HTTP ─────── FastAPI inference service (Docker, CPU)
                       └── XLM-RoBERTa-large, 3 heads, ~250 ms/report
```

No front-end framework. The pages load native ES modules directly.

The model runs as a separate containerised service, so the web app stays up and
usable even when inference is unavailable — a keyword scorer takes over and the
response records which mechanism produced the classification.

---

## The model

Fine-tuned from `xlm-roberta-large`, pre-trained on 100 languages including Tagalog
and English. One shared encoder with three output heads: category (7), priority (4),
and an auxiliary issue-type head (149) used during training only.

**Priority uses an ordinal loss.** The four levels are ordered, so being three levels
wrong is worse than being one level wrong, and under-prediction is penalised twice as
heavily as over-prediction — under-rating a hazard costs more than over-rating a minor
request.

Results on 1,788 held-out reports, averaged across three initialisation seeds:

| Measure | Model | TF-IDF + LinearSVC baseline |
|---|---:|---:|
| Category macro-F1 | 0.9325 ± 0.0103 | — |
| Priority accuracy | 0.8883 ± 0.0135 | 0.6728 |
| Within one priority level | 0.9972 | 0.9239 |
| Quadratic weighted kappa | 0.9553 | 0.7441 |
| Critical routed below High | 0 | 34 of 290 |
| Over- to under-prediction ratio | 6.6 : 1 | 0.98 : 1 |

The error *direction* matters more here than the accuracy gap. The baseline shows no
directional preference and mis-routed 34 genuine emergencies as low priority. The
fine-tuned model errs toward greater severity and mis-routed none.

Training and evaluation code lives in a separate repository.

---

## Safety floor

A deterministic rule runs **after** the model, independently of it. If the report
contains explicit danger terminology — `sunog`, `usok`, `apoy`, `nakuryente`,
`naipit`, `trapped`, `smoke`, `sparks` — the priority is raised to at least **High**.

It can only escalate, never lower. Device names are blanked before matching, so
"please test our smoke detector" does not trigger it. When it fires, the model's
original prediction is preserved so a reviewer can see that a rule, not the model,
set the priority.

The model is accurate but no model is certain on any single report. This rule is a
guarantee the model cannot provide on its own.

---

## Repository layout

| Path | Contents |
|---|---|
| `index.html`, `register.html`, `reset-password.html` | Authentication pages |
| `tenant/` | Tenant reporting interface |
| `admin/` | Dashboard, HITL review queue, analytics, work queue |
| `js/` | ES modules — data access, classification client, dashboards |
| `css/` | Design system and per-area stylesheets |
| `supabase/` | Schema, RLS policies, functions, migrations |
| `serving/` | FastAPI inference service and model loader |
| `deploy/hf-space/` | Dockerfile for the hosted inference container |

Key modules:

- `js/bert-api.js` — calls the inference service, falls back to the keyword scorer
- `js/keyword-classifier.js` — the fallback, used only when inference is unreachable
- `js/hitl.js` — review queue; preserves the pre-override prediction
- `js/shared.js` — data access and shared UI
- `serving/serve.py` — inference endpoint, temperature scaling, safety floor

---

## Running it locally

**1. Database.** Create a Supabase project and apply, in order:

```
supabase/schema.sql
supabase/functions_and_triggers.sql
supabase/rls_policies.sql
supabase/migration_002_ai_provenance.sql
supabase/migration_003_lock_role.sql
supabase/migration_004_tenant_issue_guard.sql
supabase/migration_005_tenant_text_edits.sql
supabase/migration_006_resolved_at.sql
supabase/migration_007_tenant_signup_trigger.sql
```

Then enable **Authentication → Sign In / Providers → Email → Confirm email**, and set
**URL Configuration → Site URL** to wherever you serve the app.

**2. Inference service.**

```bash
cd serving && python get_model.py && pip install -r requirements.txt && python serve.py
```

`get_model.py` fetches the checkpoint, which is too large for git and ships as a
release asset instead.

**3. Web app.** Serve the repository root over HTTP:

```bash
python -m http.server 5500
```

Open `http://localhost:5500`. It must be `http://`, not `file://` — opening the pages
directly from disk fails CORS and silently falls back to the keyword scorer.

---

## Limitations

**The model was trained on generated data.** The corpus was built from a taxonomy of
149 issue types rather than collected from real reports. The accuracy figures describe
generalisation to unseen phrasings of known problems, not to arbitrary real complaints.

**Real reports are shorter than the training data.** During deployment, submissions
averaged about six words — enough to identify the fault, rarely enough to convey
urgency. The model reads severity from descriptive language, so where that language is
absent it assigns a lower priority than a reviewer would. This is the main reason the
review step exists.

**The reported deployment figures come from 96 reports across 38 tenants.** Enough to
observe behaviour, not enough for strong statistical claims.

**The Tagalog in the training corpus has not been reviewed by a native speaker.**

---

## Licence and status

Academic project. Not licensed for production use.
