# Nepo Mall — Facility Issue Reporting System (FIRS)
**AI-assisted facility issue reporting and triage for commercial tenants**

**Live system:** <https://thesis-autofill.vercel.app>

**Docker images:** [dexterctoribio/firs-web](https://hub.docker.com/r/dexterctoribio/firs-web) · [dexterctoribio/firs-classifier](https://hub.docker.com/r/dexterctoribio/firs-classifier)

**Set up your own copy:** [SETUP.md](SETUP.md), a step-by-step guide from a free Supabase account to a working system

Undergraduate thesis, BS Computer Science, Holy Angel University.

---

## Demo accounts

These accounts belong to a separate **demo database** filled with fictional stores,
staff and reports. Use them with the Docker images: [Run with Docker](#run-with-docker)
starts the whole system on your computer, already connected to the demo database.

| Role | Email | Password |
|---|---|---|
| Administrator | `demo.admin@example.com` | `firsdemo123` |
| Maintenance staff | `demo.staff@example.com` | `firsdemo123` |
| Store (tenant) | `demo.store@example.com` | `firsdemo123` |

> Please don't change these passwords, so the next person can still sign in. The demo
> database is reset from time to time, which removes anything visitors added.

The demo accounts do **not** work on the live system. Its database holds the reports
and contact details of the study's participating tenants, collected under a data
privacy consent, so it has no shared accounts.

> The live system's AI classifier is hosted on Hugging Face Spaces, which is currently
> offline. Until it is restored, reports on the live site are classified by the keyword
> fallback. The Docker images run the AI model on your own computer.

---

## About the project

Tenants of Nepo Mall in Angeles City used to report facility problems in person at the
administration office, where each one was written up on a paper form and ranked for
inspection by a supervisor's judgement. FIRS moves that first step online: a tenant
describes the problem in their own words from a phone or computer, and the system
suggests a **facility category** and an **urgency level** for the Property Management
Office to confirm.

Reports arrive in colloquial **Taglish**: Tagalog and English mixed inside a single
sentence. Keyword systems treat that as noise, and translating it first strips out the
urgency the tenant was expressing, so the classifier is a fine-tuned **XLM-RoBERTa**
model that reads both languages natively.

FIRS uses a **human-in-the-loop** design: the AI only suggests. An administrator
confirms or corrects every category and priority before the report reaches the
maintenance team, and the model's original answer is kept alongside any correction so
that disagreement between the two stays measurable.

| Question | Answers |
|---|---|
| What kind of problem? | Electrical · Plumbing · Air Conditioning · Structural · Fire Safety · Housekeeping · Other |
| How urgent? | Low · Medium · High · Critical |

---

## Key features

- **Reporting in the tenant's own words.** English, Filipino or Taglish, with an
  optional photo. Each report gets a ticket number and an estimated response time.
- **AI classification.** A fine-tuned XLM-RoBERTa-large model suggests the category and
  priority, with a calibrated confidence score.
- **Safety floor.** Reports containing explicit danger terms such as *sunog* (fire),
  *usok* (smoke) or *nakuryente* (electrocuted) are raised to at least High, whatever
  the model predicted. Administrators manage the term list from the **Safety Terms**
  page.
- **Human-in-the-loop review.** Every automated assignment waits in a review queue until
  an administrator confirms or overrides it. Overrides keep the original prediction.
- **Assignment and tracking.** A dashboard with Kanban and table views, a panel of
  unresolved Critical reports, and a work queue for maintenance staff, from submission
  through to resolution.
- **Analytics.** Weekly and monthly trends, a per-date summary, AI agreement rates and
  resolution times, with CSV export.
- **Always available.** If the AI service is unreachable, a keyword classifier takes
  over so no report is rejected, and the report records which mechanism classified it.
- **Works on phones.** A web application that adapts to phone screens, with nothing to
  install.

---

## Tech stack

**Frontend**
- HTML, CSS and JavaScript ES modules, with no framework or build step
- Chart.js for analytics, supabase-js v2 for data access and sign-in

**Database and authentication**
- Supabase: PostgreSQL, Auth with email confirmation, and row-level security
- No application server. The browser talks to the database directly, and the
  row-level security policies, triggers and SQL functions in [`supabase/`](supabase/)
  enforce who can read and change what.

**AI classifier**
- `xlm-roberta-large`, fine-tuned with PyTorch and Hugging Face Transformers
- Served by FastAPI and Uvicorn on CPU, about 250 ms per report

**Infrastructure**
- Vercel (website), Hugging Face Spaces (classifier), Docker Hub (container images),
  GitHub Actions (image publishing)

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

The model runs as a separate containerised service, so the web app stays up and
usable even when inference is unavailable: a keyword scorer takes over and the
report records which mechanism produced the classification.

---

## The model

Fine-tuned from `xlm-roberta-large`, pre-trained on 100 languages including Tagalog
and English. One shared encoder with three output heads: category (7), priority (4),
and an auxiliary issue-type head (149) used during training only.

**Priority uses an ordinal loss.** The four levels are ordered, so being three levels
wrong is worse than being one level wrong, and under-prediction is penalised twice as
heavily as over-prediction: under-rating a hazard costs more than over-rating a minor
request.

Results on 1,788 held-out reports:

| Measure | Model | TF-IDF + LinearSVC baseline |
|---|---:|---:|
| Category macro-F1 | 0.9325 ± 0.0103 | — |
| Priority accuracy | 0.8883 ± 0.0135 | 0.6728 |
| Within one priority level | 0.9972 | 0.9239 |
| Quadratic weighted kappa | 0.9553 | 0.7441 |
| Critical routed below High | 0 | 34 of 290 |
| Over- to under-prediction ratio | 6.6 : 1 | 0.98 : 1 |

Category macro-F1 and priority accuracy are means and standard deviations across three
initialisation seeds. The remaining model figures are for the deployed checkpoint
(seed 7).

The error *direction* matters more here than the accuracy gap. The baseline shows no
directional preference and mis-routed 34 genuine emergencies as low priority. The
fine-tuned model errs toward greater severity and mis-routed none.

The trained checkpoint is published as the
[`model-v1` release](https://github.com/EnzoProg-ctrl/Thesis-Autofill/releases/tag/model-v1)
of this repository and is included in the classifier's Docker image. The training
pipeline and corpus are maintained separately and are not included here.

---

## Safety floor

A deterministic rule runs **after** the model, independently of it. If the report
contains explicit danger terminology, for example `sunog`, `usok`, `apoy`,
`nakuryente`, `naipit`, `trapped`, `smoke` or `sparks`, the priority is raised to at
least **High**.

It can only escalate, never lower. Device names are blanked before matching, so
"please test our smoke detector" does not trigger it. When it fires, the model's
original prediction is preserved so a reviewer can see that a rule, not the model,
set the priority.

The model is accurate, but no model is certain on any single report. This rule is a
guarantee the model cannot provide on its own.

Administrators manage the term list on the **Safety Terms** page: add a term, turn one
off, or delete it, and see how many past reports it would have matched before saving.
Terms are stored in Supabase; both the inference service and the browser fall back to a
built-in list if the table cannot be read, and the database refuses to switch off the
last active danger term.

---

## Run with Docker

The web application and the classifier are both published on Docker Hub:

| Image | Contents |
|---|---|
| [`dexterctoribio/firs-web`](https://hub.docker.com/r/dexterctoribio/firs-web) | The web application, served by nginx (`deploy/web/`) |
| [`dexterctoribio/firs-classifier`](https://hub.docker.com/r/dexterctoribio/firs-classifier) | The classification service with the fine-tuned model (`deploy/hf-space/`) |

**Quickest way: no setup, uses the demo database and the [demo accounts](#demo-accounts).**

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
2. Download [`docker-compose.yml`](docker-compose.yml) (or this whole repository), open a
   terminal in the folder containing it, and run:
   ```bash
   docker compose up
   ```
   The first run downloads about 1.5 GB.
3. When the terminal shows `Uvicorn running on http://0.0.0.0:7860` (about 40 seconds,
   while the AI model loads), open <http://localhost:5500> and sign in with a demo
   account.

To stop it, press **Ctrl+C**. Next time only step 2's `docker compose up` is needed.

**With your own database:** in the same folder, copy [`.env.example`](.env.example) to
`.env` and fill in your Supabase project's URL and anon key before running
`docker compose up`. [SETUP.md](SETUP.md) shows how to create the project and its
database. Both containers read these settings at start-up, so the published images need
no rebuilding.

| Variable | Container | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | both | The Supabase project to use (default: the demo database) |
| `FIRS_API_BASE` | web | Classifier address as seen from the browser (default `http://localhost:7860`) |

---

## Replicate the whole system

**Full step-by-step guide: [SETUP.md](SETUP.md).** It walks through creating a free
Supabase account, rebuilding the database, running the system, and trying it as a
store and as an administrator, with troubleshooting for common problems.

In outline:

1. **Database.** Create a Supabase project and run
   [`supabase/setup.sql`](supabase/setup.sql) once in its SQL Editor. It creates every
   table, security policy, function and trigger, and the starting safety terms. It
   contains no accounts and no reports.
2. **First administrator.** Create a user in Supabase and give it the administrator
   role with one SQL statement.
3. **Run the system,** either with Docker (above) or with Python
   (`serving/serve.py` and `python -m http.server 5500`).
4. **Open <http://localhost:5500>**, register a store, submit a report, and review it
   as the administrator.

`setup.sql` is generated from the schema and migration files in `supabase/`. After
changing or adding one of them, regenerate it with `python supabase/build_setup.py`.

---

## Database reference

PostgreSQL on Supabase. The source of truth is the SQL in [`supabase/`](supabase/),
applied in the order listed in [`supabase/build_setup.py`](supabase/build_setup.py);
its comments explain why each rule exists. All ids are UUIDs.

### How the tables relate

```
auth.users (Supabase login accounts)
   ├── profiles      administrators and maintenance staff
   └── tenants       stores
          └── issues          reports, one per submission
                 ├── assigned_to  → profiles (staff)
                 └── validated_by → profiles (reviewer)

safety_terms   safety-floor vocabulary, managed by administrators
```

Every person who signs in has a Supabase login account. Their `profiles` or `tenants`
row uses the same id, and the role decides which pages they reach.

### profiles
Administrator and maintenance staff accounts.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key; the same id as the login account |
| full_name | text | |
| email | text | Unique |
| role | text | `admin` or `staff` |
| trade | text? | Staff specialty: Electrician, Plumber, HVAC, Carpenter, Fire Safety, Housekeeping or General |
| avatar_initials | text? | Exactly 2 characters |
| created_at | timestamptz | |

### tenants
Registered stores. Created automatically when a store registers.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key; the same id as the login account |
| store_name | text | |
| floor | text | |
| contact_person | text | |
| phone_number | varchar(11)? | Philippine mobile number, 11 digits, e.g. `09171234567` |
| email | text | Unique; the address confirmed at registration |
| privacy_consented_at | timestamptz | When the store accepted the data privacy notice |
| created_at | timestamptz | |

### issues
Facility issue reports.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| ticket_number | text | `ISS-001`, `ISS-002`, …; assigned automatically, unique |
| tenant_id | uuid | → tenants |
| store_name, contact_person, phone_number | text? | Copied from the store at submission, so the report keeps the details as given |
| text | text | The report, in the tenant's own words |
| image_url | text? | The optional photo, stored as a base64 `data:` URI rather than a link |
| category | text? | The category the tenant selected |
| status | text | `awaiting_review` (default), `in_progress` or `resolved` |
| assigned_to | uuid? | → profiles; the maintenance staff member handling it |
| ai_category | text? | Category suggested by the classifier: `electrical`, `plumbing`, `hvac`, `structural`, `fire_safety`, `housekeeping` or `other` |
| ai_confidence | integer? | Classifier confidence in that category, 0–100 |
| ai_priority_level | text? | `low`, `medium`, `high` or `critical` |
| ai_priority_score | integer? | Severity index, 0–100 |
| ai_priority_source | text? | What set the priority: `model`, `keyword` (classifier unreachable) or `safety_floor` |
| ai_safety_terms | text? | Danger terms found in the text, comma-separated |
| ai_model_priority | text? | The model's own level, kept when the safety floor overrode it |
| ai_language | text? | Detected language: English, Filipino or Taglish |
| validated | boolean | Whether a reviewer has confirmed or overridden the assignment |
| validated_by | uuid? | → profiles; the reviewer |
| validated_at | timestamptz? | |
| overridden | boolean | Whether the reviewer changed the AI's assignment |
| override_notes | text? | The reviewer's reason |
| pre_override_priority_level | text? | The priority before the reviewer changed it; NULL if never changed |
| submitted_at | timestamptz | |
| updated_at | timestamptz | Moves on every change |
| text_edited_at | timestamptz? | When the tenant last edited the report text |
| resolved_at | timestamptz? | When the report was last marked resolved; cleared if reopened |

### safety_terms
The safety-floor vocabulary. Read publicly only through `get_safety_terms()`.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| kind | text | `danger` (raises priority) or `exclusion` (ignored before matching) |
| match_type | text | `substring` (part of a word, for Tagalog roots), `word` (whole word) or `phrase` (exclusions) |
| term | text | Lowercase letters, 3–60 characters; unique per kind and match type |
| label | text | Name shown when it matches; word forms share one, e.g. *smoking* shows as *smoke* |
| active | boolean | Turned on or off by an administrator |
| sort_order | integer | Order of matched terms in explanations |
| note | text? | Why the term was added |
| created_by | uuid? | → profiles; NULL for the starting terms |
| created_at, updated_at | timestamptz | |

### Who can do what

Enforced by row-level security in the database, not by the web pages.

| | profiles | tenants | issues | safety_terms |
|---|---|---|---|---|
| **Administrator** | Read all; create and delete accounts | Read all; delete | Read, update and delete all | Read and manage all |
| **Maintenance staff** | Read all | Read all | Read reports assigned to them or awaiting review; update assigned ones | Active terms only, through `get_safety_terms()` |
| **Store** | Read all | Read and update its own | Submit; read its own; edit or withdraw its own while awaiting review | Active terms only, through `get_safety_terms()` |
| **Not signed in** | — | — | — | Active terms only, through `get_safety_terms()` |

Every signed-in user can edit their own profile, but nobody can change their own role.

### Automatic behaviour

| What | Where |
|---|---|
| Registering a store creates its `tenants` row from the registration details | `handle_new_tenant()`, on `auth.users` |
| Each report gets the next ticket number | `generate_ticket_number()` |
| `updated_at` and `resolved_at` are kept current | `update_updated_at_column()`, `set_resolved_at()` |
| A store cannot change the review, assignment, status or AI fields of its own report | `guard_tenant_issue_update()` |
| Nobody can raise their own role | `prevent_self_role_change()` |
| The last active danger term cannot be turned off or deleted | `safety_terms_keep_one()` |

### Functions the application calls

| Function | Who | Purpose |
|---|---|---|
| `admin_create_profile(...)` | Administrators | Creates an administrator or staff profile from **Manage Users** |
| `get_safety_terms()` | Anyone | Active safety terms, for the tenant pages and the classifier |

---

## Repository layout

| Path | Contents |
|---|---|
| `index.html`, `register.html`, `reset-password.html` | Sign-in, registration and password reset |
| `tenant/` | Tenant reporting interface |
| `admin/` | Dashboard, HITL review queue, safety terms, analytics, staff work queue |
| `js/` | ES modules: data access, classification client, dashboards |
| `css/` | Design system and per-area stylesheets |
| `supabase/` | Schema, row-level security, functions, migrations, and `setup.sql` (all of them in one file) |
| `serving/` | FastAPI inference service and model loader |
| `deploy/hf-space/` | Dockerfile for the classifier container |
| `deploy/web/` | Dockerfile for the web application container |
| `deploy/dockerhub/` | Overview pages for the two Docker Hub images |
| `docker-compose.yml`, `.env.example` | Running both containers together |
| `SETUP.md` | Step-by-step guide to setting up your own copy |

Key modules:

- `js/bert-api.js`: calls the inference service, falls back to the keyword scorer
- `js/keyword-classifier.js`: the fallback, used only when inference is unreachable
- `js/safety-floor.js`: safety-floor matching and the built-in term list
- `js/hitl.js`: review queue; preserves the pre-override prediction
- `js/shared.js`: data access and shared UI
- `serving/serve.py`: inference endpoint, temperature scaling, safety floor

---

## Putting it online

- **Website (Vercel):** import the repository into [Vercel](https://vercel.com) as a
  static site, with no framework and no build command. `.vercelignore` keeps the server
  code and database files off the public site. Set the project URL and anon key in
  `js/supabase-client.js`.
- **Classifier (Hugging Face Spaces or any Docker host):** deploy to a Space with the
  Docker SDK by following [`deploy/hf-space/README.md`](deploy/hf-space/README.md), or
  run the `dexterctoribio/firs-classifier` image on any host with about 4 GB of memory,
  with `FIRS_SUPABASE_URL` and `FIRS_SUPABASE_ANON_KEY` set to your project.
- Point the tenant pages at the deployed classifier: the `window.FIRS_API_BASE` line in
  `tenant/index.html` and `tenant/home.html`.
- Add the website's address to `allow_origins` in `serving/serve.py`; the classifier
  rejects browser requests from any other origin.
- In Supabase, set **Authentication → URL Configuration → Site URL** to the website's
  address and add `<address>/reset-password.html` to **Redirect URLs**.

---

## Limitations

**The model was trained on generated data.** The corpus was built from a taxonomy of
149 issue types rather than collected from real reports. The accuracy figures describe
generalisation to unseen phrasings of known problems, not to arbitrary real complaints.

**Real reports are shorter than the training data.** During deployment, submissions
averaged about six words: enough to identify the fault, rarely enough to convey
urgency. The model reads severity from descriptive language, so where that language is
absent it assigns a lower priority than a reviewer would. This is the main reason the
review step exists.

**The reported deployment figures come from 96 reports across 38 tenants.** Enough to
observe behaviour, not enough for strong statistical claims.

**The Tagalog in the training corpus has not been reviewed by a native speaker.**

---

## Licence and status

Academic project. Not licensed for production use.
