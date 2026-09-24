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
| D3 | AI runs in the browser; AI is for search + classification only, no chatbot | Superseded by D15 (no chatbot still applies) |
| D4 | Backend: Node.js + Express, handles storage/auth only | Active |
| D5 | Database: Postgres on Neon (free tier) | Active |
| D6 | Hosting: one Render web service serves both API and web app | Active |
| D7 | Single-user login: password hash in env var + signed cookie | Superseded by D16 |
| D8 | Folder encryption: AES-GCM in the browser, no password hash stored | Active |
| D9 | Sync model: client-generated IDs, last-write-wins, soft deletes | Active |
| D10 | Web stack: Vite + React + TypeScript; server in plain JavaScript | Active |
| D11 | Home server is only a backup target (Phase 2) | Active |
| D12 | Embedding model: multilingual-e5-small, opt-in, in a Web Worker | Superseded by D15 |
| D13 | Category model: Gemma-2-2B via WebLLM (WebGPU) creates folders itself | Superseded by D15 (prompt kept) |
| D15 | AI runs on the server via Cloudflare Workers AI (free tier) | Active |
| D16 | Multiple users, "Sign in with Google" only, open sign-up with per-user limits | Active |
| D14 | Reminders are detected from text by a rule-based Turkish parser | Active |
| D17 | Dark mode through CSS variables; Sistem/Açık/Koyu remembered per browser | Active |

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

### D12 — Embedding model: multilingual-e5-small
- **What:**
  - Model `Xenova/multilingual-e5-small`, 8-bit (~118 MB, downloaded once from
    Hugging Face and cached by the browser). It runs in a Web Worker
    (`web/src/ai/`), so the UI never freezes.
  - AI is **opt-in**: the ✨ AI button in the header turns it on, shows the
    download progress, and is remembered per browser.
  - **Folder suggestion:** each existing page (note path) is scored 60% by its
    two closest notes and 40% by its name. The top 3 are shown as chips, and
    the best one fills the path until the user types a path or picks a folder.
  - **Search:** results are ranked by meaning. Notes containing the typed words
    get a bonus and stay on top. Only notes close to the best match are shown
    (e5 scores are compressed, so the window is relative: best − 0.035, max 12).
  - Vectors of plain notes are cached in IndexedDB (keyed by a hash of the
    text). Vectors of encrypted notes stay in memory only.
- **Why (measured with `web/scripts/eval-ai.mjs`, 28 Turkish notes in 11 folders,
  16 new notes, 10 searches):**

  | Model | Download | Right folder 1st / in top 3 | Search hits |
  |---|---|---|---|
  | **multilingual-e5-small** | **118 MB** | 11 / **16 of 16** | 11/20 |
  | paraphrase-multilingual-MiniLM | 118 MB | 11 / 13 | 12/20 |
  | paraphrase-multilingual-mpnet | 279 MB | 13 / 15 | 13/20 |
  | EmbeddingGemma-300m (q4) | 197 MB | 13 / 16 | 12/20, ~7× slower |

  - e5-small was best where it matters most (the right folder is among the 3
    chips), smallest and fastest, which matters for phones (D2).
  - No model separates relevant from unrelated notes with a clean score
    threshold, so search ranks rather than filters. Keyword matching covers
    exact words.
  - Including the folder path in the embedded note text improved folder
    suggestions.
- **Update:** inventing new folder names is now done by the category model
  (D13), and reminder dates by a parser (D14). The embedding suggestions stay
  as alternatives and as the fallback without WebGPU.
- **Revisit when:** a better small multilingual model appears. Re-run the eval
  script with it.

### D13 — Category model: Gemma-2-2B creates folders itself
- **What:**
  - The owner's requirement: categorizing is the point of the app, and it must
    work from an **empty** notebook, with AI creating the categories itself.
  - `gemma-2-2b-it-q4f16_1-MLC` via WebLLM (~1.5 GB, downloaded once, cached in
    IndexedDB). It runs on the GPU through WebGPU in a Web Worker
    (`web/src/ai/llm.ts`, `llm.worker.ts`). GPUs without 16-bit floats use
    the q4f32 build.
  - It answers JSON `{"konu", "path"}`, constrained by a JSON schema. The
    prompt (`SYSTEM_PROMPT`) has 10 varied Turkish examples and the list of
    existing folders (most-used first, max 80), with the rule "same topic →
    reuse the exact path; similar category but different topic → new
    subfolder".
  - In the composer, ~0.8 s after typing stops, the answer fills the path and
    becomes the first chip (tagged "yeni" if it is a new folder). Similar
    existing folders from embeddings (D12) follow as alternatives. Saving waits
    while the answer for the current text is pending.
  - Turned on together with the ✨ AI button. Without WebGPU (older phones or
    browsers), only the embedding suggestions are used, and the button tooltip
    says so.
