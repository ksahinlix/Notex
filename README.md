# Notex

A personal, hierarchical note app with on-device AI for sorting and searching
notes, and end-to-end encrypted folders. Web first, then mobile.

- **How everything works (learning guide):** [`docs/GUIDE.md`](docs/GUIDE.md)
- **Why things are built this way:** [`docs/PROJECT_LOG.md`](docs/PROJECT_LOG.md)
- **AI:** folder suggestions while you write and search by meaning, done by the server with Cloudflare Workers AI (free tier). Notes in locked folders are never sent. Without Cloudflare settings the app works, just without AI.
- **Original prototype:** [`docs/prototype.jsx`](docs/prototype.jsx)

## Project layout

```
server/   Node.js + Express API, Postgres schema (db/schema.sql)
web/      Vite + React + TypeScript app
docs/     project log, prototype, original summary
render.yaml  deployment config for Render
```

## Running locally

Requirements: **Node.js 22+**, [Git](https://git-scm.com), and a Postgres
database (a free [Neon](https://neon.tech) project is fine).

### 0. Get the code

```bash
git clone https://github.com/ksahinlix/Notex.git
cd Notex
```

> **Windows (PowerShell):** the commands below are one per line, so they work
> in PowerShell as-is. Notes:
> - Windows PowerShell 5 doesn't support `&&`. Run chained commands one at a time.
> - If `npm` fails with *"running scripts is disabled on this system"*, run
>   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or type `npm.cmd`
>   instead of `npm`.
> - Put arguments in **single quotes** (`'my pa$$word'`). Inside double quotes
>   PowerShell treats `$` as a variable.
> - Create `.env` with `Copy-Item` or a text editor, not `echo ... > .env`.
>   Windows PowerShell 5 writes UTF-16, which Node can't read.

### 1. Server

```bash
cd server
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Fill in `server/.env`:

| Variable | How to get it |
|----------|---------------|
| `DATABASE_URL` | Neon dashboard → your project → **Connect** → use the copy button (the password is hidden as `****` on screen). Change `sslmode=require` to `sslmode=verify-full` to silence a warning from `pg`. |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | Google sign-in: see **Google login setup** below |
| `OWNER_EMAIL` | Your Google email. Your first sign-in takes over notes created before multi-user login |
| `AI_DAILY_LIMIT` | Optional: AI requests per user per day (default 150) |
| `CLOUDFLARE_ACCOUNT_ID` | Optional (AI). The 32 characters in the dashboard URL: `dash.cloudflare.com/<account id>/home` |
| `CLOUDFLARE_API_TOKEN` | Optional (AI). My Profile → API Tokens → **Workers AI** template; under *Account Resources* include your account |

Then:

```bash
npm run migrate   # creates the tables
npm run dev       # http://localhost:8000, restarts on file changes
```

Check it: open <http://localhost:8000/api/health>. You should see `{"ok":true,"db":"up"}`.

### 2. Web app

In a second terminal:

```bash
cd web
npm install
npm run dev       # http://localhost:5173 (API calls are proxied to :8000)
```

Sign in with Google.

## Google login setup

Notex signs users in with Google (anyone with a Google account can sign up).
One-time setup, free:

1. Open <https://console.cloud.google.com>, create a project (e.g. "Notex").
2. **APIs & Services → OAuth consent screen**: choose **External**. Enter the
   app name and your email, then save. Under **Audience**, click **Publish app**
   so any Google account can sign in. The basic profile/email scopes need no
   review.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://notex-r2zk.onrender.com`
     and `http://localhost:5173`
   - No redirect URI is needed.
4. Copy the **Client ID** (`…apps.googleusercontent.com`, not secret) into
   `GOOGLE_CLIENT_ID` (in `server/.env` and Render). Put your Google email
   in `OWNER_EMAIL`.

## Tests

```bash
cd web && npm test && npm run lint && npm run build
cd server && npm test
```

The server's database tests start a throwaway local Postgres by themselves
(`embedded-postgres`, downloaded by `npm install`). To use your own test
database instead, put `TEST_DATABASE_URL=...` in `server/.env.test`.
**Its tables are wiped on every run**, so never point it at real data.

## Deploying (Render + Neon)

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, then pick the repo. Render reads `render.yaml`.
3. When asked, set `DATABASE_URL` (Neon), `GOOGLE_CLIENT_ID`, `OWNER_EMAIL`
   and, for AI, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
   `SESSION_SECRET` is generated automatically.
4. Open the service URL and log in. The schema is applied on each start.

The free service sleeps after ~15 minutes idle, so the first visit after that
takes up to a minute.

## Backups (D23)

Every note, the records that reopen a locked folder, the to-do marks and the
shares go into one gzipped JSON file. Locked notes travel as ciphertext, so
the file is useless to anyone who takes it.

There are two ways to get that file, both guarded by `CRON_SECRET`:

| Endpoint | What it does |
|---|---|
| `GET /api/backup` | hands the file over, so whatever asks keeps it. **Needs no storage account.** |
| `POST /api/backup` | the server pushes it into a Cloudflare R2 bucket instead. |

### Scheduled backup onto a machine you own (no account needed)

`server/scripts/pull-backup.ps1` fetches the file, writes
`notex-<stamp>Z.json.gz` into a folder you pick and keeps the newest N. Point
it at a folder OneDrive or Google Drive already syncs and the copy is off-site
with no API, no key and no storage account.

```powershell
$env:NOTEX_CRON_KEY = "<CRON_SECRET from Render>"
cd server\scripts
.\pull-backup.ps1 -Dir "$env:USERPROFILE\OneDrive\Notex-yedek" -Keep 60
```

Then in **Task Scheduler** -> *Create Basic Task* -> daily ->
*Start a program*:

- Program: `powershell.exe`
- Arguments: `-ExecutionPolicy Bypass -File "C:\path\to\Notex\server\scripts\pull-backup.ps1" -Dir "C:\Users\you\OneDrive\Notex-yedek"`
- Set `NOTEX_CRON_KEY` as a user environment variable, so the key is not in
  the task definition.

It exits non-zero on failure, so a backup that did not happen shows up as a
failed task.

### Or: the server pushes to Cloudflare R2

Note that enabling R2 asks for a payment method, even though the free tier
(10 GB) costs nothing.

1. Cloudflare dashboard → **R2** → create a bucket, e.g. `notex-backups`.
2. **R2 → Manage API tokens → Create API token**, permission *Object Read &
   Write*, scoped to that one bucket. The secret is shown once.
3. In Render, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   and `R2_BUCKET`, then redeploy.
4. In cron-job.org add a second job next to the reminders one:
   `POST https://<your-app>/api/backup`, once a day, header
   `x-cron-key: <CRON_SECRET>`. Success answers with the object key and what
   went into it; failure answers 502 with R2's own message.
5. In the bucket's **Settings → Object lifecycle rules**, expire old objects.
   Nothing in the app ever deletes.

**Getting your own copy any time:** *Notlarını indir* at the foot of the page
downloads your notes (yours only) as JSON.

**Restoring**

```bash
cd server
node --env-file=.env scripts/restore-backup.mjs notex-20261002T030000Z.json.gz           # shows what is in it
node --env-file=.env scripts/restore-backup.mjs notex-20261002T030000Z.json.gz --yes     # writes it
node scripts/restore-backup.mjs backup.json.gz --yes --database-url=postgresql://...     # somewhere else
```

Without `--yes` nothing is written. Rows are upserted inside one transaction,
so restoring twice is the same as restoring once, and nothing is deleted:
notes written after the backup was taken are left alone. Run `npm run migrate`
first if the target database is empty.
