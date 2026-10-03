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
| D18 | Folders can be shared with other people by e-mail invite; everyone invited may edit | Active |
| D19 | Someone who accepted a folder from you is not asked again for the next one | Active |
| D20 | New look: warm "paper and ink" theme, full-height sidebar on computers, tab bar + full-screen composer on phones | Active |
| D21 | Reminder notifications by Web Push, sent by the server when an outside scheduler asks | Active |
| D22 | A folder can be marked "to-do": every note in it gets a tick box, and ticked ones drop to the bottom | Active |
| D23 | Backups: one gzipped JSON of everything, fetched or pushed on a schedule, to storage that needs no account | Active |
| D24 | Deleting puts a note in the trash for 30 days instead of wiping it; the existing cron does the emptying | Active |
| D25 | A long note is clipped to ten lines in the list; clicking a note opens it, with its comment box ready | Active |

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
  - `DELETE` doesn't remove the row: it sets `deleted_at` (a "tombstone").
    The content used to be wiped in the same statement; since D24 it stays for
    30 days so the note can come back, and only then is it wiped. The row
    itself is never removed either way.
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

### D18 — Sharing a folder with other people
- **Decision:** a **folder** is the unit of sharing. Everything inside it,
  subfolders included, is shared with the people invited to it, and both
  sides may add, edit, complete and delete.
  - **Invited by e-mail**, before they have an account if need be: the row
    waits until that address signs in (`linkInvites`). Nothing is shared
    until the invitee **accepts**.
  - **No mail is sent.** The owner copies an invite link
    (`/davet/<token>`) and sends it themselves. Opening it while signed in
    with the invited address accepts the invite; the same invite also shows
    as a banner in the app.
  - A note written in a shared folder **belongs to the folder's owner**
    (`notes.user_id`) and records its writer (`notes.author_id`), so it
    stays with the folder when sharing ends, and counts against the owner's
    50 MB.
  - Completing is **shared**: ticking a reminder off completes it for
    everyone. That is what a shared shopping list needs.
  - Folders shared with you are listed apart, under **"Paylaşılan"**, named
    after their owner: you may both have an "Alışveriş", and merging them
    would hide whose is whose.
- **What this replaces:** "every query is scoped to `req.userId`" (D16)
  becomes "every query covers what this user may see", which is the user's
  own rows plus accepted shares. The rule lives in `server/src/shares.js`
  (`VISIBLE_NOTES`, `writableOwner`, `canWriteNote`) and nowhere else,
  and `server/test/shares.test.js` is its guard rail.
- **Deliberately left out of the first version:**
  - **Locked folders cannot be shared** (D8): their key is derived from a
    password in the browser and never reaches the server, so the other person
    would see nothing but ciphertext. Sharing also blocks locking afterwards.
  - **No viewer role.** Everyone invited may edit. A read-only role is a
    column away if it is ever wanted.
  - **Single notes cannot be shared**, only folders. The `kind` column is
    already there, so adding them later is additive.
  - **Notes cannot change owner**, so a note cannot be moved into or out of a
    shared folder; write it there instead. (The server answers 409.)
  - **"Search by meaning" stays on your own notes.** Keyword search finds
    shared notes anyway, because it runs in the browser over everything you
    can see; the AI half stays scoped so one person's notes never enter
    another's AI usage.
- **Where you share from:** a folder's ⋯ menu on the Notlar page, and the
  folder list on the Hatırlatmalar page. Both are needed: the notes tree is
  built from ordinary notes only, so a folder holding nothing but reminders
  has no row there.
- **Revisit when:** people ask for read-only sharing, for single notes, or
  for their own completion state on a shared reminder.

---

---

### D19 — Asked once, not every time
- **Decision:** the first folder you share with someone is an invitation they
  accept. After that, another folder from **the same person** simply appears
  for them, already accepted (`createShare` looks for an earlier accepted
  share with that e-mail).
- **Why:** the acceptance step exists so nobody can push content at a
  stranger. Once they have accepted you once, repeating it is friction with
  no safety left to buy — the shopping list and the bills are the same two
  people.
- **They keep the way out:** leaving a share is one click and only affects
  them, and the owner can withdraw it at any time. Neither side is stuck.
- **What it also gives:** the people who accepted are offered in the Paylaş
  dialog (`contacts`), so a second folder is one tap and no typing.
- **Supersedes** the part of D18 that said nothing is shared until the invitee
  accepts: that still holds for the **first** folder from a given person.
- **Revisit when:** someone wants to be asked every time, or to block a person
  entirely (today they can only leave each folder).

### D20 — A new look, and nothing hidden
- **Decision:** a warm "paper and ink" palette (ground `#f5f3ee`, ink
  `#1c1b18`, the indigo accent kept), Fraunces for headings and Instrument
  Sans for text (Google Fonts; Georgia / system font when offline), and a
  new frame:
  - **Computers:** a full-height sidebar with the logo, **Yeni not**,
    Notlar / Hatırlatmalar (with an "N gecikmiş" badge), the folder tree and
    the account buttons. The page shows the open folder as a big title, and
    the composer sits in the page as one dashed line until you click it.
  - **Phones:** a small header, a bottom tab bar (Notlar · Klasörler ·
    Hatırlatmalar), a **Not yaz** button, the folders as a sheet from the
    bottom, and the composer full screen while writing (**Kapat** keeps the
    draft).
- **Why:** the owner found the old UI plain, small (10–11 px text), hard to
  discover (actions only on hover) and cramped on a phone. Designed first on a
  canvas, then applied here.
- **Rules that came with it:**
  - No text below 12 px; note text 15 px; touch targets 44 px.
  - Main actions never hide: a note shows Düzenle, Taşı and ⋯ (okuma modu,
    yorum, görsel, sil); a folder always shows its ⋯, which now also has
    Şifreyle koru / Kilitle. Only the drag handle and a folder's extra lock
    button stay hover-only.
  - Locked notes are one card per locked folder ("3 kilitli not"), and search
    says which locked folders it skipped, with a button to unlock.
  - Search results are two groups: word matches, then "Anlamca ilgili" in its
    own tinted box.
- **Revisit when:** the fonts should work offline too (bundle them with the
  app instead of Google Fonts).

---

### D21 — Reminder notifications by Web Push
- **Decision:** the server sends notifications with **Web Push** (VAPID), and
  an **outside scheduler** tells it when to look. No third-party notification
  service, no app store, nothing new to pay for.
  - Each browser subscribes for itself (`push_subscriptions`, keyed by the
    endpoint the push service gives it), so "on" is per device, not per
    account. The button lives on the Hatırlatmalar page.
  - `POST /api/reminders/due` does the sending. It is called every few minutes
    by cron-job.org and authenticates with `CRON_SECRET`, not a session — a
    signed-in user cannot drive it either.
  - **Why an outside scheduler:** a free Render service sleeps after 15
    minutes and has no cron of its own. The same call wakes it, so the sleep
    problem and the scheduling problem have one answer.
- **What a notification may say:** for a plain note, its folder and first line.
  For a note in a locked folder the server only has ciphertext, so it says
  "Kilitli bir notunda hatırlatman var." and nothing else (D8).
- **Who gets it:** everyone who can see the reminder — the owner and anyone
  the folder is shared with who has accepted (D18).
- **Not sending twice:** `notes.last_notified_at` holds the occurrence already
  sent. A repeat therefore still fires next time, and a completed one
  (`reminder_done_until`, `checked`) stays quiet.
- **Nothing stale:** anything more than two hours late is dropped, so a server
  that was asleep does not deliver yesterday's reminders in a burst.
- **Times are stepped in UTC**, which is exact for Turkey (fixed +03). See the
  open question about other time zones.
- **iOS** only allows this for the app added to the home screen; the button
  says so instead of failing quietly.
- **Without the keys** (`VAPID_*`) the whole feature is simply off and the rest
  of the app is unaffected.
- **Revisit when:** notifications should be quiet at night, or a reminder
  should go only to the person who wrote it.

### D22 — To-do folders
- **Decision:** the "can be ticked off" setting lives **on the folder**, not on
  the note. Its ⋯ menu has "Yapılacaklar klasörü yap"; after that every note
  in it shows a tick box — the ones already there as well as new ones.
  Subfolders inherit it, the way a protected folder covers what is inside it
  (D8).