- **Why (measured in Chrome on the owner's PC, Radeon RX 6600, 14 Turkish notes
  classified one after another from an empty notebook):**
  - First prompt ("reuse existing folders if possible", examples with
    existing folders): every model collapsed. Qwen3.5-2B put all 14 notes into
    2 folders, and Qwen3-1.7B used the note text as the folder name.
  - "Topic first" prompt (`konu` before `path`, 10 varied examples):
    Gemma-2-2B gave sensible folders for 13 of 14 notes (Sağlık / Randevu,
    Eğlence / İzlenecekler, Alışveriş / Market, Ev / Tesisat, Seyahat / Planlar,
    Finans / Faturalar …) and reused them for related notes. It takes
    ~1.5–2 s per note. Qwen3-4B was similar in quality but 2× slower and a
    bigger download. Qwen3-1.7B made spelling mistakes in its names.
  - Merging near-duplicate names with embeddings was tested and rejected: the
    similarity of short folder names doesn't separate "same" from "different"
    (e.g. Market~Temizlik 0.96 vs Filmler~İzlenecekler 0.95).
- **Known limits:** a note is occasionally misfiled (e.g. an app idea filed
  under shopping). The chips make the fix one click. Needs WebGPU; a 1.5 GB
  download is heavy on mobile data.
- **Revisit when:** better small multilingual models reach WebLLM. Learning
  from the user's corrections (feeding them back as examples) is a natural
  next step.

### D14 — Reminders: rule-based Turkish date parser
- **What:** `web/src/lib/reminder.ts` finds "yarın 15:00", "perşembe akşam 7'de",
  "3 gün sonra", "25 Ekim'de", "30.09", "yarım saat sonra" and similar in the
  text. The composer shows a chip "Hatırlatma: 24 Eyl 15:00 (“Yarın 15:00”)"
  that can be dismissed or replaced with a hand-picked time (clock button).
- **Why not the language model:** date arithmetic is exactly what small models
  get wrong. A parser is instant, testable and works without AI. The owner
  asked for detection from text (not notifications) as the fix for
  "reminders don't work".
- **Details:** JavaScript's `\b` doesn't understand Turkish letters, so the
  patterns use Unicode-aware boundaries. A one-digit month needs a year, so
  "React 19.2" isn't a date. Without a time, 09:00 is used; with only a time,
  today if it is still ahead, otherwise tomorrow.
- **Not yet:** notifications when the time comes (see Open questions).

### D15 — AI runs on the server via Cloudflare Workers AI (free tier)
- **Supersedes** D3 (on-device AI), D12 and D13. From D3 the rule "search and
  classification only, no chatbot" still applies. The D13 prompt design is
  kept.
- **Why the change:** the owner asked why the app is in the cloud if AI runs
  locally, and whether every device can run it.
  - The category model needed WebGPU and ~2 GB of GPU memory. That's fine on
    the owner's PC, but unrealistic for most phones and impossible on the home
    server, with a 1.5 GB download per device.
  - The owner accepted sending note text to an AI service, since notes are
    classified before they are locked, and locked notes are never sent.
