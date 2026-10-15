# Setting Up Your Own Copy of the Nepo Mall FIRS

This guide builds a complete, working copy of the Facility Issue Reporting System on
your own computer, with **your own database**: the same tables, security rules,
functions and safety-term list as the original, under your own Supabase account.

> **Just want to try it?** You don't need this guide. With Docker installed,
> `docker compose up` starts the whole system connected to a ready-made demo database;
> see [Run with Docker](README.md#run-with-docker) and the
> [demo accounts](README.md#demo-accounts) in the README.

| Part | What you do | Time |
|---|---|---|
| [1. Create your database](#part-1--create-your-database) | Make a free Supabase project and run one SQL file | 10–15 min |
| [2. Run the system](#part-2--run-the-system) | Start the website and the AI classifier | 10–20 min |
| [3. Try it](#part-3--try-it) | Register a store, submit a report, review it as an administrator | 10 min |
| [4. Troubleshooting](#part-4--troubleshooting) | If something doesn't work | — |

**What gets copied:** the database structure, security rules, functions, the starting
safety terms, and the same trained AI model. **What doesn't:** the original accounts,
reports and photos. Those belong to the study's participants and are not shared, so
your copy starts empty and you create your own accounts and reports.

**What you need:**
- A computer with internet access and at least 8 GB of RAM (the AI model uses about 4 GB)
- An email address, for your Supabase account
- About 4 GB of free disk space

---

## Part 1 — Create your database

### Step 1. Create a Supabase account

1. Go to <https://supabase.com> and click **Start your project**.
2. Sign up with GitHub or an email address. If you already have an account, sign in.

The free plan is enough for everything in this guide.

### Step 2. Create a project

1. In the Supabase dashboard, click **New project**.
2. Fill in:
   - **Name:** anything, for example `firs`
   - **Database password:** click **Generate a password** and save it somewhere safe.
     This guide never needs it, but Supabase does not show it again.
   - **Region:** the one closest to you, for example *Southeast Asia (Singapore)*
   - **Security:** keep **Enable Data API** ticked; the website reads and writes the
     database through it. The other two options can stay as they are; the setup
     script grants and secures its tables itself.
3. Click **Create new project** and wait 1–2 minutes until the project is ready.

> **"Members who have exceeded their free project limits"?** Supabase allows each
> person two active free projects, counted across every organization where they are
> an owner or admin. Create the project in a new organization of your own
> (organization switcher at the top left → **New organization**, plan **Free**).

### Step 3. Build the database

1. Open the setup script:
   <https://github.com/EnzoProg-ctrl/Thesis-Autofill/blob/main/supabase/setup.sql>
2. Click the **Copy raw file** button at the top right of the file.
3. In Supabase, open **SQL Editor** in the left sidebar, then click **New query**.
4. Paste the script and click **Run**.
5. Supabase may warn that the query *"includes destructive operations"*. This is
   expected: the script contains a few `DROP ... IF EXISTS` lines that only touch
   objects the script itself creates, so on a new project they remove nothing.
   Confirm to run it.
6. The result should read **Success. No rows returned**.

> Run the script only once, on a new project. Running it a second time stops with
> an error such as *relation "profiles" already exists*, because the tables are
> already there.

### Step 4. Check the database

In the SQL Editor, click **New query**, paste this and click **Run**:

```sql
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
  (select count(*) from public.safety_terms where kind = 'danger')    as danger_terms,
  (select count(*) from public.safety_terms where kind = 'exclusion') as exclusion_phrases;
```

You should see **tables 4**, **danger_terms 16** and **exclusion_phrases 9**. The four
tables are `profiles` (administrators and staff), `tenants` (stores), `issues`
(reports) and `safety_terms`.

### Step 5. Configure sign-in

Open **Authentication** in the left sidebar.

1. **Sign In / Providers → Email:** make sure **Confirm email** is turned on. New
   tenants then have to confirm their email address before they can sign in, as in
   the original system.
2. **URL Configuration:**
   - Set **Site URL** to `http://localhost:5500`
   - Under **Redirect URLs**, click **Add URL** and add
     `http://localhost:5500/reset-password.html`

   Confirmation and password-reset emails link back to these addresses. If you later
   put your copy online, change both to its address.

> **Email limit.** Supabase's built-in email sender only sends a few emails per hour.
> That is enough to try the system. If confirmation emails stop arriving, wait an
> hour, or see [Troubleshooting](#confirmation-email-never-arrives).

### Step 6. Create the first administrator

Stores register themselves from the website, but administrator and staff accounts can
only be created by an existing administrator. The first one is created here.

1. Go to **Authentication → Users** and click **Add user → Create new user**.
2. Enter an email address and a password, tick **Auto Confirm User**, and click
   **Create user**.
3. Open **SQL Editor → New query**, paste the following, change the email on the
   last line to the one you just used, and click **Run**:

   ```sql
   insert into public.profiles (id, full_name, email, role, avatar_initials)
   select id, 'System Admin', email, 'admin', 'SA'
   from auth.users
   where email = 'admin@example.com';
   ```

   The result should read **Success. 1 row affected**. If it says *0 rows*, the email
   does not match the user you created; check the spelling and run it again.

You will sign in with this email and password in [Part 3](#part-3--try-it). Further
administrators and maintenance staff are created from the website itself.

### Step 7. Copy your project's address and key

The website and the classifier need two values from your project:

1. **Project URL**: click **Connect** at the top of the dashboard, or go to
   **Project Settings → Data API**. It looks like `https://abcdefghijkl.supabase.co`.
2. **anon public key**: go to **Project Settings → API Keys**, open the
   **Legacy API Keys** tab, and copy the **anon public** key. It is a long text
   starting with `eyJ`.

> Use the **anon public** key only. It is designed to be public: the security rules
> created in Step 3 are what protect the data. **Never** use the `service_role` key
> or a secret key anywhere in this guide; it bypasses every security rule.

Keep both values at hand for Part 2.

---

## Part 2 — Run the system

Choose one option:

- **Option A — Docker (recommended).** Install one program, edit one file, run one
  command. Nothing else to install.
- **Option B — Without Docker.** Install Python and run the website and the
  classifier yourself.

### Option A — Docker

**1. Install Docker Desktop**

Download it from <https://www.docker.com/products/docker-desktop>, install it, and
open it. Wait until it says Docker is running.

- **Windows:** if asked to install or update WSL 2, accept, and restart if prompted.
- **Mac with Apple Silicon (M1/M2/M3/M4):** works, but the AI classifier runs more
  slowly, because its image is built for Intel/AMD processors.

**2. Download the project**

Either download the ZIP from
<https://github.com/EnzoProg-ctrl/Thesis-Autofill> (**Code → Download ZIP**) and
extract it, or, if you have Git:

```bash
git clone https://github.com/EnzoProg-ctrl/Thesis-Autofill.git
```

**3. Point it at your database**

In the project folder, make a copy of the file `.env.example` named `.env`, then open
`.env` in a text editor and replace both values with the ones from
[Step 7](#step-7-copy-your-projects-address-and-key):

```
SUPABASE_URL=https://abcdefghijkl.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

Save the file. On Windows, check it is named exactly `.env` and not `.env.txt`
(in File Explorer, turn on **View → File name extensions**).

**4. Start the system**

Open a terminal in the project folder (on Windows: right-click inside the folder in
File Explorer → **Open in Terminal**) and run:

```bash
docker compose up
```

The first run downloads about 1.5 GB. When it starts, the terminal shows lines from
`firs-web` and `firs-classifier`. Wait until you see:

```
firs-web         | firs-web: using Supabase project https://abcdefghijkl.supabase.co
firs-classifier  | INFO:     Uvicorn running on http://0.0.0.0:7860
```

The first line confirms the website is using **your** database. The second appears
about 40 seconds after start-up, once the AI model has loaded.

**5. Open the system**

Go to **<http://localhost:5500>** and continue with [Part 3](#part-3--try-it).

**Stopping and starting again:** press **Ctrl+C** in the terminal to stop. Next time,
run `docker compose up` again; nothing is downloaded twice. To get newer versions of
the images later, run `docker compose pull` first.

### Option B — Without Docker

**1. Install the tools**

- **Python 3.11** from <https://www.python.org/downloads/>. On Windows, tick
  **Add python.exe to PATH** during installation.
- **Git** from <https://git-scm.com/downloads> (optional; you can download the ZIP
  instead).

**2. Download the project**

```bash
git clone https://github.com/EnzoProg-ctrl/Thesis-Autofill.git
cd Thesis-Autofill
```

**3. Point the website at your database**

Open `js/supabase-client.js` in a text editor and replace the two values near the top
with your Project URL and anon key:

```js
const SUPABASE_URL  = 'https://abcdefghijkl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOi...';
```

**4. Point the website at your classifier**

`tenant/index.html` and `tenant/home.html` each contain this line, set to the original
online classifier:

```html
<script>window.FIRS_API_BASE = 'https://chompyy-firs-classifier.hf.space';</script>
```

In **both** files, change the address to `http://127.0.0.1:8000`:

```html
<script>window.FIRS_API_BASE = 'http://127.0.0.1:8000';</script>
```

**5. Start the classifier**

Open a terminal in the project folder:

```bash
cd serving
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python get_model.py
```

`get_model.py` downloads the trained model (about 1.1 GB) and checks it is complete.
Then tell the classifier where your database is and start it.

Windows (PowerShell):

```powershell
$env:FIRS_SUPABASE_URL = "https://abcdefghijkl.supabase.co"
$env:FIRS_SUPABASE_ANON_KEY = "eyJhbGciOi..."
python serve.py
```

Mac or Linux:

```bash
export FIRS_SUPABASE_URL="https://abcdefghijkl.supabase.co"
export FIRS_SUPABASE_ANON_KEY="eyJhbGciOi..."
python serve.py
```

Leave this terminal open. The classifier is ready when
<http://127.0.0.1:8000/health> shows `"status": "ok"`.

**6. Start the website**

Open a **second** terminal in the project folder (not in `serving`) and run:

```bash
python -m http.server 5500
```

Leave it open, go to **<http://localhost:5500>**, and continue with Part 3.

> Always open the site through `http://localhost:5500`. Opening the HTML files
> directly (a `file://` address) breaks the connection to the classifier, and port
> 5500 is the one the classifier accepts requests from.

---

## Part 3 — Try it

### Register a store and submit a report

1. On <http://localhost:5500>, click **Register** and fill in the store details with
   an email address you can open.
2. Open the confirmation email from Supabase and click the link. It brings you back
   to the site.
3. Sign in with the store's email and password.
4. Submit a report, for example:

   > Tumutulo yung tubo sa ilalim ng lababo namin, basa na ang sahig

   You should get a ticket number, the category **Plumbing**, a priority level, and
   an estimated response time.

### Review it as the administrator

1. Sign out, then sign in with the administrator from
   [Step 6](#step-6-create-the-first-administrator).
2. Open **HITL Review**. The report is waiting, with the AI's suggested category and
   priority. The explanation should say the priority was assessed **"by the model"**,
   which confirms the AI classifier is working.
3. Confirm the suggestion, or override it and save.

### Explore the rest

- **Manage Users** (sidebar): create a maintenance staff account and choose a trade.
  Like a store, the new account must confirm its email before it can sign in; for a
  test account you can confirm it by hand under **Authentication → Users** in
  Supabase. Then sign in as that account to see the staff **work queue**.
- **Dashboard:** assign the report to the staff member, and follow it through to
  resolved.
- **Safety Terms:** add, disable or test the danger words that raise a report to at
  least High priority. Try a report containing *umuusok* (smoke).
- **Analytics:** charts and the per-date summary fill in as reports come in.

---

## Part 4 — Troubleshooting

### The report says "The model did not run on this report"

The website could not reach the AI classifier, so the keyword fallback classified it.

- The classifier may still have been loading. Wait for the `Uvicorn running` line
  (Docker) or for `/health` to show `"status": "ok"` (Option B), then submit another
  report.
- Make sure you opened the site at `http://localhost:5500`, not another port or a
  `file://` address.
- Option B: check the `window.FIRS_API_BASE` line in **both** tenant pages
  ([Option B, step 4](#option-b--without-docker)).

### The site shows the demo data, or ignores your project

- Docker: the terminal should print `firs-web: using Supabase project` followed by
  **your** URL. If it shows `https://qcrrxpflkdtdnylkzojj.supabase.co`, that is the
  public demo database, used when no `.env` file is found. Check the file is named
  exactly `.env`, sits next to `docker-compose.yml`, and has both values. Then stop
  with Ctrl+C and run `docker compose up` again.
- Option B: check both values in `js/supabase-client.js`, then reload the page with
  **Ctrl+Shift+R**.

### The administrator can't sign in, or signs in as a store

- *Invalid login credentials:* the user was created without **Auto Confirm User**.
  In **Authentication → Users**, delete it and create it again with the box ticked.
- Signs in but is not treated as an administrator: the `insert into public.profiles`
  step affected 0 rows. Run it again with the exact email, as in
  [Step 6](#step-6-create-the-first-administrator).

### Confirmation email never arrives

- Check the spam folder.
- Supabase's built-in sender allows only a few emails per hour. Wait, then try again.
- For testing only, you can confirm a store by hand: **Authentication → Users**,
  open the user, and choose **Confirm email** if offered. Or turn off **Confirm email**
  in Step 5 so new stores can sign in immediately.

### `docker compose up` says a port is already allocated

Another program is using port 5500 or 7860, often an earlier copy of these containers.
Stop them in Docker Desktop (or run `docker compose down`), then try again.

### `setup.sql` fails with "already exists"

The project is not empty: the script already ran once. Create a new project
([Step 2](#step-2-create-a-project)) and run the script there.

---

## Putting your copy online

To make your copy reachable by other people instead of only on your computer, see
**Putting it online** in the [README](README.md#putting-it-online). In short, the
website can be hosted on Vercel, the classifier on Hugging Face Spaces or any host
that can run its Docker image, and the Supabase **Site URL** and **Redirect URLs**
must then be changed to the new address.