- **Why the folder and not the note:** the note already had `isListItem`, set
  once while writing, and you cannot change your mind afterwards. A shopping
  list is a property of the list, not of each line: you decide once, and
  everything that lands there behaves the same.
- **Why on the server:** `todo_folders (user_id, path_key)`. Because it is
  stored, the setting follows you to your phone, and the people the folder is
  shared with (D18) see the same tick boxes — a shared shopping list is one
  list, not two. Only the **owner** sets it; the invitees see it and may tick.
  `GET /api/todo-folders` therefore returns your own marks plus the ones on
  folders shared with you, each with whose it is, so your "Alışveriş" and
  somebody else's stay apart (the same rule as D18).
- **Ticked notes drop to the bottom**, under a folded "Tamamlananlar (n)"
  heading, so the list is what is left to do. Opening it shows them, struck
  through, and they can be un-ticked from there.
- **What it does not change:** nothing is written to the notes. A note in a
  to-do folder is checkable because of where it is; unmark the folder and the
  boxes are gone, with `checked` left untouched in case it is marked again.
  Reminders keep their own ✓ on the Hatırlatmalar page (D21) and are not
  listed here.
- **The mark follows the folder** when it is renamed or moved, like a share
  (`POST /api/todo-folders/move`), matching only the folder itself and what is
  inside it — "Yaşamtarzı" is not inside "Yaşam".
- **Revisit when:** a note should carry its own tick box into whatever folder
  it is moved to, or a to-do folder should sort by its own order rather than
  by date.

### D23 — Backups to Cloudflare R2
- **Decision:** **one gzipped JSON file** holding everything needed to rebuild
  the database — users, live notes, `protected_folders`, to-do marks and
  shares — produced on a schedule and stored somewhere else. Both directions
  exist, guarded by the same `CRON_SECRET` as the reminders (D21):
  - `GET /api/backup` hands the file over, so **whatever asks keeps it**. This
    needs no storage account at all, which is why it is the one we use.
  - `POST /api/backup` has the server push it into a **Cloudflare R2** bucket,
    for when nothing of the owner's can be relied on to be switched on.
- **Why not R2 after all:** it was the first choice — the Cloudflare account
  and the scheduler already existed, and 10 GB free with no egress charge is
  more than a JSON file will ever need. Then enabling R2 turned out to demand
  a **payment method**, even though the free tier costs nothing, and the owner
  did not want to hand one over for a personal notebook. The push code stays
  in place and tested: it is inert without the credentials, and it is there
  the day a bucket exists.
- **Why a pull is the better shape anyway:** the destination stops being the
  server's business. A scheduled task on a PC, a machine at home, a CI job —
  anything that can make an HTTP request with a header can keep the backups,
  and none of them has to be reachable from the internet. Dropping the file
  into a folder a cloud drive already syncs makes it off-site with no API, no
  key and no account.
- **Locked notes stay locked.** `cipher` is copied exactly as it sits in the
  database and `protected_folders` (salt, iterations, check value) comes with
  it, so the same password opens a restored copy. The server has never had the
  plaintext and a backup was no reason to start (D8). Anyone who steals the
  file gets ciphertext.
- **Deleted notes are left out.** Since D24 a deleted note keeps its content
  for 30 days, but the backup is the live notebook, not the undo buffer: the
  trash is a short-lived convenience and restoring a backup should not
  resurrect what you threw away.
- **Never deletes, never overwrites.** Every run writes a new object named for
  its time (`notex/2026/notex-20261002T030000Z.json.gz`, so sorting by name
  sorts by time). Pruning is an R2 lifecycle rule, not code — a bug in the app
  cannot eat the history.
- **Restoring is part of the feature, not an exercise.** `restoreBackup()`
  lives in `src/backup.js` and is what `scripts/restore-backup.mjs` runs, so
  the tests exercise the real thing. It upserts inside one transaction: safe
  to run twice, and it never deletes, so notes written after the backup
  survive. The test wipes every table and rebuilds from a gzipped dump.
- **The same dump serves the owner.** `GET /api/export`, narrowed to the
  caller, is what *Notlarını indir* at the foot of the page downloads.
- **Signed by hand.** R2 speaks S3, which wants AWS Signature V4. That is ~60
  lines in `src/r2.js` rather than the AWS SDK for a single PUT, and the
  request it builds is tested in detail because a signing mistake would
  otherwise only appear in production.
- **What actually runs today:** `scripts/pull-backup.ps1` on Windows Task
  Scheduler, writing into a OneDrive-synced folder and keeping the last 60. It
  retries while Render's free instance wakes up, checks the file really is a
  gzip rather than an error page, prunes only files it made, and exits
  non-zero so a failure shows as a failed task instead of a backup that
  silently never happened.
- **Known limit:** the dump is built in memory and stringified, so peak usage
  is roughly twice its size. With a handful of users and mostly text that is
  nowhere near Render's 512 MB; a notebook full of inline images would need
  the file streamed out table by table.
- **Revisit when:** images move out of the notes table (then the bucket holds
  them too, and the dump shrinks), or the backup needs to cover more users
  than fit in memory.

### D24 — The trash
- **Decision:** `DELETE /api/notes/:id` sets `deleted_at` and **keeps the
  content**. It stays recoverable for **30 days**, then the content is wiped —
  which is exactly what deleting used to do immediately. The tombstone row is
  never removed, so other devices still learn about the deletion (D9).
- **Why:** deleting was the only truly irreversible thing in the app. One
  mistaken tap and the words were gone from the database in the same statement
  that marked the note deleted; a confirm dialog was the whole of the safety
  net. Backups (D23) cover losing the database, not losing a note between
  backups.
- **Undo is the feature; the trash is the fallback.** Deleting now offers
  **Geri al** in a toast, which is what will actually get used. The Çöp
  kutusu view exists for when the toast has gone.
- **Who sees it:** the same people who could see the note (`VISIBLE_NOTES`),
  and restoring needs the same right as editing (`canWriteNote`). So if
  someone deletes a note in a folder you share, either of you can put it back
  — the person who made the mistake is usually the one who wants to fix it.
- **Emptied by the cron that already runs.** `purgeTrash` is called from
  `POST /api/reminders/due` every few minutes, and the response says how many
  it wiped. One scheduled job to set up instead of two. If that job is ever
  turned off, the trash simply stops emptying; nothing breaks.
- **Locked notes stay locked in the trash**: `cipher` is kept untouched, so a
  deleted note in a protected folder is unreadable there too, and comes back
  still encrypted (D8).
- **A purged note cannot be restored**: `POST /:id/restore` answers 410 rather
  than bringing back an empty note.
- **Deleting still loses a race with a newer edit, and vice versa** (D9):
  a save made before the delete does not resurrect the note, and a save made
  after it does.
- **Known wrinkle:** the storage quota already ignored deleted notes, so a
  note in the trash does not count against the 50 MB although it still takes
  the space. Bounded by the 30 days, so it was left alone rather than making
  someone at quota wait for a purge.
- **Revisit when:** 30 days is the wrong number, or the trash should be in the
  backup after all.

### D25 — Open a note to read it, and to talk about it
- **Decision:** in the list a note's body is **clipped to ten lines** with a
  fade and a **Devamını oku**; opening it expands the note **in place** and
  brings its **comment box** with it. **Okuma modunda aç** sits beside it for
  the full-screen reader, which stays as it was.
- **Clicking the note's text opens it too**, so reading more and commenting
  are the same gesture rather than a trip through the ⋯ menu.
- **Whether to clip is measured, not guessed.** `useOverflow` compares
  `scrollHeight` with `clientHeight`, because wrapping depends on the window
  width, the font and any images: counting characters is wrong on exactly the
  notes where it matters. The height limit is therefore always on while the
  note is closed, and the measurement only decides whether to show the fade
  and the button — measuring first and limiting afterwards always answers
  "it fits".
- **Clicking must not fight text selection.** Notes are there to be copied
  from, so a click is ignored when it lands on a button, link, image or input,
  and when it ends a non-empty selection. Dragging to select is safe.
  Double-clicking a word does open the note, because the first click arrives
  before any selection exists; the only cure is delaying every open by a
  couple of hundred milliseconds, which is a bad trade. The selection survives
  either way, so nothing is lost.