- **What:**
  - `server/src/ai/`: Cloudflare client (`cloudflare.js`), prompts
    (`prompts.js`) and features (`service.js`). Routes: `POST /api/ai/classify`
    and `GET /api/ai/search` (login required, 40 requests/min, 503 when
    Cloudflare isn't configured, so the app works without AI).
  - **Folders:** Mistral Small 3.1 (24B), with Qwen3-30B as an automatic
    backup when it fails. The existing folders come from the database. The
    answer includes up to 3 similar existing folders (by vectors) as
    alternatives.
  - **Search:** bge-m3 vectors shortlist the 20 closest notes, then Mistral
    keeps the relevant ones, best first. If that step fails, the vector order
    is used. The browser puts exact-word matches first.
  - **Vectors** are stored in the `note_vectors` table (REAL[], cosine
    computed in JS, fine for one user). They are refreshed lazily when a note's
    text changes (`text_hash`). Encrypted and deleted notes never get vectors,
    and their rows are removed.
  - **Privacy:** only plain notes are sent. The composer asks the AI only
    while the path is left to AI, so a note written into a chosen (e.g. locked)
    folder is never sent. Cloudflare says it doesn't use customer content for
    training.
  - **Cost control:** the composer asks ~1.2 s after typing stops, and
    answers are cached per text. The browser test used 15 AI requests for
    11 notes and 5 searches.
  - The browser no longer downloads any model. The bundle shrank from
    ~40 MB of AI assets to 266 KB total, and the ✨ AI button is gone.
- **Measured** (scripts `server/scripts/eval-cloud-ai.mjs` and
  `eval-cloud-search.mjs`, same Turkish notes as before):

  | Folders (17 notes, empty notebook) | Sensible | Speed | Neurons/note | Free notes/day |
  |---|---|---|---|---|
  | **Mistral Small 3.1 24B** | **17/17** | 1.2 s | ~24 | ~425 |
  | Llama 3.3 70B | 15/17 | 0.8 s | ~21 | ~470 |
  | Qwen3 30B (with /no_think) | 14/17 | 0.45 s | ~4 | ~2,500 |
  | gpt-oss-20b | 15/17 | 2.8 s | ~20 | ~500 |
  | (browser) Gemma-2-2B | ~13/14 | 1.5–2 s | – | – |

  | Search (10 queries, 20 expected notes) | Found | Extra |
  |---|---|---|
  | bge-m3 vectors only | 11/20 | many |
  | **bge-m3 shortlist + Mistral re-rank** | **16/20** | 7 (mostly sensible) |

  - Free allowance: 10,000 neurons/day. Searches cost ~10 neurons, and
    vectors almost nothing.
  - Different Workers AI models return JSON differently (a parsed object,
    text, or OpenAI-style `choices`). `extractJson` handles all of them.
    Qwen3 needs `/no_think`, otherwise it spends its token budget thinking.
- **Setup:** `CLOUDFLARE_ACCOUNT_ID` (the 32 characters in the dashboard URL)
  and `CLOUDFLARE_API_TOKEN` ("Workers AI" template, *Account Resources:
  include your account*), in `server/.env` and in Render.
- **Revisit when:** the free allowance isn't enough, or a better model appears
  in Workers AI. Re-run the eval scripts. Groq's free tier is a possible
  second provider.

### D16 — Multiple users with Google sign-in
- **Supersedes** D7 (single password).
- **Owner's choices:** anyone with a Google account can sign up, and Google
  replaces the password login.
- **What:**
  - **Login:** Google Identity Services shows the "Sign in with Google"
    button (`web/src/lib/google.ts`). The browser posts the Google ID token to
    `POST /api/auth/google`. The server verifies it with
    `google-auth-library` against `GOOGLE_CLIENT_ID`, accepts only verified
    emails, then finds or creates the user (`server/src/users.js`) and sets
    the same signed, httpOnly, SameSite=Strict cookie as before, now carrying
    the user id. `GET /api/auth/config` gives the browser the client ID;
    `/api/auth/me` returns name, email and photo.
  - **Data:** the `users` table. `notes.user_id` and
    `protected_folders.user_id` are set, and every query is limited to the
    signed-in user. Protected folder names are unique per user (two users can
    both lock "Kişisel"). A note id that belongs to someone else can't be
    overwritten (403). Folder encryption is unchanged, since keys never leave
    the browser.
  - **Migration:** existing rows had no owner. The first sign-in with
    `OWNER_EMAIL` takes them over. Nobody else ever sees them.
  - **Limits, because sign-up is open and everyone shares the free tiers:**
    - AI: `AI_DAILY_LIMIT` requests per user per day (default 150), in the
      `ai_usage` table, plus 40/min. Invalid requests don't count.
    - Storage: 50 MB of note content per user (inline images included); Neon's
      free tier is 0.5 GB in total.
  - AI only sees the signed-in user's notes and folders (`service.js`).
- **Why Google only:** there is no password to store, leak or forget, and no
  e-mail verification or reset flow to build. The owner uses Google anyway.
- **Setup:** a free Google Cloud project with an OAuth client of type "Web
  application". Its JavaScript origins are the Render URL and
  `http://localhost:5173` (see README). Then set `GOOGLE_CLIENT_ID` and
  `OWNER_EMAIL` in `server/.env` and Render. `APP_PASSWORD_HASH` is no longer
  used.
- **Revisit when:** there are many users (per-user limits may need an admin
  view), or someone without a Google account needs access.

### D17 — Dark mode through CSS variables, choice per browser
- **Decision:** every color in `web/src/index.css` is a CSS variable in
  `:root`. The dark theme only redefines those variables; components don't
  know about themes.
  - Three choices, cycled by a header button: **Sistem** (follows the device,
    the default), **Açık** and **Koyu**.
  - The choice is stored in the browser's localStorage (`notex-theme`), not
    on the server.
  - A tiny inline script in `web/index.html` sets `data-theme` on `<html>`
    before the page draws, so a dark page never flashes white on load.
- **Why:** variables keep dark mode to one block of CSS instead of edits in
  every component. localStorage needs no schema or API change, and the device
  setting already covers most people. It's per browser on purpose: a phone
  and a laptop can reasonably differ.
- **Rule for new UI:** don't write literal colors in CSS or components; add a
  variable with a light and a dark value.
- **Revisit when:** users want the choice to follow their account across
  devices (then save it on the `users` row).

---

## 3. Open questions

- **Images:** inline base64 in note content for now (up to 10 MB per request).
  Plan: move to a separate table or object storage (e.g. Cloudflare R2 free
  tier), encrypted in the browser for protected folders.
- **Reminder delivery:** Web Push needs a server to send at the right time, but
  the free Render service sleeps. Plan: an external free scheduler (GitHub
  Actions cron or cron-job.org) calls a `/api/reminders/due` endpoint every few
  minutes. iOS delivers web push only to PWAs added to the home screen.
- **Rich-text editor:** `web/src/components/RichEditor.tsx` is a small
  contentEditable editor (text + images only) using `document.execCommand`,
  which is deprecated but still supported everywhere. Consider TipTap or
  Lexical if formatting (bold, lists) is wanted.
- **Reminder notifications:** reminders are now detected (D14) and listed, but
  nothing pops up at the time yet.

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

### 2026-09-23 — AI: search by meaning and folder suggestions
**What:**
- Picked the embedding model by measurement (D12). Four models were compared
  on realistic Turkish notes.
- `web/src/ai/`:
  - `vector.ts`: ranking and suggestion logic (pure, tested).
  - `embed.worker.ts` and `protocol.ts`: the model in a Web Worker.
  - `engine.ts`: on/off setting, download progress, and the vector cache
    (memory + IndexedDB, plain notes only).
  - `useAi.ts`: React hooks.
- UI:
  - ✨ AI button in the header (confirm dialog, download %).
  - Search ranks by meaning ("Anlamına göre sıralandı").
  - The composer shows 3 folder chips and auto-fills the best one.
- Server: gzip compression (the 27 MB WASM runtime goes over the wire as
  ~7 MB) and one-year immutable caching for `/assets`.
- The main bundle grew by only 10 KB; the AI code loads only when AI is on.

**How verified:**
- 5 new unit tests (19 web tests in total), plus typecheck, lint and build.
- Browser test (Playwright/Chromium, real model, mocked API):
  - First download and load: 14 s. After a reload: 3 s, from the browser
    cache.
  - Folder suggestions: the right folder was among the chips for 6 of 6 new
    notes, and auto-filled for 4 of 6.
  - Saving uses the suggested path, a typed path is never overwritten, and
    clicking a chip sets the path.
  - Search: "film", "doktor", "evde bozulan şeyler" and "toplantı" found the
    expected notes at the top.
  - No horizontal scroll at phone width, and no page errors.
- Server: health, gzip and cache headers checked against the built app.

**Next:** try it on real notes. Then a generative model for new folder names
and reminder dates, offline-first storage, and PWA.

### 2026-09-23 — AI creates categories, reminders from text, pasting web content
**Owner feedback on the first AI version:** suggestions can't be judged with
one category, and AI must create categories itself. The input area is too
small for long text, images from web pages are lost when pasted, and reminders
aren't detected from the text.

**What we did:**
- **Categories (D13):** compared 4 on-device language models × 3 prompt
  designs in real Chrome with WebGPU. Picked Gemma-2-2B with a "topic first"
  prompt. The composer fills the folder by itself; the chips show the AI's
  folder (tagged "yeni" when new) plus similar existing folders.
- **Reminders (D14):** rule-based Turkish parser, 35 tests. There is a chip in
  the composer to dismiss it or set the time by hand.
- **Pasting web content:** `web/src/lib/paste.ts` turns pasted HTML into text
  and image blocks in order (largest srcset image, lazy-load sources, relative
  links). `RichEditor` shows placeholders and loads each image directly, or
  through the new `GET /api/image-proxy` (login required; SSRF-guarded:
  public addresses only on every redirect, images only, 8 MB max, 10 s
  timeout). Saving waits for images.
- **Editor:** grows with the text up to 40% of the screen, then scrolls. There
  is a full-screen writing mode (Esc leaves). Editing a note uses the same
  editor, so images stay in place. Images in notes are shown as their own
  block.
- **Bug found by the browser test:** after saving, the next note briefly
  showed the previous note's AI folder, and a quick save would have used it.
  A suggestion now only applies to the text it was made for, and saving waits
  for the current answer.

**How verified:**
- Web: 62 unit tests (reminder parser 35, paste 5, category-model helpers 3,
  plus existing). Typecheck, lint and build pass.
- Server: image proxy tests (auth, private-address and redirect blocking,
  non-image, size limit, upstream errors).
- Browser test in real Chrome with WebGPU (mocked API, empty notebook):
  22 checks passed.
  - Both models ready in 12 s from cache (47 s on the first download).
  - From an empty notebook, 7 notes got 4 sensible folders:
    Eğlence / İzlenecekler (film + series), Alışveriş / Market (milk +
    detergent), Ev / Tamirat (faucet + boiler), Finans / Faturalar. The dentist
    note went to Sağlık / Randevu.
  - "Yarın 15:00 …" was saved with a reminder for tomorrow 15:00, and a
    dismissed reminder is not saved.
  - Pasted HTML with 2 images: one loaded directly, the CORS-blocked one
    through /api/image-proxy. Saved as text | image | text | image | text.
  - The editor grows to 40% of the screen, and full-screen mode works (Esc
    leaves). Editing a note keeps its images.
  - No horizontal scroll at phone width, and no page errors.
  - A miss: a pasted cat-care article was filed under Ev / Tamirat. That's the
    kind of mistake the chips are there to fix.

**Next:** try it with real notes; reminder notifications; learning from the
user's folder corrections; offline-first; PWA.

### 2026-09-23 — AI moves to the server (Cloudflare Workers AI, D15)
**Why:** the category model needed a strong GPU (WebGPU, ~2 GB), so it
couldn't run on most phones, and every device had to download 1.5 GB. The
owner asked to run the AI in the cloud for free, and accepted that note text
is sent there before a note is locked.

**What we did:**
- Compared the Workers AI models on the same Turkish notes. Mistral Small 3.1
  did best (17/17 sensible folders) and is used for folders and search
  re-ranking, with Qwen3-30B as the backup. Search uses bge-m3 vectors plus a
  re-rank step (16/20 vs 11/20 with vectors only).
- New server code: `src/ai/`, `routes/ai.js`, and the `note_vectors` table.
- Removed the in-browser AI: both models, the workers, WebLLM and
  transformers.js, and the ✨ AI button. Search shows word matches first,
  then meaning matches.
- Server tests now also run on Windows without a Postgres install:
  `test/helpers/db.js` starts a throwaway database via `embedded-postgres`
  (with the C locale: initdb rejects "Turkish_Türkiye.1252"). Before this, the
  database tests were always skipped on the owner's PC.
- Setup problems solved on the way: the first API token wasn't linked to the
  account (fixed with *Account Resources*), and the Account ID in `.env` was a
  different ID (the right one is in the dashboard URL).

**How verified:**
- Server: 16 tests, all running locally now. They cover the API with a real
  database, the image proxy, and AI with a fake model: folder pick and
  existing spelling, backup model, encrypted notes never sent and without
  vectors, vectors refreshed after edits, re-rank and its fallback, login and
  503 without configuration.
- Web: 54 tests, plus typecheck, lint and build.
- Browser test against the real server, real Cloudflare AI and a throwaway
  database, starting from an empty notebook:
  - 9 notes → 6 folders (Eğlence / İzlenecekler, Alışveriş / Market,
    Ev / Tamirat, Yazılım / Notex, Yemek / Tarifler …); ~2.4 s per note
    including the typing pause.
  - Miss: "Kombi bakımı yaptırılmalı" went to a new "Araba / Bakım".
    Ev / Tamirat was offered as the second chip.
  - Search: "yemek" and "uygulama fikirleri" were exact. "evde bozulan
    şeyler" missed the boiler note (because of the misfiling). "film" left out
    the series.
  - Reminder, a real web image through the proxy, phone width, and no page
    errors all passed. 15 AI requests in total.

**Next:** add the two Cloudflare values in Render, then deploy. Later: learn
from the owner's folder corrections (a misfile fixed once shouldn't repeat),
and reminder notifications.

