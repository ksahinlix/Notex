# Notex — Project Log

This file records **what** we build, **why** we chose it, and **how** it works.
It is the project's memory: read it to understand any past decision, and add
to it whenever something meaningful changes.

- **Decisions** (section 2) are numbered and never deleted. If a decision
  changes, add a new one that *supersedes* the old one and mark the old one.
- **Log** (section 4) is a diary of work, newest at the bottom.

---

## 1. What is Notex?

A personal, hierarchical note app (like OneNote: *Category > Folder > … > Page*,
unlimited depth) with:

- AI that **suggests where a note belongs** and **searches by meaning**.
  AI runs on the user's device, not on a server.
- Checklist items (e.g. "Watch list"), reminders, comments and images on notes.
- Password-protected folders with end-to-end encryption. The server only ever
  sees encrypted data for those folders.

**Platform priority:** 1) a well-working **web app** → 2) **mobile** → 3) maybe **desktop**.

The original design came from a single-file React prototype built in
Claude.ai: [`prototype.jsx`](prototype.jsx). The original Turkish project
summary is kept in [`original-summary-tr.md`](original-summary-tr.md).

---

## 2. Decisions

| # | Decision | Status |
|---|----------|--------|
| D1 | Start from scratch; the prototype is a design reference only | Active |
| D2 | Web first, then mobile, then maybe desktop | Active |
| D3 | AI runs in the browser; AI is for search + classification only, no chatbot | Active |
| D4 | Backend: Node.js + Express, handles storage/auth only | Active |
| D5 | Database: Postgres on Neon (free tier) | Active |
| D6 | Hosting: one Render web service serves both API and web app | Active |
| D7 | Single-user login: password hash in env var + signed cookie | Active |
| D8 | Folder encryption: AES-GCM in the browser, no password hash stored | Active |
| D9 | Sync model: client-generated IDs, last-write-wins, soft deletes | Active |
| D10 | Web stack: Vite + React + TypeScript; server in plain JavaScript | Active |
| D11 | Home server is only a backup target (Phase 2) | Active |

### D1 — Start from scratch
- **What:** New repository structure. `docs/prototype.jsx` is kept only as a
  reference for features and look.
- **Why:** The prototype is one 1,000-line component tied to the Claude.ai
  sandbox (`window.storage`, direct Claude API calls). Splitting it into
  modules while rebuilding is cleaner than refactoring it in place.

### D2 — Web first, then mobile, then maybe desktop
- **What:** Build a solid web app first. Mobile starts as a **PWA** (the same web
  app, installable, offline-capable). Move to Expo/React Native only if the PWA
  isn't enough. Desktop is optional (the PWA also installs on desktop).
- **Why:** One codebase serves all three for as long as possible.

### D3 — On-device AI for search and classification only
- **What:**
  - **Search:** an *embedding model* (planned: `multilingual-e5-small` through
    transformers.js, ~100 MB). Each note becomes a vector of numbers, and search
    ranks notes by how close their vector is to the query's vector.
  - **Classification:** first find the nearest *existing* folder using
    embeddings (fast, cheap). Use a small generative model (1–3B, via WebLLM)
    **only as a classifier that returns JSON**, and only when a new folder name
    or a reminder date must be produced. There is no chat UI.
  - The app must still work without AI: typing the path by hand always works.
- **Why:**
  - The home server can't run LLMs, and free hosting has no GPU.
  - On-device AI also keeps notes private.
  - The prototype sent *all notes* in one prompt for search. That breaks with
    small local models (short context) once there are more than a few dozen
    notes. Embeddings scale to thousands of notes.
- **Open:** which generative model (Qwen / Gemma / Phi) — to be picked by
  testing on real Turkish notes. Qwen is the first candidate for Turkish.
- **Privacy note:** embeddings reveal what a note is about. Embeddings of
  encrypted notes must stay on the device, or be encrypted before syncing.

### D4 — Backend: Node.js + Express
- **What:** `server/`. Stores notes, protected-folder records and the login
  session. No AI logic.
- **Why:** Small, well known, and free to host.

### D5 — Database: Postgres on Neon
- **What:** Neon free tier. The schema is in `server/db/schema.sql`.
- **Why:** Render's free services have no persistent disk (SQLite would be wiped
  on each restart), and Render's free Postgres expires after 30 days. Neon's free
  tier persists; it only "sleeps" when idle.
