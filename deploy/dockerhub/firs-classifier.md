# Nepo Mall FIRS — Classification Service

AI classification service of the **Facility Issue Reporting System (FIRS)**, developed for Nepo Mall, Angeles City.

It reads a facility issue report written in English, Filipino or Taglish and returns:

- a **facility category**: Electrical, Plumbing, Air Conditioning, Structural, Fire Safety, Housekeeping or Other
- a **priority level**: Low, Medium, High or Critical, with a confidence score

The model is a fine-tuned **XLM-RoBERTa-large**, included in this image. A rule-based safety floor raises any report containing explicit danger terms (for example *sunog*, *usok*, *sparks*) to at least High priority.

## Run the whole system

To run the website and this service together, with demo accounts and no setup, use the Compose file described on [dexterctoribio/firs-web](https://hub.docker.com/r/dexterctoribio/firs-web).

## Run this service only

```
docker run -p 7860:7860 dexterctoribio/firs-classifier:1.0
```

The model takes about 40 seconds to load. The service is ready when this returns `"status": "ok"`:

```
curl http://localhost:7860/health
```

## Try it

Interactive API documentation, in the browser: **http://localhost:7860/docs**

Or from the command line:

```
curl -X POST http://localhost:7860/classify -H "Content-Type: application/json" -d "{\"text\": \"Tumutulo yung tubo sa ilalim ng lababo namin\"}"
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service status, model name, and where the safety terms were loaded from |
| POST | `/classify` | Classify one report: `{"text": "...", "user_category": null}` |
| GET | `/docs` | Interactive API documentation |

## Settings

| Variable | Purpose |
|---|---|
| `FIRS_SUPABASE_URL`, `FIRS_SUPABASE_ANON_KEY` | Supabase project to read the administrator-managed safety terms from, refreshed every 5 minutes. Without access, the service uses its built-in list. |

## Requirements

- Docker, on any 64-bit (x86-64) machine; Apple Silicon Macs run it through emulation, more slowly
- About 4 GB of free RAM; no GPU needed (about 250 ms per report on CPU)
- About 1.4 GB of disk space for the image

## Source code

Full system source code (web application, this service, database schema):
https://github.com/EnzoProg-ctrl/Thesis-Autofill

Undergraduate thesis, BS Computer Science, Holy Angel University.