### 2026-09-23 — In-app dialogs; Google login with multiple users (D16)
**What:**
- Deleting a note now asks with an in-app dialog (`ConfirmDialog`, the note's
  text as preview, red "Sil", Esc/Vazgeç cancels) instead of the browser's
  popup.
- Google sign-in for everyone, with per-user data (D16). The password login
  and `hash-password` script are removed.

**How verified:**
- Server: 20 tests, including:
  - Google login with forged tokens rejected.
  - The owner takes over the old notes; a stranger doesn't.
  - Users can't see, overwrite or delete each other's notes or folders.
  - The same folder name can be locked by two users.
  - The storage quota; AI seeing only the user's own notes; the daily AI
    limit.
- Web: 54 tests, plus typecheck, lint and build.
- Browser test with a fake Google script: login screen, credential posted,
  user shown in the header, delete dialog (Esc cancels, Sil deletes, no
  browser popup), and logout (Google auto sign-in disabled).

**Next:** the owner creates the Google OAuth client and sets `GOOGLE_CLIENT_ID`
and `OWNER_EMAIL` locally and in Render, then we deploy. The server doesn't
start without `GOOGLE_CLIENT_ID`, so the variables must be set first.

### 2026-09-23 — Search highlighting, reading mode, reminder words and picker
**Owner feedback:** highlight search results; search by meaning seemed weak
(LSA/Cloudflare notes not found for software); a Word-like reading mode;
"hatırlat" should create a reminder, also without a time; a manual reminder
without the year, 1 hour later by default, with quick options; no date field
when editing.