- **Limit to watch:** 0.5 GB of storage. Images are stored inline for now (see
  Open questions).

### D6 — One Render web service for API + web app
- **What:** `render.yaml`. The build compiles `web/` into `web/dist`, and the
  Express server serves those files next to `/api/*`. In development, Vite
  proxies `/api` to the server so it behaves the same way.
- **Why:** One origin means no CORS setup and allows the safest cookie
  settings (`SameSite=Strict`). It also means one free service instead of two.
- **Known cost:** the free service sleeps after ~15 min idle, and the first
  request after that takes ~30–60 s. Mitigated later by offline-first storage
  (D9 / roadmap).

### D7 — Single-user login
- **What:**
  - The owner's password is stored only as a **scrypt hash** in the
    `APP_PASSWORD_HASH` environment variable.
  - Login sets an **httpOnly, SameSite=Strict cookie** holding a token signed
    with `SESSION_SECRET` (HMAC-SHA256), valid for 30 days.
  - Login attempts are rate-limited to 10 per 15 minutes per IP.
  - Code: `server/src/auth.js`.
- **Why:**
  - Login must exist *before* deploying: without it, anyone who finds the URL
    can read or delete the notes.
  - A single user needs no users table or third-party auth service.
  - Built-in Node crypto means no extra dependencies.
- **Supersede when:** multiple users are needed.

### D8 — Folder encryption (fixed from the prototype)
- **What:**
  - Folder key = PBKDF2-SHA256 (**600,000** iterations) of the password and a
    random salt → AES-GCM-256.
  - To check a password, we store `checkCipher`, a known value encrypted with
    the key. The password is correct if and only if it decrypts.
  - For encrypted notes, **all** text fields (text, list item text, reminder
    label, blocks, comments) go into the ciphertext.
  - Code: `web/src/lib/crypto.ts`.
- **Why (the prototype had these problems):**
  1. It stored `sha256(password + salt)`. SHA-256 is extremely fast, so anyone
     with the database could brute-force it and skip the slow PBKDF2 step
     entirely. Now no hash is stored.
  2. It used 100k iterations; OWASP recommends 600k.
  3. It left `reminderLabel` in plaintext on encrypted notes.
  4. When a folder was locked or a note was moved into one, it dropped
     `blocks`, so inline images were lost.
- **Still visible to the server:** folder/page names (`path`), checkbox state
  and reminder time. This lets the tree and reminders work while locked.
  Accepted for now.

### D9 — Sync model
- **What:**
  - Note IDs are UUIDs generated by the client.
  - `PUT /api/notes/:id` creates or replaces a note, and is accepted only if its
    `updatedAt` is newer than the server's copy. Otherwise the server returns
    `409` with its current version (last-write-wins).
  - `DELETE` doesn't remove the row: it sets `deleted_at` (a "tombstone") and
    wipes the content.
  - `GET /api/notes?since=<time>` returns every change after that time,
    including deletions.
- **Why:** This is the groundwork for offline-first use. The app will store
  notes on the device (IndexedDB), work without a connection or while Render
  wakes up, and sync in the background. Client-side IDs let notes be created
  offline. Tombstones let other devices learn about deletions.

### D10 — Web stack
- **What:**
  - `web/`: Vite + React + TypeScript, Vitest for tests, oxlint for linting.
  - `server/`: plain JavaScript (ES modules) and Node's built-in test runner.
  - Node 22+.
- **Why:**
  - TypeScript catches mistakes in the fairly complex note model and UI.
  - The server is small; plain JS avoids a build step there.

### D11 — Home server = backup only (Phase 2)
- **What:** Later, pull a regular `pg_dump` from Neon to the home server
  (Debian 13, i5-7500T, 16 GB RAM, old 320 GB HDD, Docker, Tailscale). It hosts
  nothing in Phase 1.
- **Why:** Its hardware is too weak for LLMs and its disk is old. It is a good
  second copy of the data, but not a good primary host.

---

## 3. Open questions

- **Images:** inline base64 in note content for now (up to 10 MB per request).
  Plan: move to a separate table or object storage (e.g. Cloudflare R2 free
  tier), encrypted in the browser for protected folders.