- **A short note says "Kapat", not "Daha az göster"**, since nothing is being
  shown less — whether it was clipped is remembered at the moment it opens.
- **Existing comments still show without opening**, as before; what opening
  adds is the box to write a new one. After posting, the box stays and keeps
  focus, because comments come in twos and threes.
- **Revisit when:** ten lines is the wrong number, or opening should remember
  itself across reloads.

---

## 3. Open questions

- **Images:** inline base64 in note content for now (up to 10 MB per request),
  shrunk to 1600 px WebP on the way in. Inline means every image is downloaded
  again on every app open, so the remaining fix is structural: move them to a
  separate table or object storage (e.g. Cloudflare R2), encrypted in the
  browser for protected folders. The other lever left is `MAX_SIDE`: 1280
  instead of 1600 is about 30% smaller again, at the cost of detail when an
  image is opened full-screen.
- **Rich-text editor:** `web/src/components/RichEditor.tsx` is a small
  contentEditable editor (text + images only) using `document.execCommand`,
  which is deprecated but still supported everywhere. Consider TipTap or
  Lexical if formatting (bold, lists) is wanted.
- **Reminders in another time zone:** the server steps repeats in UTC (D21).
  Turkey is a fixed +03, so a monthly "28th at 09:00" stays put; in a country
  that changes its clocks, a repeating reminder would arrive an hour off after
  the change. Storing each user's time zone would fix it.

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

### 2026-09-24 — Shared folders (D18)
**What:** a folder can be shared with other people, so a shopping list or a
payment reminder is one list for everybody. Asked for reminders first, but it
covers ordinary notes just as well, since a shared folder holds both.

- **Server:** new `shares` table and `src/shares.js`, which holds the whole
  visibility rule; `/api/shares` (list, invite, accept, remove, move).
  `notes.author_id` records who wrote a note. Every notes query now goes
  through `VISIBLE_NOTES`; writing resolves the owning user first.
  A note you may not touch answers **404, not 403**, so the reply never
  reveals that an id is taken.
- **Web:** `lib/sharing.ts` (pure, unit-tested) splits your own tree from
  what others share with you; `ShareModal` invites and copies the link;
  `SharedTree` is the "Paylaşılan" group; `InviteBanner` accepts invites,
  including straight from an opened `/davet/<token>` link. The sidebar's
  folder menu gained "Paylaş…", disabled for locked folders, and a shared
  folder shows a small badge.
- **Fixed along the way:** the folder ⋯ menu only closed on mouse-leave, so on
  a phone (no hover) it could not be closed at all, and two menus could be
  open at once. It now closes on an outside tap or Esc.

**How verified:**
- Server: 33 tests, 12 of them new — a pending invite grants nothing; after
  accepting she sees that folder and no other; subfolders come along; a
  stranger gets nothing; the owner cannot be changed; renaming the folder
  keeps the share; withdrawing it takes effect at once and leaves her notes
  with his folder; locked folders and self-invites are refused; an invite
  sent before the account existed works at first sign-in; leaving a share
  affects only that person.
- Web: 134 tests (8 new for `lib/sharing.ts`), lint, build.
- Browser test with **two signed-in people** against a real server and
  Postgres, 19 checks: the whole invite → accept → shared list → shared
  reminder → tick off → withdraw flow, that his private folder never shows,
  that Esc closes the folder menu, and no sideways scroll on a phone.

**Next:** deploy after the owner tries it. Later, if wanted: single notes,
a read-only role, real invite e-mails, per-person completion.

### 2026-09-24 — Sharing a folder of reminders
**Reported:** "can I share reminders with this method?" Yes — a shared folder
carries its reminders — but a folder holding *only* reminders could not be
shared at all: the Notlar sidebar is built from ordinary notes (reminders were
taken out of the tree in September), so such a folder had no ⋯ menu, and the
folder list on the Hatırlatmalar page was only a filter.

**What we did:**
- The Hatırlatmalar folder list got a share button of its own, opening the
  same `ShareModal`. It only appears on folders you own and that aren't
  locked, and a shared folder shows the same 👥 badge as in the sidebar.
- While there: that list merged a folder someone shared with you into your own
  folder of the same name, because it keyed only on the path. It now keys on
  owner + path and labels a foreign folder with its owner ("kaan · Ödemeler"),
  matching "Paylaşılan" on the notes page.

**How verified:** the two-user browser test grew to 23 checks — a
reminder-only folder is absent from the notes sidebar, can be shared from the
Hatırlatmalar page, and the invitee then sees the reminder on her own
Hatırlatmalar page under his name. 134 web tests, lint and build pass.

**Next:** deploy.

### 2026-09-24 — Editing and renaming on the Reminders page; a visible version
**What:**
- **Edit a reminder** from the Hatırlatmalar page: the ✏️ button opens the
  ordinary note card in place (`NoteCard` gained `startEditing`/`onEditDone`),
  so text, images, folder and the reminder time are edited with the same
  editor as everywhere else, instead of a second one to keep in step.
- **Rename (and share) the folder** from the reminders folder list, through a
  ⋯ menu like the notes sidebar. Renaming reuses `store.moveFolder`, so it
  moves everything in the folder and can be undone from the toast.
- **Which build is running** is shown in the corner of both pages
  (`lib/version.ts`, `VersionTag.tsx`). Vite bakes in the commit at build
  time (`RENDER_GIT_COMMIT` on Render, `git rev-parse` locally) and
  `/api/health` reports the server's. When they differ — a deploy happened
  while the tab was open — the page offers "Yeni sürüm yayında · Yenile".
  Checked on load and whenever the tab regains focus; unknown versions
  ("dev") never nag.

**Two bugs the browser test caught, both real:**
- A card opened straight in edit mode never filled its draft fields, so
  saving silently did nothing — and, had it saved, it would have dropped the
  note's folder and its reminder time. The drafts now come from the note
  (`draftOf`).
- `reminderLabel` kept the text the reminder had when it was created, so
  editing a reminder never changed what the Hatırlatmalar page and the
  "Yaklaşan" strip showed. It now follows the text.

**How verified:** 137 web tests (3 new for version comparison), 33 server
tests, lint, build. Browser test with 10 checks: the version tag, the pencil
opening the editor, the edit reaching the server with its time intact,
renaming moving both reminders, the reload offer when the server reports a
different build, and no sideways scroll on a phone.

**Next:** deploy.

### 2026-09-24 — A version number at the foot of the page
**What:** the build marker moved from the sidebar corner to a footer under the
page content, and now reads as a version people can say out loud:
**"Notex v1.0.0"**.

- The number comes from `web/package.json`, bumped with every deploy (patch
  for fixes, minor for features). CLAUDE.md now carries that rule.
- The commit and build time moved into the footer's tooltip
  ("v1.0.0 · 780f12e · 24 Eyl 17:02"), so a build is still identifiable
  exactly.
- The "a deploy happened while your tab was open" check still compares
  **commits**, not the version number: a forgotten bump can then never hide a
  new deploy. The footer turns into "yeni sürüm var, yenile" next to the
  usual toast.

**How verified:** 138 web tests (4 for the version rules), lint, build, and
the browser test's 12 checks — the footer reads `Notex v1.0.0`, its tooltip
has all three parts, it sits below the content, and it offers the reload when
the server reports another build.

### 2026-09-24 — The version sits under the note box (v1.0.1)
**What:** the version line moved from the end of the page content into the
composer bar, under the note box. The bar is fixed to the bottom of the
window, so "Notex v1.0.1" is visible from anywhere without scrolling, below
everything else — which is what was asked for. It is hidden while the
composer is in full-screen writing mode, where it would be in the way.

**How verified:** the browser test checks it sits below the note box, is on
screen at a phone size without scrolling, and stays visible after scrolling
to the top; 14 checks in all. 138 web tests, lint and build pass.

### 2026-09-24 — Tidying the folder menu and rename on the Reminders page (v1.0.2)
**Reported:** the rename area on the reminders folder list "doesn't look
good". Two real faults behind it:

- The ⋯ menu was nested **inside** the row, which is a flex container, so it
  became a flex item: squeezed to a narrow column on top of the folder name
  ("Yeniden adlandır" wrapped onto two lines, and you could no longer see
  which folder you were renaming). It is now a sibling that flows under the
  row, exactly like the notes sidebar.