**Investigation of "search by meaning is weak":**
- On the owner's real notes, the server search worked: "yazılım" found the
  Cloudflare note and both "Sistem Tasarım / LSA" notes.
- An experiment with AI-written topic tags per note didn't improve results
  (26/27 either way on 20 notes), so it was not built.
- The real causes were in the app:
  1. Search only covered the folder selected in the tree.
  2. AI search errors (limits, timeouts) were silently hidden.
  3. A search fired at every typing pause, wasting calls and hitting limits.

**What we did:**
- Search covers all notes (with a hint when a folder is selected) and waits
  0.8 s after typing stops. AI errors are shown. Matched words are highlighted
  (`lib/highlight.ts`, Turkish-aware), and AI-only results get an "anlamca
  ilgili" label. The re-ranker sees 400 characters per note instead of 200.
- Reading mode (`Reader.tsx`): a full-screen, centered 760 px page in a
  serif font, A−/A+ text size (remembered), ←/→ to the previous or next note,
  Esc to close. It replaces the old inline "expanded" card.
- Reminders: "hatırlat", "anımsat", "unutma" and "remind…" create a reminder.
  A date in the text wins; otherwise it is undated. New column
  `notes.is_reminder` and API field `isReminder`. The reminders panel lists
  undated ones under "Tarihsiz", and ✓ marks a reminder done.