- **Reminder delivery:** Web Push needs a server to send at the right time, but
  the free Render service sleeps. Plan: an external free scheduler (GitHub
  Actions cron or cron-job.org) calls a `/api/reminders/due` endpoint every few
  minutes. iOS delivers web push only to PWAs added to the home screen.
- **Rich-text editor:** the prototype uses `document.execCommand`, which is
  deprecated. Consider TipTap or Lexical when porting the composer.
- **Generative model choice** for classification (see D3).

---

## 4. Log

### 2026-09-22 — Project kickoff and foundation
**What we did**
- Reviewed the prototype and the original summary. Agreed on decisions D1–D11.
- Created the repository layout:
  ```
  server/   Express API (auth, notes, protected folders) + Postgres schema
  web/      Vite + React + TS app (login screen + connection check for now)
  docs/     this log, the prototype, the original summary
  render.yaml, CLAUDE.md, README.md
  ```
- **Server:**
  - `GET /api/health`
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
  - `GET /api/notes[?since=]`, `PUT /api/notes/:id`, `DELETE /api/notes/:id`
  - `GET`, `PUT /:pathKey` and `DELETE /:pathKey` under `/api/protected-folders`
  - Migrations run on every start (the schema is idempotent).
- **Web:**
  - Typed data model (`src/lib/types.ts`), API client (`src/lib/api.ts`),
    folder-tree helpers (`src/lib/tree.ts`) and the fixed encryption module
    (`src/lib/crypto.ts`).
  - Login screen, and a home screen that confirms the server and database are
    reachable.

**How it was verified**
- Server: 5 tests (`npm test`). The API tests ran against a real local
  Postgres, covering login, create/update/conflict/delete/sync and protected
  folders.
- Web: 7 tests (encryption round-trip and wrong password, tree helpers).
  `npm run build` and `npm run lint` pass.
- Manual smoke test: the server served the built web app, `/api/notes` returned
  401 without login, and login followed by listing notes worked.

**Next**
1. Create a Neon project, fill in `server/.env`, run locally (see README).
2. Deploy to Render with `render.yaml`.
3. Port the notes UI from the prototype into components (tree sidebar,
   composer, note list, password modal, lightbox).
4. Offline-first storage: IndexedDB plus background sync.
5. AI: embeddings search, then classification.
6. PWA: manifest, service worker, install prompt.
7. Reminders via Web Push and an external cron.
8. Phase 2: backups to the home server.

### 2026-09-22 — Windows setup notes
**What:** Added a "Get the code" step and Windows PowerShell notes to the README.
**Why:** The first local setup on Windows failed. Windows PowerShell 5 doesn't
accept `&&`, and the `server/` folder had been created by hand instead of
cloning the repository.
**How:** Commands are now one per line. The README also covers PowerShell
execution policy, `$` inside quotes, and UTF-16 `.env` files.

### 2026-09-22 — First local run against Neon
**What:** The owner ran the server locally on Windows against the real Neon
database. `npm run migrate` created the tables, and `/api/health` returned
`{"ok":true,"db":"up"}`.
**Problems hit and fixes:**
- PowerShell blocked `npm.ps1`. Fixed with
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- Neon returned `password authentication failed`: `.env` still had the old
  password after a reset. Fixed by using the copy button in Neon's Connect
  dialog, which copies the real password instead of the on-screen `****`.
- `pg` printed an SSL warning for `sslmode=require`. `sslmode=verify-full` is
  equivalent and silences it (added to the README).
- The Neon password and `SESSION_SECRET` were shared in a chat, so both were
  rotated.
**Next:** run the web app locally and log in, then deploy to Render.

### 2026-09-22 — Render build fix
**What:** The Render build now runs `npm ci --include=dev` in `web/`.
**Why:** `render.yaml` sets `NODE_ENV=production`, which makes a plain `npm ci`
skip devDependencies. The web build needs those (Vite, TypeScript), so the
first deploy would have failed.
**How verified:** Ran the exact build command with `NODE_ENV=production` in a
clean checkout. Install and build both succeeded.

### 2026-09-22 — Notes interface (ported from the prototype)
**What we did:** Replaced the placeholder home screen with the real notes UI.
- **Folder tree** (sidebar): counts, expand/collapse, select to filter, lock
  icons, and drag a note onto a folder to move it.