- The rename field looked like a form control dropped into the list: a
  bordered box taller than the row. It is now an in-place label edit — the
  row keeps its height, the text sits where the name was, with a thin accent
  underline — and the old name starts **selected**, so typing replaces it
  instead of having to clear it first. Both pages share it.

**How verified:** the browser test now measures this instead of trusting the
eye — the menu opens below the row, its items fit on one line, the rename box
doesn't change the row's height, and the name is preselected. 18 checks in
all; 138 web tests, lint and build pass.

### 2026-09-25 — Installable app and a phone-sized layout (v1.1.0)
**Why:** the app worked on a phone but was cramped, and iOS only delivers web
push to apps installed on the home screen — so this is also step one towards
reminder notifications. Measured on an emulated Pixel 7 before and after
rather than judged by eye.

| | before | after |
|---|---|---|
| composer bar | 246 px (29% of the screen) | 106 px (13%) |
| tap targets under 40 px | 35, smallest 18 px | 24, smallest 32 px |
| agenda actions (5 buttons) | 108 px | 178 px |

**What:**
- **Installable (PWA):** `manifest.webmanifest` (standalone, Turkish name,
  192/512/maskable icons rendered from the favicon), apple-touch-icon and iOS
  meta tags, light and dark `theme-color`, and `public/sw.js` — an offline
  shell that **never** caches `/api/**`, serves content-hashed `/assets/**`
  cache-first and everything else network-first, so a deploy is picked up on
  the next load.
- **The composer is one line until you write in it** on phones; it opens on
  focus and folds back after saving. This is what gave the list its space
  back.
- **The folder tree folds away** behind a button that names the selected
  folder ("Tüm klasörler 2"); picking a folder closes it again. Both pages.
- **Touch targets** grow under `@media (pointer: coarse)` — icon buttons from
  18 to 34 px, list rows and checkboxes too — with the mouse layout untouched.

**Two faults found while testing, both fixed:**
- The fold-away button never appeared: its base `display: none` sat *after*
  the phone media query, so it always won. Moved above it.
- The old dark-mode browser test failed at the first step, which turned out to
  be the app's fault, not the test's: `load()` fetched notes, folders and
  shares together, so a failing `/api/shares` left the user with **no notes at
  all**. Sharing is now loaded separately and its failure only shows a notice.

**How verified:** 141 web tests (3 new for `load`), lint, build. A new PWA
browser check (11 assertions: manifest, every icon served, the service worker
reaching *activated*, and the shell still opening with the network off), the
mobile audit above, and the existing dark-mode (16) and reminders (18) suites.

**Next:** push notifications — service worker push handler, VAPID keys,
subscriptions per device, `/api/reminders/due`, and a free external cron.

### 2026-09-25 — Writing into the open folder, and a mark on shared notes (v1.2.0)
**Asked for:** a way to add a note to the folder you are looking at, without
the AI guessing a folder you have already chosen; and a visible sign, with the
people behind it, on notes and reminders other people can see.

**What:**
- **"Bu klasöre not ekle"** appears beside the folder name above the list as
  soon as a folder (yours or a shared one) is open, and in the folder's ⋯
  menu. It puts the cursor in the composer with the folder already filled in.
  The AI was already skipped for a chosen folder — `pathSource` becomes
  `'selection'` — so this only adds the way in, which is what was missing.
  A tiny event (`state/composer.ts`) carries the request, instead of threading
  a ref through three components.
- **A 👥 mark** on every note others can see: on the card beside the folder
  name, in the "Yaklaşan" strip, and on the reminders page. Its tooltip says
  who — "Ayşe ile paylaşıldı (1 bekliyor)" for your folders, "Kaan ile
  paylaşılan klasörde" for one shared with you. The text comes from
  `shareMark` in `lib/sharing.ts`, so it is unit-tested rather than assembled
  in the components.

**How verified:** 145 web tests (4 new for `shareMark`), lint, build, and a
browser test with 17 checks — a private note has no mark while a shared one
names Ayşe, the strip and reminders page mark both your own shared reminders
and Kaan's, the button appears only with a folder open, puts the cursor in the
composer with the path filled, saves into that folder rather than one the AI
picked, works from the ⋯ menu, and is reachable on a phone.

### 2026-09-25 — Sharing without asking twice, and clearer wording (v1.3.0)
**What:**
- **D19: asked once, not every time.** `createShare` marks a share accepted
  straight away when that person has already accepted a folder from you.
  `GET /api/shares` also returns `contacts` — the people who accepted — and
  the Paylaş dialog offers them as one-tap buttons above the list of who can
  already see this folder. The e-mail box stays for someone new.
- **The dialog now reads as two lists:** "Daha önce paylaştıkların" (tap to
  add) and "Bu klasörü görenler", each person marked *katıldı* or *davet
  bekliyor*, with the copy-link button only where a link is still needed.
- **Clearer marks.** A folder somebody shared with you now says **"Kaan
  paylaştı"** instead of "Kaan ile paylaşılan klasörde", and several people
  read naturally: "Ayşe ve Irmak ile paylaşıldı", "Ayşe, Irmak ve Mehmet ile
  paylaşıldı", with " · 1 davet bekliyor" appended when an invitation is
  still out.