- Manual reminder picker (`ReminderPicker.tsx`): quick choices (1 saat,
  2 saat, Bu akşam, Yarın 09:00, 3 gün, 1 hafta, Tarihsiz), or a day list
  without a year plus a time. It opens at 1 hour later. The composer and note
  editing both use it.
- Editing: the date field is gone. Edited notes show "düzenlendi <time>".
- Fixes found on the way:
  - The delete preview used `/s+/` instead of `/\s+/` (every "s" became a
    space), a slip from an earlier shell edit.
  - Going back to "Tümü" kept the previously selected folder as the
    composer's path; now AI chooses again.

**How verified:**
- Server: 21 tests (new: dated and undated reminders).
- Web: 67 tests (new: reminder words, presets, highlighting), plus typecheck,
  lint and build.
- Browser test (mocked API), 24 checks: global search with a folder selected,
  highlighting and labels, error message, reader size/navigation/Esc,
  undated reminder saved and listed, picker (no year, 1 hour default, preset,
  custom time saved), ✓ done, edit without a date field and "düzenlendi",
  delete preview intact, phone width.

### 2026-09-24 — Repeating reminders, a Reminders page, better moving of notes
**Owner requests:** repeating reminders ("Kredi kartı ekstresi her ayın 28'i"),
the next 6 months of reminders, reminders on their own page with their own
categories (not in the notes tree), and drag & drop "not working well".

**What we did:**
- **Repeating reminders:**
  - New columns `notes.reminder_repeat` (daily/weekly/monthly/yearly,
    counted from `reminder_at`) and `notes.reminder_done_until`.
  - The parser understands "her ayın 28'i", "her ay 15'inde", "aylık",
    "her pazartesi", "haftalık", "her gün / sabah / akşam", and "her yıl
    5 Mart".
  - `lib/recurrence.ts`: month ends use the last day ("her ayın 31'i" → 30th
    or 28th), and 29 February becomes 28 February in other years.
  - The picker gets a "Tekrar" choice.
- **Reminders page** (`RemindersPage.tsx`, tabs "Notlar | Hatırlatmalar",
  `#hatirlatmalar` in the URL):
  - Categories on the left. The agenda (`lib/agenda.ts`) has Gecikmiş, the
    next 6 months by month, Tarihsiz, and Tamamlananlar.
  - Monthly and yearly reminders show every occurrence, weekly ones 4 weeks,
    daily ones only the next.
  - ✓ on a repeating reminder completes only that occurrence.
  - Reminders are no longer in the notes tree or list (search still finds
    them). The notes page shows a small "Yaklaşan" strip with a link.
