# Nepo Mall FIRS — Web Application

Web application of the **Facility Issue Reporting System (FIRS)**, developed for Nepo Mall, Angeles City.

- **Stores** submit facility issue reports in English, Filipino or Taglish, with an optional photo.
- **Property Management Office administrators** review the AI-suggested category and priority, assign reports, and track them to resolution.
- **Maintenance staff** see their assigned reports in a work queue.

This image serves the website with nginx. The AI classifier is a separate image:
[dexterctoribio/firs-classifier](https://hub.docker.com/r/dexterctoribio/firs-classifier)

## Quick start: the whole system, no setup

The Compose file starts the website and the classifier together. Make a new folder, open a terminal in it, then download the file and start the system:

**Windows (PowerShell):**

```
curl.exe -o docker-compose.yml https://raw.githubusercontent.com/EnzoProg-ctrl/Thesis-Autofill/main/docker-compose.yml
docker compose up
```

**Mac or Linux:**

```
curl -o docker-compose.yml https://raw.githubusercontent.com/EnzoProg-ctrl/Thesis-Autofill/main/docker-compose.yml
docker compose up
```

Or download it in a browser: open
https://raw.githubusercontent.com/EnzoProg-ctrl/Thesis-Autofill/main/docker-compose.yml,
right-click the page, choose **Save as**, and save it as `docker-compose.yml` (on Windows, set *Save as type* to *All files*, so it is not saved as `.txt`). Then run `docker compose up` in that folder.

The first run downloads about 1.5 GB. When the terminal shows `Uvicorn running on http://0.0.0.0:7860` (about 40 seconds, while the AI model loads), open **http://localhost:5500**.

## Demo accounts

By default the website uses a public **demo database** with fictional stores, staff and reports. Sign in with:

| Role | Email | Password |
|---|---|---|
| Administrator | `demo.admin@example.com` | `firsdemo123` |
| Maintenance staff | `demo.staff@example.com` | `firsdemo123` |
| Store (tenant) | `demo.store@example.com` | `firsdemo123` |

Please don't change these passwords, so the next person can still sign in. The demo database is reset from time to time, which removes anything visitors added.

## Run the website only

```
docker run -p 5500:80 dexterctoribio/firs-web:1.0
```

Open **http://localhost:5500**. Without the classifier running, reports are classified by the built-in keyword fallback instead of the AI model, and the report says so.

Use port **5500**: the classifier only accepts requests from approved addresses, and `http://localhost:5500` is one of them.

## Using your own database

Set both Supabase variables to your own project, for example in a `.env` file next to `docker-compose.yml`. The repository's [SETUP.md](https://github.com/EnzoProg-ctrl/Thesis-Autofill/blob/main/SETUP.md) shows how to create the project and its database in a few minutes.

| Variable | Default | Purpose |
|---|---|---|
| `SUPABASE_URL` | the demo database | Supabase project URL |
| `SUPABASE_ANON_KEY` | the demo database | That project's **anon public** key |
| `FIRS_API_BASE` | `http://localhost:7860` | Address of the classifier, as seen from the browser |

Use the anon public key only, never the `service_role` key: it ends up in the browser.

## Notes

- Sign-in and reports use a hosted Supabase database, so an internet connection is required.
- The image works on any 64-bit (x86-64) machine; Apple Silicon Macs run it through emulation.

## Source code

https://github.com/EnzoProg-ctrl/Thesis-Autofill

Undergraduate thesis, BS Computer Science, Holy Angel University.