**How verified:** 35 server tests (2 new: the second folder needs no
acceptance and can still be left; contacts list people who accepted, once each,
and never someone who didn't) and 145 web tests, lint, build. Browser test,
19 checks, including the dialog offering Irmak, her joining with no invitation
and dropping off the offer row.

### 2026-09-25 — New look (D20, v1.4.0)
**What:**
- Colors, fonts and sizes in `index.css` (tokens at the top, dark values
  alongside). New frame in `NotesPage.tsx`: sidebar on computers; header, tab
  bar, **Not yaz** and a folder sheet on phones (`useIsPhone.ts` shares the
  680 px breakpoint with the CSS).
- `Composer.tsx`: in the page instead of a fixed bottom bar; folds back to one
  line when left empty; full screen on phones with Kapat / Kaydet; the AI
  folder chips come right under the text as "Nereye kaydedelim?"; the version
  moved to the foot of the page.
- `NoteCard.tsx`: full folder path, Düzenle / Taşı / ⋯ always visible (on
  phones only ⋯, which then also holds Düzenle and Taşı).
- `LockedCard.tsx`: one card per locked folder, in the list and in search.
- `Sidebar.tsx`: "Tüm notlar", "Kilitli" pill, ⋯ always visible, lock item in
  the ⋯ menu. `PasswordModal.tsx`: folder name as the title, a labelled field
  with show/hide, a bottom sheet on phones. New sign-in screen in `App.tsx`.
- Search: results in two groups, a card for skipped locked folders, "/"
  focuses the box, Esc clears it.
- Reminder counts ("4 aktif", the strip's "Tümü (4)") count reminders, not
  occurrences: a monthly bill is one reminder, not six.
- The tour finds whichever copy of a target is on screen (the Hatırlatmalar
  button exists in the sidebar and in the tab bar); on phones it points at
  **Not yaz** and the Klasörler tab, and on computers it unfolds the composer
  while it runs so its buttons can be shown.

**How verified:** the npm registry was not reachable from the cloud session
that made this change, so `npm test`, `npm run lint` and `npm run build`
still need a run on a machine with the dependencies installed. The app was
bundled with esbuild (icons stubbed) and checked in Chromium against a mocked
API at 1440×960 and 390×844, light and dark: 33 checks passed (folded
composer opens and folds back, Ctrl+Enter saves into the open folder, "/" and
Esc, two result groups, one locked card for three notes, ⋯ menus open and
close, the password sheet, the phone sheet closes when a folder is picked, the
phone composer keeps its draft after Kapat and closes after Kaydet, no
horizontal scroll), and the guided tour walked through on both layouts
(10 steps on a computer, 7 on a phone), with no console errors.

**Next:** run the checks above locally, then deploy. Maybe bundle the fonts.

### 2026-09-25 — The new look, merged and actually run (v1.5.0)
The redesign above was written against v1.3.0 in a session with no npm
registry, so nothing in it had been run. Applied here at its own base commit
and merged forward, which is why the faces (v1.4.0) and this entry survive it.

**Merge:** only `index.css` and this log conflicted. The narrow-phone rules
from v1.4.0 were **dropped rather than ported**, because the new frame deletes
`.topbar` and `.view-tabs` outright; the 360 px width is re-checked against
the new layout instead (below). The reminder-picker sheet and the shared
faces merged untouched.

**First real run of the checks it never had:** 150 web tests, lint and build
all pass.

**One fault found and fixed:** the initials circles kept their light pastel in
dark mode, because the colour was computed in JavaScript. Only the hue is set
inline now (`--face-h`); how light it is belongs to the theme, so dark mode
gets a deep circle with light letters.

**Browser checks, all against the built app:**
- New frame, 37 checks at 1440×960 and 360×780 (a Galaxy S23), light and
  dark: sidebar and its badges, one locked card for two locked notes, the
  composer folding and saving, folder → page title, the two search groups and
  the "skipped locked folder" card, `/` and Esc, the tab bar, the folder
  sheet closing when a folder is picked, the full-screen composer keeping a
  draft through **Kapat**, the password sheet, no page errors, and **no
  sideways scroll at 360 px** in the new layout.
- The older suites, updated for the new frame and green again: dark mode
  (16), reminders editing and renaming (18), sharing and faces (14),
  overlays at 360 px (31).
- Two things that looked like defects were checked and were not: a note
  someone shares with you is absent from the main list **by design** (it
  lives under "Paylaşılan"), and a blue block under the folder sheet was a
  screenshot taken mid-paint.

**Left as the patch made it:** the "Bu klasöre not ekle" button above the list
is gone; a folder's ⋯ menu still has it, and the composer under the title now
says "Notlar klasörüne yaz…" with the path filled in.

**Still open:** the fonts come from Google's CDN on every visit — worth
bundling.

### 2026-09-25 — A Galaxy S23 scrolled sideways; faces instead of an icon (v1.4.0)
**Reported:** "there is too small lateral scrolling" on an S23, and the shared
mark's tooltip "runs slow — is it bringing from db every time?"

**The sideways scroll was real, and our tests had missed it:** every phone
check used 390 or 412 px, but an S23 is **360**. At 360 the page measured
370 px — the header's right-hand buttons had nowhere to go. Now the tabs may
shrink (`min-width: 0`) while the buttons keep their size, with tighter
spacing below 420 px and, below 340 px, the tabs moving to their own line.
Checked at 360 and 320: both exactly the viewport width.

**A second overflow, found while checking:** the reminder time picker on the
agenda hung off the right edge (409 px), because it was anchored to a row
indented by the date column. On phones it is now a small sheet centred in the
screen. Anchoring it to the row's right edge instead was the first attempt,
and it looked fixed — the page stopped scrolling — but the panel was then cut
off on the *left*, where nothing scrolls. The browser check now measures every
panel's box against the viewport, not just the page width.

**The tooltip was not slow — it was the browser's.** Shares are fetched once
at load and kept in memory; the mark is a pure function over that state, with
no request on hover. What was slow is the native `title` delay of about a
second, which also never appears on a phone. So, as suggested:
- The mark is now **faces**: the Google photo when there is one, otherwise the
  initials on a colour derived from the person, Google's own style — `KB` for
  a folder Kaan Berk shared with you (ringed, because it is theirs), `AY` and
  `I` side by side for a folder you share with Ayşe Yılmaz and Irmak, `+2`
  when there are more than three.
- The name appears in our own tooltip, instantly, on a device with a mouse.
  On a touch screen a tap says it in the usual message strip, which also keeps
  a long name from hanging off the side.

**How verified:** 150 web tests (5 new: initials incl. Turkish letters, steady
colours, who to show for each direction), lint, build. Browser checks: 29
across the notes page, folder tree, composer, both pickers, delete dialog,
reading mode and five tour steps at 360 px, and 23 for the sharing features,
including that the name is hidden until hover and then appears at once.

Note: the new look (D20 above) was designed against the state before this
entry, so the narrow-phone fixes here were re-checked against the new frame
rather than carried over — `.topbar` and `.view-tabs` no longer exist.

### 2026-09-26 — The fonts are ours now (v1.5.1)
**Why:** the new look loaded Fraunces and Instrument Sans from Google's CDN on
every visit — two extra connections, Google seeing every visitor's IP, and
system fallbacks whenever the network is poor. The redesign's own entry left
this open.

**What:** `scripts/fetch-fonts.mjs` downloads them once and writes
`src/fonts.css`; `public/fonts/` holds the files and `index.html` preloads the
two the first screen needs. Only **latin + latin-ext** are bundled — that
covers Turkish (ğ ş ı ö ü ç) — and Fraunces only at **600**, the sole weight
the headings use. Dropping its 500 halved that family: **204 kB in total**,
served from our own origin.

The service worker precaches all eight files (cache `notex-shell-v2`): the
ones in `<head>` are requested before the worker is running, so on first use
they would otherwise be missing exactly when the network is.

**How verified:** a browser check with seven assertions — **nothing at all is
fetched from another host**, both families load, the page title really uses
Fraunces, and Turkish letters resolve from the bundled subsets (the check
forces the latin-ext face to load first; without that it reports a false
negative, since a subset stays unloaded until something needs it). Then
offline on a return visit: the app renders and keeps Fraunces. 150 web tests,
lint and build pass, and the browser suites are unchanged: new frame 37, PWA
11, overlays at 360 px 31.

**Worth knowing:** the app bundle is only cached once the worker is running,
so the very first visit is still online-only; from the second visit on it
works offline. That is why the offline check reloads once before pulling the
plug.

### 2026-09-26 — The Paylaş dialog opened behind the notes (v1.5.2)
**Reported:** "when invite popups show up it stays behind notes."

**The cause, and why `z-index: 65` did nothing:** the dialog is opened from a
folder's ⋯ menu, so it is declared inside `.app-sidebar` — and the new frame
makes that `position: sticky`, which **creates a stacking context**. Inside
it, no z-index can lift a child above content that is painted later in the
page, so the note cards covered the dialog and its backdrop.

**The fix:** `ShareModal` renders through `createPortal(..., document.body)`.
A dialog should not depend on which component happened to declare it; this
also covers anything else the sidebar may open later. The alternative — giving
the sidebar a z-index — would have worked today and broken again the next
time something is stacked.

**Found while fixing it:** Esc did not close that dialog (only the ✕ and a
click outside). It does now, like every other dialog.

**How verified:** a new browser check paints nine points across the dialog and
its backdrop and asserts nothing else is on top — it failed before the change
(`ARTICLE.note`, `DIV.note-top`) and passes after — plus Esc closing it, and
the same check for the note ⋯ and Taşı menus, which were already fine. 150
web tests, and the suites unchanged: new frame 37, sharing 14, fonts 7,
overlays at 360 px 31.

### 2026-09-26 — The same person shown twice on a shared note (v1.5.3)
**Reported:** a folder was shared, then the folder above it with the same
person; the reminder then carried **two identical faces**.

**The cause:** `sharesForPath` returns every share whose folder is a prefix of
the note's path — which is right, that is how a subfolder inherits sharing —
but `sharePeople` and `shareSummary` then treated each share as a person. With
"Ev" and "Ev / Alışveriş" both shared with Irmak, a note inside got two faces
and the label read "irmak ve Irmak ile paylaşıldı".

**The fix:** `byPerson` keeps one share per invited address (case-insensitive,
since the same person can be invited as `Irmak@…` once and `irmak@…` the
next), preferring an accepted share over one still waiting — so a folder you
have already joined is not also counted as a pending invitation.

**How verified:** four unit tests written first, all failing in the way that
was reported (`['irmak@example.com', 'irmak@example.com']`, "irmak ve Irmak")
and passing after; 154 web tests in total. A browser check then confirms one
face and one name in all three places the mark appears — the "Yaklaşan"
strip, the note card and the Hatırlatmalar page — with the parent invited as
`Irmak@Example.com` and the subfolder as `irmak@example.com`.

**Also corrected:** three of the older sharing tests gave two different people
the *same* address, because the test factory defaults one. They only passed
before because nothing deduplicated; each person now carries their own.

### 2026-09-28 — The note box now looks like an invitation (v1.6.0)
**Reported:** "note entering area look confusing on main page, can we
emphasize it?"

**What was wrong:** folded, the composer was a faint dashed rectangle the same
width and nearly the same height as a note card, filled with grey placeholder
text — it read as a disabled note rather than the place to write. The search
box above it was the louder element, which is the wrong way round on a page
whose first job is capturing a note.

**What it is now (computers; on phones the composer stays behind "Not yaz"):**
- a pen in an accent tile on the left, so the box says "write" at a glance;
- a solid edge in `--border-strong` instead of the dashed one, a hairline
  shadow, and accent border plus a lift on hover — it now reacts to the
  pointer;
- a short invitation, **"Yeni not yaz…"** or "<Klasör> klasörüne yeni not
  yaz…", in `--text-soft` at 16 px. The long "Klasörünü AI seçer. Ctrl+Enter
  kaydeder." moved to the open state, where it is actually useful;
- on the right, muted, what will happen: "klasörü AI seçer", or "bu klasöre
  kaydedilir" when a folder is open. Hidden below 860 px.

The pen and that line disappear the moment the box opens, so the writing area
stays clean.

**How verified:** a browser check with 14 assertions — the pen, the hint and
the short placeholder while folded; a solid edge whose colour differs from a
note card's; both stepping aside on open with the full hint returning; saving
still works; and inside a folder the box names it. 154 web tests, lint and
build pass; the suites are unchanged: new frame 37, dark mode 16, overlays at
360 px 31, sharing 14.

**One assumption corrected by the test:** after saving, the box does **not**
fold back — on a computer it deliberately keeps the cursor for the next note
(D20), and folds only when you click away from an empty box. The check now
records that instead of contradicting it.

### 2026-09-29 — Reminder notifications (D21, v1.7.0)
**What:** a reminder can now reach you when it is due, even with the app
closed. `server/src/reminders.js` decides what is due, `server/src/push.js`
sends it, `/api/push/*` keeps the subscriptions, and `POST
/api/reminders/due` is what the scheduler calls. In the browser,
`lib/push.ts` + `PushToggle` on the Hatırlatmalar page turn it on per device,
and the service worker shows the notification and opens the reminders page
when it is tapped.

**How verified:**
- Server: 10 unit tests for *what is due* — one-off fires once, a repeat fires
  today and not for every day since, a completed occurrence stays quiet while
  the next one still fires, the 31st becomes the 30th in a short month, and a
  reminder more than two hours late is dropped. Plus 7 integration tests: a
  device subscribes and can leave, rubbish subscriptions are refused, a
  stranger cannot subscribe, **the scheduler endpoint refuses everyone without
  the secret — including a signed-in user**, a due reminder is sent once and
  not twice, a shared folder notifies the owner alone until the invitation is
  accepted and both afterwards, and a locked note's notification carries no
  words from the note.
- Browser: 12 checks — the button offers, registers the browser and sends the
  endpoint and keys the server needs, says it is on, survives a reload, and
  turns off again. 158 web tests in total, lint and build clean.

**Three things the tests corrected:**
- `currentState()` waited on `navigator.serviceWorker.ready`, which can hang
  for good; the button then never appeared at all. It now asks
  `getRegistration()` with a time limit, and a failure leaves the button
  usable rather than invisible.
- A leap-year test date (29 Feb 2026) is not a date. The clamping was right;
  the test was wrong.
- The push service cannot be reached from here (Chrome disables the Push API
  in incognito, which is what Playwright contexts are; Firefox could not reach
  Mozilla's autopush). The browser check therefore stubs
  `pushManager.subscribe` and nothing else — our code, the service worker and
  the request the server receives are all real. **Delivery itself still needs
  one check on a real device.**

**Next, and it needs you:** set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` in Render from `server/.env` (Render generates `CRON_SECRET`
itself), then create a cron-job.org job calling
`POST https://notex-r2zk.onrender.com/api/reminders/due` with the header
`x-cron-key: <CRON_SECRET>` every 5 minutes. That also keeps Render awake.

### 2026-09-30 — Notifications are live, and a way to test them (v1.7.1)
**Live:** the cron on cron-job.org ran against the deployed server and
answered `{"due":1,"sent":2,"gone":0}` — one reminder due, pushed to two
subscribed browsers, neither subscription stale. That closes the "delivery
still needs a check on a real device" note from D21.

**Added:** `POST /api/push/test` and a **"Deneme gönder"** button beside the
switch on the Hatırlatmalar page (only once notifications are on). It sends a
notification to your own devices immediately, through the same path a reminder
takes. It exists to tell two failures apart that otherwise look identical:
- the message never arrived (subscription, keys, or the server) — the button
  says so, reporting how many devices it reached;
- the message arrived and the system did not show it — the button says it was
  sent, and nothing appears. On Windows that means the app's own entry in
  Settings › System › Notifications, or Focus assist.

**How verified:** a server test that it sends to the caller's devices only and
refuses a stranger (8 push tests in total), and a browser check that the
button appears only when notifications are on, asks the server to send, and
reports the number of devices. 158 web tests, 53 server tests, lint and build
clean.

### 2026-09-30 — The folder AI stops forcing notes into folders you already have (v1.7.2)
**Reported:** "we prioritised existing folders first, I think it was not a good
idea — it tries to put notes in existing folders."

**Measured before changing anything.** `scripts/eval-cloud-ai.mjs` had been
broken since on-device AI was removed: it read the prompt from
`web/src/ai/llm.ts`, a file that no longer exists. It now imports the server's
own prompt, so what it measures is what the app sends, and it gained a
`--seeded` mode that starts from a notebook that **already has ten folders** —
the case being complained about, which the old empty-notebook run could never
show.

With the old prompt, **4 of 8** notes on new topics were pushed into an
existing folder, and three of those were plainly wrong:
- a dog's vaccination card → `Sağlık / Randevular` (the human appointments folder)
- a tax return → `Finans / Faturalar` (bills)
- car tyres → `Ev / Tamirat` (home repairs)

**The change:** the rule that said "if the topic is the same as an existing
folder, use that path exactly" became three lines that say the list is for
consistent naming and the note does not have to fit it; that an existing path
may only be used when the topic is **the same**, since sharing a top-level
heading is not enough; and that when in doubt a new folder is better, because
filing a note in the wrong place is worse than making a folder.

**After:** **2 of 8**, and both bad fits above are gone — the dog goes to
`Sağlık / Hayvanlar`, the tax return to `Finans / Vergiler`. Car tyres still
land in `Ev / Tamirat`, which is the one clear miss left. The empty-notebook
run is unchanged: the same 13 folders, with films and series still sharing
`Eğlence / İzlenecekler` and two doctor's visits sharing
`Sağlık / Randevular` — so sensible reuse survived.

**Deliberately not done:** naming the failing cases (cars, pets) in the prompt.
It would have scored better on this very eval while teaching the model
nothing general.

**How verified:** the two eval runs above against the real model, plus 53
server tests. One run of the full server suite reported a failure in
`push.test.js` that passes on its own and on a re-run — the parallel
throwaway databases again, not the change.

### 2026-10-02 — To-do folders (D22, v1.8.0)

**Why:** "I want to complete option on Hatırlatmalar folder, or I want to set
an complete action to any folder like make completable notes in this folder."
Until now a note could only be ticked off if you had pressed the list button
*while writing it* (`isListItem`), which is the wrong moment to decide: you
find out a folder is a shopping list after there is already something in it.

**What it does:** a folder's ⋯ menu has **"Yapılacaklar klasörü yap"**. After
that every note in it — the ones already there as well as new ones, and
everything in its subfolders — shows a tick box, and the row in the sidebar
carries a small list badge. Ticked notes drop to the foot of the list under a
folded **"Tamamlananlar (n)"** heading, so what is left to do stays on top.
The composer's list button goes quiet in such a folder, saying the folder
already does it.

**Where it is kept:** a `todo_folders (user_id, path_key)` table, so it follows
you to your phone, and the people the folder is shared with (D18) get the same
tick boxes — a shared shopping list is one list. Only the owner sets the mark;
`GET /api/todo-folders` returns your own plus the ones on folders shared with
you, each with whose it is. It follows a rename or a move the way a share does
(`POST /api/todo-folders/move`). Nothing is written to the notes themselves:
unmark the folder and the boxes disappear, with `checked` left as it was.

**Shape:** `server/src/routes/todoFolders.js` and
`server/test/todoFolders.test.js` on the server; `web/src/lib/todo.ts` (the
pure rules: which mark covers a note, the done/undone split, the mark after a
move) with `todo.test.ts`, plus `todoFolders` in the store and the usual
optimistic-save-then-roll-back.

**How verified:** 6 new server tests (the owner marks and unmarks; nobody else
sees it until the invitation is accepted; her own marks stay hers; a rename
carries it, subfolders included; "Yaşamtarzı" is left alone when "Yaşam"
moves; signed out is a 401), 10 new browser unit tests, a store test for the
move and for the roll-back, and a Playwright run on desktop and at 360px: 24
checks, including a note in a folder someone else marked and shared, ticking
one into the group, both menu directions, and no sideways scrolling.

**Next:** nothing outstanding for this feature. The open question about a note
keeping a tick box when it leaves the folder is in the D22 section.

### 2026-10-02 — Backups to Cloudflare R2 (D23, v1.9.0)

**Why:** there was no backup of anything. Every note lived in one Neon
free-tier database, and deleting a note wiped its content in the same statement
that tombstoned it — the confirm dialog was the only thing between a misclick
and permanent loss. Asked where the backup should live, the first idea was a
home server; R2 won because nothing of the owner's has to be switched on, the
Cloudflare account and the cron-job.org scheduler already exist, and it is the
same storage images will want when they leave the database.

**What runs:** `POST /api/backup`, called daily by cron-job.org with the same
`CRON_SECRET` as the reminders, builds one gzipped JSON of every user's live
notes, `protected_folders`, to-do marks and shares, and PUTs it to R2 as
`notex/2026/notex-20261002T030000Z.json.gz`. Nothing is ever deleted or
overwritten; an R2 lifecycle rule prunes, so a bug in the app cannot eat the
history. A failure answers 502 with R2's own message, so the scheduler shows
it rather than the backup silently never happening.

**Locked folders stay locked.** `cipher` is copied verbatim and the salt,
iterations and check value come with it, so the same password opens a restored
copy. The file is useless to whoever takes it (D8).

**Restoring is part of the feature.** `restoreBackup()` is in `src/backup.js`,
and `scripts/restore-backup.mjs` is a thin wrapper, so the tests exercise what
actually runs. It upserts inside one transaction — safe twice, and it never
deletes, so notes written after the backup survive.

**Also:** *Notlarını indir* at the foot of the page downloads the same dump
narrowed to you (`GET /api/export`).

**Signing R2 by hand:** R2 speaks S3, which wants AWS Signature V4 — about 60
lines in `src/r2.js` instead of pulling in the AWS SDK for one PUT. Because a
signing mistake would only appear in production, `test/r2.test.js` pins the
URL, the credential scope, the signed-header list, that the payload really is
hashed into the signature, that a different body or secret changes it, and
that a refusal is reported with what R2 said. `host` and `content-length` are
deliberately left to fetch.

**How verified:** 17 new server tests — 11 for the backup (what goes in, what
stays out, who may ask, the gzipped upload, and a full wipe-and-restore round
trip plus restoring twice) and 6 for the signing. Full server suite 76/76 run
sequentially. Web: 170 tests, and a Playwright run of the download button on
desktop and at 360 px (9 checks: it downloads a real file with the notes in
it, names it by date, says so, and reports a failure instead of doing
nothing).

**Not verified yet:** the signature against the real R2. The structure is
tested but no upload has happened, because that needs the bucket and its
credentials. The first scheduled run will say: a 200 with the object key means
it works, a 502 carries R2's complaint.

**Next:** set up the bucket, the token and the daily cron job (README has the
steps). Then the image-size wins, trash/restore, offline sync, and images to
R2 last.

### 2026-10-02 — Backups without a storage account (D23 amended, v1.10.0)

**Why:** R2 asked for a credit card. The free tier genuinely costs nothing,
but enabling R2 at all wants a payment method on file, and handing one over
for a personal notebook was not worth it. Since R2 was my suggestion, the fix
was mine to make.

**What changed:** the backup is now something you can **fetch**, not only
something the server **pushes**. `GET /api/backup`, with the same
`CRON_SECRET` header, returns the gzipped dump, names it in
`content-disposition` and puts the row counts in `x-notex-counts` so a caller
knows what it got without unzipping. Nothing about the dump itself changed.

**Why this is the better shape regardless:** the destination is no longer the
server's business. Anything that can make an HTTP request with a header can
keep the backups — a scheduled task on a PC, a machine at home, a CI job —
and none of them has to be reachable from the internet. Dropping the file in
a folder a cloud drive already syncs makes it off-site with no API, no key and
no storage account.

**The R2 push stays.** It is written and tested, it is inert without its
credentials, and it is there the day a bucket exists. Deleting working code to
make a point would have cost more than keeping it.

**`scripts/pull-backup.ps1`** is what runs on Windows Task Scheduler: fetches,
writes `notex-<stamp>Z.json.gz` into a folder you choose, keeps the newest N
and deletes the rest. It retries while Render's free instance wakes up,
refuses a file whose first two bytes are not gzip's `1f 8b` (so an HTML error
page from a proxy is never mistaken for a backup), prunes only files matching
its own name pattern, and exits non-zero so a failure shows up as a failed
task rather than a backup that silently never happened.

**How verified:** 2 new server tests (the file comes back gzipped with its
counts header and the right filename; the cron key is required and a
signed-in user cannot pull it either; and it works with no bucket configured,
since that is the whole point) — 78 server tests in all, run sequentially.
The script itself was run against a stub: the 401 path reports the key
mismatch, the success path writes a file that unzips to the backup JSON, and
pruning with `-Keep 3` removed the two oldest while leaving a newest three and
an unrelated file alone. Run against the live server it returned 404, which is
correct — the endpoint had not deployed yet.

**Restore drill on real data (same day):** the first backup the owner pulled
(6 KB gzipped, 28 KB of JSON: 4 users, 24 notes, 2 locked folders, 3 to-do
marks, 2 shares) was restored into a throwaway Postgres through the same
`restoreBackup()` the script calls. Every row came back, no note ids were
invented or lost, the locked folders kept their salt and check value so the
password still opens them, a sha256 over every note's path, content, cipher,
tick and reminder matched, and restoring the file a second time changed
nothing. Worth noting the drill could not exercise encrypted *notes* — there
are two locked folders but nothing in them at the moment — so that part is
still only covered by the test fixtures.

**Next:** set the scheduled task up, then the image-size wins, trash/restore,
offline sync, images to R2 last.

### 2026-10-02 — Images weigh less (v1.11.0)

**Why:** images are stored inline as base64 inside a note's content, so every
one of them is downloaded again on every app open. What they weigh is what the
app costs to open, not just what it costs to store.

**What changed** in `web/src/lib/images.ts`:

1. **WebP instead of JPEG** (0.85). It also keeps transparency, so the white
   rectangle JPEG needed is now painted only on the fallback path.
2. **The 300 KB bypass is gone.** An image that already fitted inside 1600 px
   was stored exactly as it arrived if it was under 300 KB — which is precisely
   what a pasted screenshot is, and the commonest image in this app. Those are
   re-encoded now, at a higher quality (0.92, since lossy artefacts show on
   text) than photos get.
3. **Whichever is smaller wins.** The re-encode is kept only if it is shorter
   than what came in, so storing an image can never make it bigger. This
   matters: an 8×8 flat PNG is 170 characters and beats any WebP container.
4. A GIF over 2 MB now has its first frame taken rather than riding along
   animated in every load. Smaller GIFs keep their animation; SVG is left
   alone entirely, being text and usually tiny.

**Measured in Chromium** (data URL length, which is what is actually stored):

| | source PNG | old (JPEG 0.82) | new (WebP) | |
|---|---|---|---|---|
| photo 2400×1600 | 6774 KB | 192 KB | **168 KB** | −12% |
| screenshot 900×600 | 101 KB | 111 KB | **66 KB** | −35% against what was really stored |
| icon 64×64 transparent | 2210 ch | — | 2103 ch | and keeps its alpha |
| 8×8 flat | 170 ch | — | **170 ch** | original kept; WebP would be 759 |

The screenshot row is the real win, and note the old JPEG column is *larger*
than the source PNG — re-encoding it would have been worse, which is why the
bypass existed and why "keep the smaller" is the right rule rather than
"always re-encode".

**Honest about the photo number:** I had guessed images would roughly halve.
For photos it is 12%, because the old path already downscaled and JPEG'd them;
the only big lever left there is `MAX_SIDE`. Measured on the same image:
1600 px → 166 KB, 1280 px → 119 KB, 1024 px → 60 KB. That is a quality
decision, not a bug, so it was left at 1600 for the owner to choose.

**How verified:** 9 new unit tests for the arithmetic (`fitted`, `smaller`,
`imageFilesFrom`) — canvas does not exist in jsdom, so the encoding itself
cannot be unit-tested — plus 13 Playwright checks that push real PNGs through
the app's own paste/attach path and measure what reaches `PUT /api/notes`:
the photo is WebP, resized to 1600×1067 and smaller than the old JPEG; the
screenshot is no longer waved through; a transparent PNG comes back with
corner alpha 0 rather than white; the 8×8 is stored byte for byte; and for all
four, what is stored is never longer than what came in. 179 web tests, 78
server tests.

**Next:** trash/restore, then offline sync, then images out of the notes table
(the structural fix — compression only goes so far while every image is
re-downloaded on every load).

### 2026-10-02 — The trash (D24, v1.12.0)

**Why:** deleting was the only irreversible thing left in the app. The content
was thrown away in the same statement that tombstoned the note, so a mistaken
tap was final and the confirm dialog was the whole safety net. Backups (D23)
protect against losing the database, not against losing one note between
backups.

**What changed:** `DELETE /api/notes/:id` now only sets `deleted_at`. The note
keeps everything it had for 30 days and can be restored; after that
`purgeTrash()` wipes the content, which is exactly what deleting used to do
straight away. The tombstone row is never removed either way, so devices
syncing with `?since=` still learn about the deletion (D9).

**Undo is the feature.** Deleting shows a toast with **Geri al**, and that is
what will actually get used day to day. The **Çöp kutusu** view, under the
folder tree, is the fallback for when the toast has gone. It also has a
permanent delete, which asks first because that one really is final.

**Emptied by the cron that already runs.** `purgeTrash` is called from
`POST /api/reminders/due`, whose response now carries `purged`. One scheduled
job to set up rather than two; if that job is ever switched off the trash just
stops emptying.

**Loaded only when opened:** deleted notes still carry their images, so the
trash is fetched on demand and `GET /api/notes` returns only a `trashCount`
for the sidebar badge. Having just made images lighter, it would have been
careless to put them back into startup.

**Shared folders:** whoever could see a note sees it in the trash, and
restoring takes the same right as editing. So if Ayşe deletes something in a
folder Kaan shared with her, either of them can put it back — the person who
made the mistake is usually the one who wants to fix it.

**Two things worth knowing.** A note in the trash still occupies storage but
does not count against the 50 MB quota, because that query already ignored
deleted notes; bounded by the 30 days, so it was left rather than making
someone at quota wait for a purge. And the backup still excludes deleted
notes: the dump is the live notebook, and restoring one should not resurrect
what you threw away.

**How verified:** 9 new server tests — the content survives a delete and the
trash says so; restore puts it back in its folder; a locked note is ciphertext
in the trash and comes back encrypted; deleting for good wipes the words but
keeps the tombstone, and the words are really gone from `?since=`; the purge
takes only what has aged out and is a no-op on a second run; both people in a
shared folder can delete and restore; a stranger gets 404s and sees nothing;
restoring something never deleted is a 404; and a save older than the delete
does not resurrect the note while a newer one does. 87 server tests in all.
Plus 23 Playwright checks on desktop and at 360 px: the undo toast and that it
really restores, the sidebar count going up and down, that the trash is
fetched only when opened, the view with its retention line and no composer,
restoring from the list, the confirmation before a permanent delete, and the
`#cop` address.

**Next:** offline sync, then images out of the notes table.

### 2026-10-03 — Long notes fold away, and comments are one click in (D25, v1.13.0)

**Why, in the owner's words:** "Read more for long notes" and "comment area
should be default open when I click the note, not just add comment button".
A long note pushed everything else off the screen, and leaving a comment meant
finding it in the ⋯ menu.

**What it does:** a note's body is clipped to **ten lines** with a fade and a
**Devamını oku**. Opening it expands the note **in place** — the owner chose
that over jumping to the reader, with a separate **Okuma modunda aç** beside
it — and the **comment box comes with it**. Clicking the note's text opens it
too, so reading more and commenting are one gesture.

**The measurement, not a guess.** `useOverflow` compares `scrollHeight` with
`clientHeight`, because how many lines a note takes depends on the window
width, the font and any images. The first attempt had the height limit and the
"is it clipped" class as the same thing, which can never be true: with no
limit applied, nothing ever overflows, so nothing was ever clipped. The limit
is now always on while the note is closed, and the measurement only decides
whether to show the fade and the button.

**Clicking versus copying.** Notes are there to be copied from, so a click is
ignored when it lands on a button, link, image or input, and when it ends a
non-empty selection — dragging to select is safe. Double-clicking a word does
open the note: the first click arrives before any selection exists, and the
only cure is delaying every open by a couple of hundred milliseconds, which is
a bad trade for the common case. The selection survives, so nothing is lost.

**Small things that matter:** a short note opened for its comments says
**Kapat**, not "Daha az göster", since nothing is being shown less — whether
it was clipped is remembered at the moment it opens. Existing comments still
show without opening the note; what opening adds is the box to write a new
one, which stays and keeps focus after posting, because comments come in twos
and threes.

**How verified:** 26 Playwright checks on desktop and at 360 px — a long note
clips to about ten lines (256 px) and a short one does not; Devamını oku
expands it in place (256 → 960 px) with the last line really there; folding
back clips it again and takes the comment box away; clicking a note opens its
comment box; a written comment reaches `PUT /api/notes` and appears on the
card with the box emptied and still open; existing comments show unopened
while the box does not; dragging to select text does not open the note; and
the folder link still opens the folder instead. 179 web tests, 87 server
tests.

**Next:** offline sync, then images out of the notes table.

### 2026-10-03 — Line breaks typed in the editor survive saving (v1.13.1)

**Reported as:** "if I do alt+enter on editor it goes next row but when I save
it goes above again".

**What was actually happening.** Probed in Chromium rather than guessed, and
the three keys behave differently:

| key | what the editor gets | saved |
|---|---|---|
| Enter | `satir1<div>satir2</div>` | correct |
| Shift+Enter | `satir1\nsatir2` — a real newline in the text node | **lost** |
| Alt+Enter | nothing at all | — |

So the reported symptom is Shift+Enter's. The editor is `white-space:
pre-wrap`, which is why a bare `\n` shows as a line break on screen; but
`domToBlocks` collapses runs of whitespace the way a browser lays out HTML, so
on the way to a block that newline became a space and the second line jumped
up to the first. Alt+Enter never inserted anything, so whatever the owner
pressed, one of the two was wrong.

**The fix:** reading our own editor back is a different job from parsing
pasted HTML, so `domToBlocks` takes `{ pre: true }` for it — whitespace is
kept exactly as typed, and `tidyBlocks` only trims the ends instead of
squeezing spaces, stripping indentation and collapsing blank lines. Pasted
HTML still gets all of that, because there it is noise. Alt+Enter now runs
`insertLineBreak` so it does what Shift+Enter does.

**A second thing it fixes for free:** indentation someone typed used to be
stripped (`/ *\n */g` → `\n`), so a hand-made indented list flattened on save.
It is kept now.

**How verified:** 6 new unit tests for editor-mode conversion (a Shift+Enter
newline survives; the `<div>` from plain Enter still works; a blank line
between paragraphs is kept; indentation is kept while the same text pasted as
HTML is still squeezed; images stay in place among the lines; the ends are
trimmed but not the middle) and 7 browser checks that type each of the three
keys and read what reaches `PUT /api/notes`, including editing an existing
note and that it comes back on screen as two lines. 185 web tests, 87 server
tests.