- **Composer** (bottom bar):
  - Text, and a path with autocomplete from existing folders. Selecting a
    folder pre-fills the path.
  - List-item toggle, reminder date/time, and images (button, paste or drop).
  - Ctrl+Enter saves.
- **Note cards:**
  - List-item checkbox, images with a lightbox, reading mode, and comments.
  - Editing changes text, path (so it also works as "move") and reminder.
  - Delete asks for confirmation first.
- **Locked folders:**
  - The password is asked twice when a folder is first protected, with a
    warning that a forgotten password means lost notes.
  - Protecting a folder encrypts the notes already in it. Locking hides them.
  - Nested protected folders are refused, for simplicity.
- **Search:** case-insensitive with Turkish rules (İ/ı). It covers text,
  comments and path. Locked notes are skipped.
- **Reminders strip:** from 24 hours ago onward. Overdue items are shown in red.
- **Session handling:** an expired login returns to the login screen. An HTML
  error page (e.g. while Render wakes up) no longer crashes the app.

**How:**
- `src/state/store.ts` is a small external store used through
  `useSyncExternalStore`. Async actions always see the latest data, which
  avoids the stale-state problems of the prototype's single component.
- Every change is applied locally first, then `PUT` to the server. On a 409 the
  server's version replaces the local one (D9).
- Pure note logic lives in `src/lib/notes.ts` (seal/open, blocks, search).
- Images are downscaled to at most 1600 px (JPEG) before saving, to spare
  Neon's 0.5 GB.

**Simplified compared with the prototype (on purpose, for now):**
- The composer is a plain textarea plus image attachments. Images appear after
  the text, not inline, and rich paste from Word/web pages is not supported yet.
- No AI path suggestion yet: the path is typed. The AI will plug into the
  composer later (D3).
- Comments have no "source" (user/Claude/ChatGPT). With no chatbot (D3) it
  isn't needed.

**How it was verified:**
- Unit tests: 12 web tests (5 new, for sealing, opening, blocks and search),
  plus typecheck, lint and build.
- Browser test with Playwright/Chromium against a real Postgres and the built
  app served by the server: 27 checks passed.
  - Covered: login, adding notes (image, list item, reminder), check/uncheck,
    search, folder filter.
  - Protecting a folder, including checking in the database that there is no
    plaintext left, not even the reminder label.
  - Locking, a wrong and a right folder password, and a new note in a protected
    folder being encrypted.
  - Editing a note's path to move it out of a protected folder (it is
    decrypted), comments, drag & drop moving (images kept).
  - Reload persistence, and deletion leaving a tombstone.
  - No horizontal scroll at phone width (390 px), and an expired session
    returning to login.
- The login rate limiter also triggered during repeated test runs, as designed.

**Next:**
1. The owner checks the Render deploy (https://notex-r2zk.onrender.com).
2. Offline-first: IndexedDB copy and background sync (D9).
3. AI: embedding search, then path suggestion in the composer (D3).
4. PWA: manifest, service worker, installable.

### 2026-09-23 — Save retries after "Değişiklik sunucuya kaydedilemedi"
**What happened:** When adding notes locally, the owner saw the red banner
"Değişiklik sunucuya kaydedilemedi". The database showed that the notes *had*
been saved, so a single request had failed (most likely while Neon's compute
was waking up), and the banner then never cleared.
**Real problem found:** a failed save was never retried. The change stayed on
screen but was lost on reload.
**What we changed:**
- `web/src/state/store.ts`: unsaved changes are kept in a queue (newest version
  per note) and retried with growing delays (2 s → 30 s). The banner shows the
  reason (HTTP code or "sunucuya ulaşılamadı") and clears once everything is
  saved. A 401 asks the user to log in again instead of retrying. The browser
  warns before closing the tab while saves are pending. Logout clears the queue.
- `web/src/lib/api.ts`: non-JSON error responses (e.g. the dev proxy's error
  page) no longer throw a parse error.
- `server/src/db.js`: `pool.on("error")` handler, so Neon closing an idle
  connection can't crash the server.
**How verified:** 2 new store tests (a failed save is retried and the error
clears; only the newest edit is retried). 14 web tests pass, plus typecheck and
lint. Diagnosis: the exact insert was replayed in a rolled-back transaction on
Neon, and an authenticated save through the Vite proxy returned 200.
**Next:** proper offline-first storage (IndexedDB) so queued saves also survive
a page reload.