- **Moving notes:**
  - The problems:
    1. The whole card was draggable, so text couldn't be selected.
    2. The drop highlight flickered, because dragleave fires over a row's
       children.
    3. Collapsed subfolders couldn't be targets.
    4. Touch screens don't support HTML5 drag & drop.
  - The fixes:
    1. A grip handle is the only thing that drags.
    2. Drag enter/leave are counted, so the highlight doesn't flicker.
    3. Hovering 0.6 s opens a collapsed folder.
    4. A new "Taşı" menu (filterable folder list, or type a new path) works
       everywhere.

**How verified:**
- Server: 22 tests (new: repeat validation).
- Web: 90 tests (new: recurrence 7, repeat phrases 11, agenda 5), plus
  typecheck, lint and build.
- Browser test (mocked API), 24 checks:
  - Reminders are not in the tree; "her ayın 28'i" is saved as monthly and
    shown 6 times; ✓ skips one occurrence; the category filter works;
    switching to weekly shows 4 weeks; the page survives a reload.
  - Text in cards is selectable; dragging by the handle opens a collapsed
    folder and drops into it; the drag state is cleared.
  - "Taşı" works both with a new path and with a picked folder.
  - Phone width works.

### 2026-09-24 — Moving keeps folder names; moving and renaming folders
**Owner request:** moving an "LSA" note from "Sistem Tasarım" into
"Yazılım" should give "Yazılım / LSA", not just "Yazılım". Discussed first.
The owner chose: keep the note's folder by default with a one-click
alternative, and also move and rename whole folders.

**What we did:**
- `lib/move.ts` (8 tests):
  - Rule 1: a moved note keeps its last folder name (no "LSA / LSA"; a
    one-level note goes to the target).
  - Rule 2: a folder moves with its whole branch; renaming is a move to the
    same parent; a folder can't move into itself.
- Note moves (drag onto the tree, or "Taşı" → pick a folder) follow rule 1.
  A typed path in "Taşı" is used exactly. A toast offers "Sadece X içine koy"
  and "Geri al".
- Folders: drag a folder's name onto another folder (or onto "Tümü" for the
  top level), or use "⋯" → "Yeniden adlandır" / "Taşı…". The toast shows how
  many notes moved, with "Geri al" unless the move merged into an existing
  folder.
- `store.moveFolder` handles protected folders:
  - A protected folder moves with its password. Its notes keep their cipher,
    because the key comes from password + salt, not the path. Its record is
    saved under the new path, then the old one is deleted.
  - Notes entering or leaving a protected folder are re-encrypted after
    asking for the password.
  - Nesting protected folders is refused, and a cancelled password changes
    nothing.
- "düzenlendi" now comes from `content.editedAt`, set only when the text
  changes. Moving a note no longer marks it as edited.

**How verified:**
- Web: 104 tests (new: move rules 8; store.moveFolder 6, with real
  encryption: plain branch, merge, into itself, protected folder moves with
  its password, a note entering protection gets encrypted, nesting and
  cancelled password).
- Browser, 15 checks: folder drag and undo, note drag → "Yazılım / LSA" →
  "Sadece Yazılım içine koy", "Taşı" pick and undo, typed exact path, rename,
  "En üst seviye", folder dropped on "Tümü", menu excludes self and
  subfolders.
- The earlier browser tests (24 + 24 checks) pass after updating them for
  this batch's intended changes.

### 2026-09-24 — Guided tour
**What:** A built-in tour (`components/Tour.tsx`, steps in `lib/tour.ts`, no
library).
- The page dims and one element at a time is highlighted with a short Turkish
  explanation. There are 10 steps: welcome, writing/pasting, AI choosing the
  folder, reminders from text, full-screen writing, folder tree
  (drag/rename/lock), meaning search, note buttons, the Reminders page, and
  how to reopen the tour.
- Navigation: Geri/İleri/Bitir, ← → Enter, Esc. On phones the card sits at
  the top or bottom, away from the highlighted element.
- It opens by itself on a user's first visit (remembered per browser in
  localStorage, `notex-tour-done:<userId>`) and any time from the new ?
  button. Elements are marked with `data-tour="…"`, so styling changes don't
  break it.

**Bug found by the browser test:** the tour decided which steps exist when it
opened. On the first visit it opens in the same render as the note list, so
the note step was always skipped. Steps are now checked when moving to them.

**How verified:**
- Web: 106 tests (new: step filtering and order).
- Browser test, 12 checks: opens on first visit; all 10 steps highlight their
  element exactly; the note step shows the note's buttons; Bitir closes and
  it doesn't reopen after a reload; ? reopens it; keyboard works; a user
  without notes gets 9 steps; on a phone the card never covers the target.

### 2026-09-24 — Learning guide
**What:** `docs/GUIDE.md`, a complete guide for the owner (a developer
returning from low-code).
- The big picture, and one note followed end to end.
- Every tool and service: what it is, why we chose it, how we use it (Git and
  GitHub, Node and npm, JS and TS, React, Vite, Express, PostgreSQL and pg,
  Neon, Render, Cloudflare Workers AI, LLM and embedding concepts, Google
  sign-in, test tools, browser APIs).
- A file-by-file repository tour, the data model and API, and how each
  feature works.
- Security, testing, everyday workflows, how we worked with Claude Code, a
  glossary, and exercises.

Numbers in it (limits, test counts, models) were checked against the code.
README and CLAUDE.md link to it; CLAUDE.md asks to keep it updated.

### 2026-09-24 — Dark mode (D17)
**What:**
- A dark palette for every screen: notes, search highlights, full-screen
  writing, reading mode, Reminders page, dialogs, toasts, tour and login
  (Google's button switches to its dark style).
- Hard-coded colors in `index.css` became variables (`--on-primary`,
  `--overlay`, `--mark`, `--reader-bg`, `--toast-bg`, `--tour-dim`, …).
- A header button cycles Sistem → Açık → Koyu (`components/ThemeToggle.tsx`,
  logic in `lib/theme.ts`). The choice is remembered per browser, and
  `index.html` applies it before the first paint.
- On small phones the header buttons are slightly tighter so the extra button
  fits (the browser test caught a 28 px sideways scroll).
- Also removed stray backslashes before backticks in earlier log entries.

**How verified:**
- Web: 111 tests (new: `theme.test.ts` for cycling, saving, `data-theme`).
  Lint and build are clean.
- Browser test with a dark device setting, 16 checks:
  - no near-white panel on the notes page, search, full-screen writing,
    reader, delete dialog, Reminders page, or phone;
  - Açık overrides the device and survives a reload; Koyu, then Sistem, which
    clears the choice;
  - a saved Koyu applies even when the app's script doesn't load (no flash);
  - the login page is dark; no page errors.
- The tour test (12 checks) still passes.

**Next:** merge together with the learning guide (PR #10) after the owner
tries it.

### 2026-09-24 — Undated reminders were invisible; dates without a month name
**Reported:** an undated reminder could not be seen on the notes page, only
under Hatırlatmalar; and "ayın 26'sında sinemaya gideceğiz" did not become a
reminder.

**What was wrong:**
- Reminder notes are kept out of the note list (2026-09-24 decision), and the
  "Yaklaşan" strip only listed overdue items and the next 2 days — and only
  *dated* ones. An undated reminder was therefore on no screen except the
  Reminders tab, and with only undated reminders the strip didn't render at
  all, so even its "Tümü" link was missing. A note the user had just written
  looked lost.
- The parser had no rule for a day of the month without a month name.
  ("salı günü pazara gideceğim" did work; it was 5 days away, so the strip's
  2-day window hid it, which looked like the same bug.)

**What we did:**
- `stripItems` (`lib/agenda.ts`, pure and unit-tested) now decides what the
  strip shows: all overdue, **all undated** (labelled "Tarihsiz"), and the
  next 7 days. If the week is empty the next reminder is shown anyway, so
  the strip never vanishes while reminders exist. It shows 4 rows, then
  "+n daha".
- `parseReminder` understands "ayın 26'sında", "bu ayın 25'inde 14:30",
  "gelecek ayın 3'ünde", "ayın 28 günü" and a bare "26'sında": this month, or
  the next month that has that day ("31'inde" skips September). To avoid
  false positives a suffix is required, so "bu ay 3 kitap okudum",
  "sayfa 26'da" and "sepetteki 3'ü" are still plain notes.

**How verified:**
- Web: 126 tests (new: 8 day-of-month cases, 3 non-dates, 4 strip cases).
- Browser test, 12 checks: undated, overdue and a reminder 5 days away are in
  the strip; one 40 days away is not; ✓ completes the undated one and it
  leaves the strip; with only far reminders one row still shows; with no
  reminders there is no strip; "ayın N'sında …" is recognised while typing;
  no sideways scroll on a phone.

**Next:** deploy after the owner tries it.
