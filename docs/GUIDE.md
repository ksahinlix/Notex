# Notex — The Complete Guide

A guide to **how Notex is built and why**, written for a developer who knows
how software works but has spent years on low-code platforms and wants to
re-learn the "real code" stack step by step.

It explains every piece we used — GitHub, Neon, Render, JavaScript,
TypeScript, React, Express, LLMs, embeddings — and then walks through each
feature of the app from the button click down to the database row.

> **How this guide relates to the other docs**
> - `README.md` — how to *run* the project (commands, settings).
> - `docs/PROJECT_LOG.md` — the *history*: every decision (D1–D16) with its
>   reasons and measurements, and a dated log of all work.
> - **This guide** — how things *work*, explained from the ground up.
>   Where a decision is explained in the log, you'll see a pointer like **(D9)**.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [One request, end to end](#2-one-request-end-to-end)
3. [The building blocks (every tool and service)](#3-the-building-blocks)
4. [Repository tour (every folder and file)](#4-repository-tour)
5. [The data model](#5-the-data-model)
6. [How each feature works](#6-how-each-feature-works)
7. [Security, in one place](#7-security-in-one-place)
8. [Testing](#8-testing)
9. [Everyday workflows](#9-everyday-workflows)
10. [How we worked with Claude Code](#10-how-we-worked-with-claude-code)
11. [Glossary](#11-glossary)
12. [Learning path: exercises in this codebase](#12-learning-path)

---

## 1. The big picture

### What Notex does

You write a note; the app puts it in the right folder by itself (AI), finds
notes by meaning, turns "yarın 15:00" into a reminder, keeps some folders
encrypted with a password, and works for many users who each sign in with
Google.

### The three places code runs

```
 ┌──────────────────────────────┐        ┌──────────────────────────────┐
 │  1. THE BROWSER  (web/)      │  HTTPS │  2. THE SERVER  (server/)    │
 │  React app, TypeScript       │ ─────▶ │  Node.js + Express           │
 │  - shows the UI              │  JSON  │  - login (Google)            │
 │  - encrypts locked folders   │ ◀───── │  - stores notes              │
 │  - parses reminder dates     │        │  - talks to the AI           │
 │  runs on YOUR device         │        │  runs on RENDER (cloud)      │
 └──────────────────────────────┘        └──────────┬──────────┬────────┘
                                                    │ SQL      │ HTTPS
                                                    ▼          ▼
                                   ┌─────────────────────┐  ┌──────────────────────┐
                                   │ 3a. DATABASE        │  │ 3b. AI               │
                                   │ PostgreSQL on NEON  │  │ Cloudflare Workers AI│
                                   │ notes, users, ...   │  │ Mistral, Qwen, bge-m3│
                                   └─────────────────────┘  └──────────────────────┘

 Also involved:  GitHub (stores the code, triggers deploys)
                 Google (confirms who you are when you sign in)
```

A useful mental model from low-code: the **browser app** is your "screens
and client logic", the **server** is your "backend workflows/API", **Neon** is
the "data tables", and **Render/GitHub** replace the platform's "publish"
button.

### Why this shape?

- **One server serves both the API and the web app** (D6). The browser only
  ever talks to one address (`notex-r2zk.onrender.com`), which avoids CORS
  setup and lets us use the strictest cookie settings.
- **The server holds all secrets** (database password, AI token). The browser
  never sees them. Anything in the browser can be read by anyone.
- **Encryption happens in the browser** (D8). For locked folders, the server
  only ever receives scrambled text — even we, running the server, can't read
  it.
- **Everything is free-tier**: Neon (0.5 GB), Render (sleeps when idle),
  Cloudflare (10,000 "neurons" of AI per day), Google sign-in.

---

## 2. One request, end to end

Before looking at each tool, follow **one note** through the whole system.
You type *"Kredi kartı ekstresi her ayın 28'i"* and press **Ekle**:

```
BROWSER (web/src)                                   SERVER (server/src)            NEON / CLOUDFLARE
─────────────────                                   ───────────────────            ─────────────────
1. RichEditor: you type; onChange gives the text
2. reminder.ts parses "her ayın 28'i"
   → { date: next 28th 09:00, repeat: monthly }
   → Composer shows the reminder chip
3. ~1.2 s after you stop typing, useAi.ts calls
   POST /api/ai/classify {text}  ───────────────▶  4. requireAuth checks cookie
                                                   5. routes/ai.js: limits
                                                   6. service.classify():
                                                      existing folders ─────────▶  SELECT path ... (Neon)
                                                      prompt → Mistral ─────────▶  Workers AI
                                                   ◀── { path: [Finans, Faturalar], isNew, alternatives }
7. The path box fills with "Finans / Faturalar"
8. You press Ekle → store.create():
   - builds the note object (id = new UUID)
   - encrypts it if the folder is locked
   - shows it immediately (local first)
   - PUT /api/notes/<id> {note} ────────────────▶  9. routes/notes.js:
                                                      validate, quota check,
                                                      INSERT ... ON CONFLICT ───▶  row in `notes`
                                                   ◀── 200 + saved note
10. If the save failed: retry 2 s, 4 s … 30 s
```

Every feature in section 6 is a variation of this pattern: **UI → small
library function → store → API route → database/AI → back**.

---

## 3. The building blocks

For each piece: *what it is*, *why we chose it*, *how we use it*, and *where
to find it*.

### 3.1 Git and GitHub

**What.** *Git* is version control: it records every change to the code as a
**commit** (a snapshot with a message). *GitHub* is a website that hosts Git
repositories and adds collaboration features. Our repository:
`github.com/ksahinlix/Notex`.

**Key ideas you'll use:**

| Concept | Meaning in our project |
|---|---|
| **commit** | One saved step, e.g. *"Add a guided tour of the app's features"*. `git log --oneline` lists them. |
| **branch** | A parallel line of work. `main` is what's live; features were built on branches like `guided-tour`, `cloud-ai`. |
| **push / pull** | Upload your commits to GitHub / download others'. |
| **pull request (PR)** | A proposal to merge a branch into `main`, with a description and review. We made PRs #1–#9. |
| **merge** | Taking a branch's commits into `main`. **Merging to `main` deploys the app** (see Render). |
| `.gitignore` | Files Git must never store — here `node_modules/`, `dist/`, and **`.env`** (secrets). |

**Why.** Every change is recorded and reversible, and Render watches `main`
to deploy automatically — this replaces a low-code platform's "publish".

**How we worked.** Branch → commits → PR → you tested locally → merge →
Render deploys. The PR descriptions double as release notes.

### 3.2 Node.js and npm

**What.** *Node.js* runs JavaScript outside the browser (on a server or your
PC). *npm* is its package manager: it downloads libraries ("packages") listed
in `package.json` into `node_modules/`.

**Files to know:**

- `package.json` — the project's name, **dependencies** (needed to run) and
  **devDependencies** (needed only to build/test), and **scripts**:
  ```json
  "scripts": { "dev": "node --env-file-if-exists=.env --watch src/index.js", ... }
  ```
  `npm run dev` runs that line. `--watch` restarts the server when a file
  changes; `--env-file` loads `server/.env`.
- `package-lock.json` — the exact versions installed, so every machine gets
  the same ones. `npm ci` installs exactly those (used on Render).

**Why.** One language (JavaScript/TypeScript) for browser *and* server, the
largest library ecosystem, free hosting everywhere. We require **Node 22+**.

### 3.3 JavaScript and TypeScript

**JavaScript (JS)** is the language of the web. **TypeScript (TS)** is
JavaScript plus *types*: you declare what shape your data has, and a checker
(`tsc`) finds mistakes before the code runs.

```ts
// web/src/lib/types.ts (shortened)
export interface Note {
  id: string
  path: string[]          // ["Finans", "Faturalar"]
  encrypted: boolean
  content: NoteContent | null
  reminderAt: string | null
  repeat?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
}
```

If some code wrote `note.path = "Finans"` (a string, not an array), `tsc`
refuses to build. In low-code terms, types are like the platform knowing your
entity's fields — but enforced in code.

**Where we use which (D10):**

- **`web/` is TypeScript** (`.ts`, `.tsx`): the UI is the largest and most
  complex part, and types catch many mistakes there.
- **`server/` is plain JavaScript** (`.js`) with **ES modules**
  (`import … from …`): it's small, and plain JS needs no build step.

Language features you'll see often:

| Syntax | Meaning |
|---|---|
| `const x = …` / `let x = …` | variable that can't / can be reassigned |
| `(a, b) => a + b` | arrow function |
| `` `Merhaba ${name}` `` | template string with a value inside |
| `obj?.field` | "field, or undefined if obj is missing" |
| `a ?? b` | "a, or b if a is null/undefined" |
| `{ ...note, path }` | copy of `note` with `path` replaced |
| `async function` / `await` | wait for slow work (network, database) without freezing |

### 3.4 React (the UI library)

**What.** React builds UIs from **components**: functions that take inputs
(**props**) and return what to show (JSX, HTML-like syntax in `.tsx` files).
When data changes, React re-renders the affected parts.

```tsx
// a tiny example in the style of our code
function ReminderChip({ at, onRemove }: { at: string; onRemove: () => void }) {
  return (
    <div className="reminder-chip">
      Hatırlatma: <b>{formatDate(at)}</b>
      <button onClick={onRemove}>✕</button>
    </div>
  )
}
```

**Hooks** — special functions that give components memory and side effects:

| Hook | What it does | Example in Notex |
|---|---|---|
| `useState` | a value that survives re-renders | `Composer`: the typed text, the chosen path |
| `useEffect` | run code after render (timers, network) | `useAi.ts`: call the AI 1.2 s after typing stops |
| `useMemo` | cache a computed value | `NotesPage`: the folder tree from the notes |
| `useRef` | a handle to a DOM element | the editor box, file inputs |
| `useSyncExternalStore` | subscribe to data kept outside React | `state/store.ts`, `state/toast.ts` |

**Why React (19).** The most widely used UI library, huge ecosystem, and the
prototype was already React.

**Our state approach.** Notes, folders and keys live in a small **store**
class (`web/src/state/store.ts`) outside React. Components read it with
`useNotex()` and call actions like `store.create(...)`. This keeps async logic
(saving, retrying, encrypting) in one place, not scattered over components.

### 3.5 Vite, Vitest and oxlint (web tooling)

- **Vite** — the web app's dev server and bundler. `npm run dev` serves the
  app at `localhost:5173` with instant reload on save; `npm run build` makes
  the optimized files in `web/dist/` that Render serves. Our
  `vite.config.ts` **proxies `/api` to `localhost:8000`**, so in development
  the browser also talks to one address, exactly like production.
- **Vitest** — the test runner for the web code (`npm test`).
- **oxlint** — a fast "linter": it flags suspicious code (unused variables,
  mistakes React commonly warns about). `npm run lint`.
- **`tsc -b`** — the TypeScript checker; part of `npm run build`.

### 3.6 Express (the server framework)

**What.** Express turns HTTP requests into function calls. You declare
**routes** (method + path → handler) and **middleware** (functions that run
before handlers, e.g. "is the user logged in?").

```js
// server/src/app.js (shortened)
const auth = requireAuth(sessionSecret)                 // middleware
app.use("/api/notes", auth, notesRouter(pool))          // all note routes need login
app.use("/api/ai", auth, aiRouter(aiService, { pool }))

// server/src/routes/notes.js (shortened)
r.delete("/:id", async (req, res) => {
  const { rowCount } = await pool.query(
    "UPDATE notes SET deleted_at = now() ... WHERE id = $1 AND user_id = $2",
    [req.params.id, req.userId])
  res.status(rowCount ? 204 : 404).end()
})
```

**HTTP basics used everywhere:** *GET* reads, *PUT* creates/replaces, *POST*
does an action, *DELETE* removes. Status codes: **200** OK, **204** OK with no
body, **400** bad input, **401** not logged in, **403** not yours, **404** not
found, **409** conflict (newer version exists), **413** too large, **429** too
many requests, **502/503** a service behind us failed / isn't configured.

**Why Express (5).** Small, well known, free to host (D4).

### 3.7 PostgreSQL, SQL and the `pg` library

**PostgreSQL** is a relational database: data in **tables** of rows and
columns, queried with **SQL**. Features we rely on:

- `TEXT[]` — an array column: `path` is `{'Finans','Faturalar'}`.
- `JSONB` — a JSON document column: `content` holds text, blocks, comments.
- `TIMESTAMPTZ` — a point in time with time zone.
- `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE ...` — "create or replace,
  but only if my version is newer" (our whole sync model, D9).
- Constraints — e.g. `notes_payload_check`: an encrypted note must have
  `cipher` and no `content`, a plain one the opposite. The database itself
  refuses broken data.

**`pg`** is the Node library that talks to Postgres. We use a **Pool** (a few
reusable connections, `server/src/db.js`) and **parameterized queries**
(`$1, $2` + values array). Parameters are never pasted into the SQL text,
which is what prevents **SQL injection**.

**Schema & migrations.** The whole database structure is in
`server/db/schema.sql`. It's written to be **idempotent** — safe to run again
and again (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Render
runs it on **every start** (`npm run migrate`), so adding a column = adding a
line to that file.

### 3.8 Neon (hosted PostgreSQL)

**What.** A cloud Postgres service. We use the free tier: 0.5 GB storage; the
database **sleeps** when idle and wakes on the first query (a second or two).

**Why (D5).** Render's free servers have no permanent disk (a file database
would be wiped on each restart), and Render's own free Postgres expires after
30 days. Neon's free tier doesn't expire.

**How we connect.** One connection string in `DATABASE_URL`:
```
postgresql://neondb_owner:<password>@ep-....neon.tech/neondb?sslmode=verify-full
```
It contains the password — it lives only in `server/.env` (your PC) and in
Render's settings, never in Git. (Early on, the password was pasted into a
chat and then rotated; that's the reflex to keep.)

### 3.9 Render (hosting)

**What.** A cloud service that runs our server. We use one free **Web
Service**, defined in `render.yaml` (a "Blueprint"):

```yaml
buildCommand: cd web && npm ci --include=dev && npm run build && cd ../server && npm ci --omit=dev
startCommand: cd server && npm run migrate && npm start
healthCheckPath: /api/health
```

- **Build**: install web packages (incl. dev tools — needed to build, a bug we
  fixed early), build the web app into `web/dist`, install server packages.
- **Start**: apply the schema, start Express, which serves `/api/*` **and** the
  files in `web/dist`.
- **Deploy trigger**: every merge to `main` on GitHub.
- **Environment variables** (secrets) are set in Render's dashboard:
  `DATABASE_URL`, `SESSION_SECRET` (generated by Render), `GOOGLE_CLIENT_ID`,
  `OWNER_EMAIL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.
  Changing one restarts the service.
- **Free tier**: the service **sleeps after ~15 minutes idle**; the first
  visit afterwards takes up to a minute. Logs are in the dashboard's **Logs**
  tab — the first place to look when something fails in production.

### 3.10 Cloudflare Workers AI (the AI provider)

**What.** Cloudflare runs open AI models on their GPUs and lets you call them
over HTTPS. Free: **10,000 neurons per day** (their usage unit).

**Models we use** (`server/src/ai/cloudflare.js`):

| Job | Model | Why |
|---|---|---|
| Pick/create a folder | `mistral-small-3.1-24b-instruct` | 17/17 sensible folders on our Turkish test notes |
| Backup for the above | `qwen3-30b-a3b-fp8` | fast and ~6× cheaper; used when Mistral fails |
| Re-rank search results | `mistral-small-3.1-24b-instruct` | best at "is this note about the query?" |
| Text → vector (search) | `bge-m3` | multilingual embeddings, 1024 numbers per text |

**Setup.** `CLOUDFLARE_ACCOUNT_ID` (the 32 characters in the dashboard URL)
and `CLOUDFLARE_API_TOKEN` ("Workers AI" template with *Account Resources*
set — the two things that went wrong during setup).

**Why cloud AI (D15, replacing D3/D12/D13).** We first ran AI **in the
browser** (transformers.js for search, WebLLM + WebGPU for folders). It worked
on your PC's GPU but needed a 1.5 GB download per device and a strong GPU —
unrealistic on phones. Moving it to Cloudflare made it work everywhere, with
better models, still free. Locked notes are never sent.

### 3.11 LLMs, embeddings and prompts — the AI concepts

**LLM (Large Language Model).** A model that continues text. You give it
**messages** — a *system* message (instructions) and a *user* message (the
input) — and it writes a reply. We ask it to reply **only JSON**:

```
system: "Sen bir not uygulamasında notları konularına göre klasörlere ayıran asistansın. …
         Örnekler: "Dune 2 izlenecek" -> {"konu":"izlenecek film","path":["Eğlence","İzlenecekler"]} …
         Sadece JSON döndür."
user:   "MEVCUT KLASÖRLER:
         - Finans / Faturalar
         - Sağlık / Randevular
         Not: "Elektrik faturası 450 TL""
reply:  {"konu":"fatura","path":["Finans","Faturalar"]}
```

Terms:

- **Prompt** — the instructions + examples. Ours is in
  `server/src/ai/prompts.js`. We measured three designs; the winner asks for
  the **topic first** ("konu"), then the path, and shows **10 varied examples**.
  Showing the existing folders makes the model reuse them.
- **Few-shot examples** — the example input→output lines inside the prompt.
- **Temperature** — randomness; we use **0** for consistent answers.
- **Tokens** — models read and write text in chunks (~¾ of a word). Cost and
  limits are counted in tokens. A folder request is ~700 tokens in, ~30 out.
- **Structured output / JSON** — models don't always obey; `extractJson()`
  copes with the three formats Workers AI returns, and `cleanPath()` tidies the
  answer (capital letters, no "Kitaplar / Kitaplar", reuse existing spelling).
- **Reasoning models** — some (Qwen3, gpt-oss) "think" before answering; we
  add `/no_think` for Qwen3 so it doesn't spend its budget thinking.

**Embeddings (vectors).** An embedding model turns a text into a list of
numbers (1024 for bge-m3) so that texts with similar **meaning** get similar
numbers. Similarity is measured with **cosine similarity** (for normalized
vectors, the dot product): 1 = same direction, 0 = unrelated.

```
"Mutfak musluğu damlatıyor"  → [0.021, -0.113, 0.064, …]  ┐
"evde bozulan şeyler"        → [0.018, -0.097, 0.071, …]  ┘ similar → high score
"Inception filmi"            → [-0.140, 0.052, -0.009, …]    different → low score
```

**Search = shortlist + re-rank.** Vectors alone found 11/20 expected notes in
our test; small models can't draw a clean line between "related" and "not".
So: vectors pick the **20 closest notes** (cheap, fast), then the LLM reads
that shortlist and keeps the **relevant** ones (smart). Result: 16/20.

**How we chose models: measure, don't guess.** Every AI decision in the log
has a table from a script run on realistic Turkish notes
(`server/scripts/eval-cloud-ai.mjs`, `eval-cloud-search.mjs`). Re-run them
when a new model appears.

### 3.12 Google sign-in (OAuth / OpenID Connect)

**What.** "Sign in with Google" lets Google confirm who the user is, so we
never store passwords (D16).

**The pieces:**

- **OAuth client ID** — created in Google Cloud Console; identifies *our app*
  to Google. Not a secret (it's in every page).
- **Authorized JavaScript origins** — the only websites allowed to use that
  client ID: `https://notex-r2zk.onrender.com` and `http://localhost:5173`.
- **Google Identity Services** — Google's script (`accounts.google.com/gsi/client`)
  that draws the button (`web/src/lib/google.ts`).
- **ID token** — after you choose your account, Google hands our page a signed
  **JWT** (a JSON document with Google's digital signature) saying "this is
  user *sub* with email *x*, for client *y*".

**Flow:**
```
Browser: Google button → ID token ──POST /api/auth/google──▶ Server:
  google-auth-library verifies the signature + audience (our client ID)
  → find or create the user (users table, by Google's "sub")
  → set our own session cookie (see 6.1)
```

### 3.13 Testing and helper tools

- **node:test** — Node's built-in test runner for the server (`npm test`).
- **embedded-postgres** — downloads a real Postgres and starts a throwaway
  database for server tests, so they run on your Windows PC with no install
  (`server/test/helpers/db.js`). It needed `--locale=C` because Windows'
  locale name "Turkish_Türkiye" contains a non-ASCII letter.
- **jsdom** — a fake browser DOM for testing HTML parsing in Node.
- **Playwright** — drives a real Chromium/Chrome to click through the app
  (used from a scratch folder, not committed; see section 8).

### 3.14 Browser platform features we used

| Feature | Where | For |
|---|---|---|
| **Web Crypto** (`crypto.subtle`) | `lib/crypto.ts` | PBKDF2 + AES-GCM encryption of locked folders |
| **contentEditable** | `RichEditor.tsx` | a text box that can contain images |
| **Clipboard / DataTransfer** | `RichEditor.tsx`, `paste.ts` | reading pasted HTML and images |
| **HTML5 drag & drop** | `NoteCard.tsx`, `Sidebar.tsx` | moving notes and folders |
| **Canvas** | `lib/images.ts` | shrinking images before saving |
| **localStorage** | reader text size, "tour done", theme | small per-browser preferences |
| **CSS variables + `prefers-color-scheme`** | `index.css`, `lib/theme.ts` | dark mode that follows the device or the user's choice |
| **URL hash** | `#hatirlatmalar` | the Reminders page survives reload |
| **Build-time constant** (`define`) | `lib/version.ts` | the version under the composer, compared with the server |

---

## 4. Repository tour

```
Notex/
├── README.md            how to run, configure and deploy
├── CLAUDE.md            instructions Claude Code reads at the start of every session
├── render.yaml          Render deployment definition
├── .gitignore           never commit: node_modules, dist, .env
├── docs/
│   ├── GUIDE.md             ← this file
│   ├── PROJECT_LOG.md       decisions D1–D16 + dated work log
│   ├── prototype.jsx        the original single-file prototype (reference only)
│   └── original-summary-tr.md  the first Turkish project summary
├── server/              Node.js + Express backend (plain JavaScript)
│   ├── package.json
│   ├── .env.example     template for server/.env (secrets, never committed)
│   ├── db/
│   │   ├── schema.sql       the database structure (idempotent)
│   │   └── migrate.js       applies schema.sql  (npm run migrate)
│   ├── src/
│   │   ├── index.js         starts the server: reads settings, creates the app
│   │   ├── app.js           builds the Express app: middleware + routes + static files
│   │   ├── db.js            the Postgres connection pool
│   │   ├── auth.js          session cookie (sign/verify), requireAuth, Google token check
│   │   ├── users.js         find/create users; owner takes over old notes
│   │   ├── routes/
│   │   │   ├── notes.js         GET/PUT/DELETE notes, validation, storage quota
│   │   │   ├── protectedFolders.js  locked-folder records (salt, check value)
│   │   │   ├── ai.js            /api/ai/classify, /api/ai/search, per-user limits
│   │   │   └── imageProxy.js    fetches web images for pasted content (SSRF-guarded)
│   │   └── ai/
│   │       ├── cloudflare.js    Workers AI client, model list, extractJson
│   │       ├── prompts.js       prompts + cleanPath
│   │       └── service.js       classify() and search(), vector syncing
│   ├── scripts/
│   │   ├── eval-cloud-ai.mjs      compares models at choosing folders
│   │   └── eval-cloud-search.mjs  compares search strategies
│   └── test/            API, auth, AI and image-proxy tests (+ helpers/db.js)
└── web/                 React frontend (TypeScript)
    ├── package.json, vite.config.ts, tsconfig*.json, index.html
    └── src/
        ├── main.tsx         entry point: mounts <App/>
        ├── App.tsx          login screen vs. notes page; logout
        ├── index.css        all styles (colors as CSS variables at the top)
        ├── lib/             PURE logic — no UI, easy to test (each has *.test.ts)
        │   ├── types.ts         Note, NoteContent, ProtectedFolder
        │   ├── api.ts           every server call in one place
        │   ├── crypto.ts        folder encryption
        │   ├── notes.ts         create / seal (encrypt) / open (decrypt) notes; search match
        │   ├── tree.ts          folder tree from note paths
        │   ├── move.ts          rules for moving notes and folders
        │   ├── reminder.ts      Turkish date/repeat parser
        │   ├── recurrence.ts    repeating-date math
        │   ├── agenda.ts        the Reminders page's grouping
        │   ├── reminderPresets.ts  picker quick choices
        │   ├── paste.ts         pasted HTML → text & image blocks
        │   ├── images.ts        image shrinking, fetching via proxy
        │   ├── highlight.ts     search-word highlighting
        │   ├── format.ts        date formatting
        │   ├── google.ts        loads Google's sign-in script
        │   ├── sharing.ts       shared folders: grouping, invite links
        │   ├── theme.ts         Sistem/Açık/Koyu: save, load, apply
        │   └── tour.ts          guided tour steps
        ├── state/           app-wide state
        │   ├── store.ts         notes, folders, keys; create/update/move/lock; retries
        │   ├── confirm.ts       in-app "are you sure?" dialog
        │   └── toast.ts         bottom messages with actions (undo …)
        ├── ai/useAi.ts      hooks that call the AI routes (debounce, cache)
        └── components/      the UI
            ├── NotesPage.tsx    the main screen: header, tabs, tree, list, search
            ├── Composer.tsx     the bottom "write a note" bar
            ├── RichEditor.tsx   text + image editor (also used for editing)
            ├── NoteCard.tsx     one note in the list (+ edit mode)
            ├── NoteBody.tsx     a note's text/images with highlights
            ├── Sidebar.tsx      folder tree, drag & drop, folder menu
            ├── MoveMenu.tsx     "Taşı" folder picker
            ├── RemindersPage.tsx  agenda: overdue, 6 months, undated
            ├── UpcomingStrip.tsx  small "Yaklaşan" strip on the notes page
            ├── ReminderPicker.tsx time/repeat popover
            ├── Reader.tsx       full-screen reading mode
            ├── Tour.tsx         guided tour
            ├── ShareModal.tsx   invite someone to a folder
            ├── SharedTree.tsx   the "Paylaşılan" group in the sidebar
            ├── InviteBanner.tsx accept an invitation
            ├── ThemeToggle.tsx  header button that switches the theme
            ├── PasswordModal.tsx, ConfirmDialog.tsx, ToastHost.tsx, Lightbox.tsx
```

**A pattern worth copying:** logic lives in `lib/` as small **pure
functions** (input → output, no screen, no network). Components stay thin.
That's why most of the 134 web tests don't need a browser.

---

## 5. The data model

### Tables (Neon)

```
users                      notes                                    protected_folders
─────                      ─────                                    ─────────────────
id (uuid)        ◀──┐      id (uuid from the browser)               user_id ──▶ users
google_sub (uniq)   ├───── user_id                                  path_key "Kişisel/Günlük"
email, name,        │      path  TEXT[]  {Finans,Faturalar}         salt, iterations
picture             │      encrypted  bool                          check_cipher
                    │      content JSONB   (plain notes)            deleted_at
                    │      cipher  TEXT    (encrypted notes)        (unique per user+path)
                    │      is_list_item, checked
                    │      reminder_at, is_reminder,
                    │      reminder_repeat, reminder_done_until
                    │      created_at, updated_at, deleted_at
                    │
ai_usage            │      note_vectors
────────            │      ────────────
user_id ────────────┘      note_id ──▶ notes (ON DELETE CASCADE)
day, calls                 text_hash, vector REAL[1024]
```

- **Folders are not a table.** A folder exists because notes have that
  `path`. The tree is computed in the browser (`lib/tree.ts`). Moving a folder
  = changing the `path` of its notes.
- **Soft delete ("tombstone").** Deleting sets `deleted_at` and wipes the
  content, so other devices learn about the deletion (D9).
- **What stays readable on the server for locked notes:** the folder path,
  checked state and reminder time/repeat — so the tree and reminders work
  while locked. The text, reminder label, comments and images are inside
  `cipher`.

### The note as JSON (what the API sends)

```json
{
  "id": "8f3c…", "path": ["Finans", "Faturalar"],
  "encrypted": false,
  "content": {
    "text": "Kredi kartı ekstresi her ayın 28'i",
    "blocks": [{ "type": "text", "content": "Kredi kartı ekstresi her ayın 28'i" }],
    "reminderLabel": "Kredi kartı ekstresi her ayın 28'i",
    "comments": []
  },
  "cipher": null,
  "isListItem": false, "checked": false,
  "reminderAt": "2026-09-28T06:00:00.000Z", "isReminder": true,
  "repeat": "monthly", "reminderDoneUntil": null,
  "createdAt": "…", "updatedAt": "…", "deletedAt": null
}
```

Times are stored in **UTC** (`…Z`); 09:00 in Turkey is 06:00 UTC. The browser
converts for display.

### The API

| Method & path | Does |
|---|---|
| `GET /api/health` | "server and database are up" (Render checks this) |
| `GET /api/auth/config` | Google client ID for the button |
| `POST /api/auth/google` | sign in with a Google ID token |
| `GET /api/auth/me` | who am I? |
| `POST /api/auth/logout` | clear the cookie |
| `GET /api/notes` | my live notes (`?since=` for changes incl. deletions) |
| `PUT /api/notes/:id` | create or replace one note (last-write-wins) |
| `DELETE /api/notes/:id` | tombstone |
| `GET/PUT/DELETE /api/protected-folders[/:pathKey]` | locked-folder records |
| `POST /api/ai/classify` | folder for a text |
| `GET /api/ai/search?q=` | note ids by meaning |
| `GET /api/image-proxy?url=` | fetch a web image for pasted content |

All except health/config/login need the session cookie.

---

## 6. How each feature works

### 6.1 Sign-in and sessions

*Files: `web/src/App.tsx`, `lib/google.ts`, `server/src/auth.js`, `users.js`, `app.js`.*

1. The login screen asks `/api/auth/config` for the client ID and loads
   Google's script, which draws the button.
2. After you pick an account, Google gives the page an **ID token**; the page
   posts it to `/api/auth/google`.
3. The server verifies it with `google-auth-library` (signature + our client
   ID + verified email), then `upsertGoogleUser` finds you by Google's stable
   `sub` or creates you. **First sign-in with `OWNER_EMAIL`** takes over notes
   from the single-user era (`user_id IS NULL`).
4. The server sets a cookie `notex_session` containing
   `base64({uid, exp}) + "." + HMAC-SHA256(that, SESSION_SECRET)`.
   - **HMAC** = a signature only someone with `SESSION_SECRET` can produce, so
     the cookie can't be forged or edited (change the uid → signature fails).
   - `httpOnly` (JavaScript can't read it), `SameSite=Strict` (other sites
     can't send it), `Secure` in production, valid **30 days**.
5. Every protected route runs `requireAuth`, which checks the signature and
   expiry and sets `req.userId`. **Every query then filters by `user_id`** —
   that's what separates users.

No session table is needed: the server trusts its own signature.

### 6.2 Saving notes: local first, then the server

*Files: `state/store.ts`, `lib/notes.ts`, `server/src/routes/notes.js`.*

- **Local first.** `store.create/update/move` change the in-memory list
  immediately (the UI never waits), then `push()` sends `PUT /api/notes/:id`.
- **IDs come from the browser** (`crypto.randomUUID()`), so a note has its
  final id before the server has seen it.
- **Last write wins (D9).** The server's upsert only replaces a note if the
  incoming `updatedAt` is newer. Otherwise it answers **409** with its current
  version, and the browser adopts it.
- **Retries.** If a save fails (network, Render or Neon waking up), it's
  queued and retried after 2, 4, 8 … up to 30 seconds; the banner shows why and
  disappears when everything is saved. Closing the tab with unsaved changes
  asks for confirmation. A 401 asks you to log in again instead.
- **Quota.** The server refuses a save that would take the user over 50 MB
  (413).

> Honest note: the app is *not* fully offline yet. Notes are kept in memory,
> not in the browser's storage, so a reload needs the server (D9 describes the
> planned offline-first step; the `?since=` endpoint is already there for it).

### 6.3 Folders and the tree

*Files: `lib/tree.ts`, `components/Sidebar.tsx`.*

`buildTree(notes)` walks every note's `path` and builds nested nodes with
counts. Selecting a folder filters the list to notes whose path **starts
with** it (`pathStartsWith` compares whole segments, so "Work" doesn't match
"Workshop"). Reminder notes are left out of the notes tree (they have their
own page).

### 6.4 Locked (encrypted) folders

*Files: `lib/crypto.ts`, `lib/notes.ts` (`seal`/`open`), `state/store.ts`
(`protect`, `unlock`, `lock`), `PasswordModal.tsx`.*

```
password + random salt ──PBKDF2-SHA256, 600,000 rounds──▶ 256-bit key (stays in memory)
note content (JSON) ──AES-GCM with key + random 12-byte IV──▶ "ivBase64:cipherBase64"
```

- **PBKDF2** is deliberately slow (600k rounds) so guessing passwords is
  expensive. **AES-GCM** encrypts *and* detects tampering.
- **No password hash is stored** (D8). To check a password we keep
  `checkCipher` — a known value encrypted with the key; the password is right
  iff it decrypts. (The prototype stored a fast SHA-256 hash, which made the
  slow PBKDF2 pointless.)
- Protecting a folder encrypts the notes already in it. Unlocking decrypts
  them into `state.plain` (memory only); locking or logging out forgets them.
- **The key depends on password + salt, not on the path**, which is why a
  locked folder can be moved without re-encrypting its notes (6.9).
- If you forget a folder's password, those notes can't be recovered — by
  design, nobody else can decrypt them either.

### 6.5 AI folder suggestions

*Files: `components/Composer.tsx`, `ai/useAi.ts`, `server/src/routes/ai.js`,
`server/src/ai/*`.*

1. While the path box is left empty ("AI-controlled"), `useCategorySuggestion`
   waits until you stop typing for **1.2 s**, then calls `/api/ai/classify`.
   Answers are cached per text; an outdated request is cancelled.
2. The server checks limits (40/min, **150/day per user** in `ai_usage`), then
   `service.classify`:
   - loads **your** existing folders (most-used first),
   - asks **Mistral** with the prompt; if that fails, **Qwen3**,
   - `cleanPath` tidies the answer and reuses existing spelling,
   - in parallel, finds the **3 existing folders** whose notes are most
     similar by vectors → the other chips.
3. The first chip is the AI's folder (tagged **yeni** if new); the path box
   shows it; **Ekle** waits while an answer for the *current* text is pending
   (a bug we caught: a new note briefly inherited the previous note's folder).
4. If you type a path or pick a folder in the tree, the AI isn't asked at all
   — so a note written into a locked folder is never sent anywhere.

### 6.6 Search: words + meaning

*Files: `NotesPage.tsx`, `lib/notes.ts` (`matchesQuery`), `lib/highlight.ts`,
`ai/useAi.ts`, `server/src/ai/service.js`.*

1. **Word matches** are computed in the browser instantly (Turkish-aware
   lower-casing: "İ" → "i", "I" → "ı") over text, comments and path.
2. **Meaning matches**: 0.8 s after typing stops, `/api/ai/search`:
   - `syncVectors(user)`: any plain note whose text changed (compared by a
     SHA-256 `text_hash`) gets a new **bge-m3** vector in `note_vectors`;
     encrypted/deleted notes lose theirs.
   - embed the query → cosine similarity with all your vectors → **top 20**.
   - **Mistral re-ranks**: "which of these are about the query?" → ids.
     If that fails, the top 8 by vector are used.
3. The list shows word matches first, then meaning matches with the
   **✨ anlamca ilgili** label; words are highlighted with `<mark>`.
4. Search covers **all** notes (not only the selected folder), and AI errors
   (limit reached, timeout) are shown, not hidden.

### 6.7 Reminders

*Files: `lib/reminder.ts`, `lib/recurrence.ts`, `lib/agenda.ts`,
`lib/reminderPresets.ts`, `Composer.tsx`, `ReminderPicker.tsx`,
`RemindersPage.tsx`, `UpcomingStrip.tsx`.*

**Reading dates from text (D14)** is done with **rules, not AI** — instant,
free, testable, and date arithmetic is exactly what small models get wrong.
`parseReminder` recognizes, in this order:

1. **Repeats**: "her ayın 28'i", "her pazartesi 10:00", "her gün 8'de",
   "her yıl 5 Mart", "aylık/haftalık/günlük/yıllık" → a rule + the first date.
2. **Dates/times**: "yarın 15:00", "perşembe akşam 7'de", "3 gün sonra",
   "25 Ekim'de", "30.09", "yarım saat sonra", and a day of the month with no
   month name: "ayın 26'sında", "gelecek ayın 3'ünde", plain "26'sında"
   (this month, or the next month that has that day).
3. **Reminder words** without a date: "hatırlat", "unutma", "remind…" →
   an **undated** reminder.

Any note with a date in it becomes a reminder; the keywords are only needed
when there is no date.

Details that needed care: JavaScript's `\b` doesn't understand Turkish letters
(we use Unicode-aware boundaries); "React 19.2" must not become 19 February;
"31'i" must match 31, not 3. For a bare day of the month the possessive plus
"-de" is required ("26'sında"), so "bu ay 3 kitap okudum" and "sayfa 26'da"
stay ordinary notes.

**Repeats** (`recurrence.ts`): the first date is the *anchor*
(`reminderAt`); the k-th monthly occurrence is the same day k months later,
or the **last day** of shorter months (31 → 30/28; 29 Feb → 28 Feb).
✓ on a repeating reminder sets `reminderDoneUntil` = that occurrence, so only
that one disappears.

The Reminders page can also **edit a reminder** (the pencil opens the ordinary note card in edit mode, so text, images, folder and time all work the same) and **rename or share its folder** from the ⋯ menu in the folder list.

**The Reminders page** (`agenda.ts`): Gecikmiş (overdue, incl. the latest
missed repeat), the **next 6 months by month** (monthly/yearly: every
occurrence; weekly: next 4 weeks; daily: next one only — otherwise a daily
pill fills 180 rows), Tarihsiz, Tamamlananlar.

**The "Yaklaşan" strip** on the notes page (`stripItems` in `agenda.ts`)
shows everything overdue, **every undated reminder**, and the coming 7 days.
Reminder notes are deliberately not in the note list, so the strip is the
only thing standing between a reminder and being forgotten: an undated one
has no date to bring it back, so it stays until it is ticked off or given a
time. If nothing falls in the week, the next reminder is shown anyway, so
the strip (and its "Tümü" link) never disappears while reminders exist.

### 6.8 Writing, pasting web content, images

*Files: `RichEditor.tsx`, `lib/paste.ts`, `lib/images.ts`,
`server/src/routes/imageProxy.js`.*

- The editor is a **contentEditable** `<div>` holding only text and `<img>`.
  Formatting is dropped on purpose. It grows to 40% of the screen, then
  scrolls; ⤢ gives full-screen writing.
- **Paste** reads the clipboard's HTML: `htmlToBlocks` walks it like a browser
  would (block elements = new lines, whitespace collapsed), picks the largest
  image from `srcset`, the real one behind lazy-loading placeholders, and keeps
  **text and images in order**.
- Each image becomes a grey placeholder, then loads **directly** or — when the
  site blocks it (CORS) — through our **`/api/image-proxy`**. **Ekle** waits
  until all images are in.
- Images are **shrunk** to max 1600 px JPEG before saving (Neon's 0.5 GB).
- The proxy is guarded against **SSRF** (someone using our server to reach
  internal addresses): login required, http(s) only, **every redirect's**
  address checked against private ranges (127.x, 10.x, 169.254.x …), images
  only, 8 MB, 10 s timeout.

### 6.9 Moving notes and folders

*Files: `lib/move.ts`, `state/store.ts` (`move`, `moveFolder`),
`NoteCard.tsx`, `Sidebar.tsx`, `MoveMenu.tsx`, `NotesPage.tsx`.*

- **Rule 1 — a moved note keeps its folder name.** "Sistem Tasarım / LSA"
  dropped on "Yazılım" → "Yazılım / LSA". The toast offers **"Sadece Yazılım
  içine koy"** and **Geri al**. A path you *type* in Taşı is used exactly.
- **Rule 2 — folders move whole.** Drag a folder's name, drop on another
  folder or on "Tümü" (top level), or use **⋯ → Yeniden adlandır / Taşı…**.
  `moveFolder` plans every note:
  - no lock change, or the locked folder moves along → only the `path` changes
    (encrypted notes keep their cipher — the key doesn't depend on the path);
  - entering or leaving a locked folder → decrypt/re-encrypt (asks passwords);
  - protected-folder records are saved under the new path, old ones deleted;
  - nesting locked folders is refused; a cancelled password changes nothing.
- **Drag & drop details**: only the ⋮⋮ handle drags (so text is selectable),
  drop highlights count enter/leave events (no flicker), hovering a collapsed
  folder opens it, and **Taşı** works on touch screens where HTML5 drag &
  drop doesn't.

### 6.10 Sharing a folder with someone (D18)

*Files: `server/src/shares.js`, `server/src/routes/shares.js`,
`lib/sharing.ts`, `ShareModal.tsx`, `SharedTree.tsx`, `InviteBanner.tsx`.*

The unit is a **folder**. Invite someone by e-mail from the folder's ⋯ menu;
they get everything inside it, subfolders included, and may add, edit,
complete and delete. Ticking a reminder off completes it for everyone.

**How an invite travels without an e-mail server:** the invite row names the
invitee by address and carries a random token. The owner copies the link
`/davet/<token>` and sends it themselves (WhatsApp, anything). Opening it
while signed in with that address accepts the invite. If the person has no
account yet, the row simply waits: `linkInvites` attaches it the first time
that e-mail signs in. **Nothing is shared until the invite is accepted.**

**The rule that keeps people apart** used to be "every query is scoped to
`req.userId`". It is now "every query covers what this user may see", and it
lives in one file, `server/src/shares.js`:

- `VISIBLE_NOTES` — the SQL for reading: your own notes, plus notes whose
  path starts with a folder shared with you (`n.path[1:cardinality(s.path)]
  = s.path`) by an **accepted** share.
- `writableOwner` / `canWriteNote` — the check before writing. A new note
  in a shared folder belongs to the **folder's owner** and records its writer
  in `author_id`, so it stays with the folder if sharing ends, and counts
  against the owner's 50 MB.

Because you and a friend may both have an "Alışveriş", the request says whose
folder is meant (`ownerId`), and shared folders are listed apart under
**"Paylaşılan"** with the owner's name instead of being merged into your tree.

**Sharing a folder of reminders:** reminders are not in the notes tree, so a
folder holding only reminders has no row in the Notlar sidebar. The folder
list on the **Hatırlatmalar** page therefore has its own share button. That
list also keeps a folder someone shared with you apart from your own folder of
the same name, naming it after its owner ("kaan · Ödemeler").

Three limits worth knowing: a **locked folder cannot be shared** (its key
never leaves the browser, so the other person would see only ciphertext), a
note **cannot change owner** (write it in the shared folder rather than moving
it there), and **everyone invited may edit** — there is no read-only role yet.

### 6.11 Smaller features

- **Reading mode** (`Reader.tsx`): a 760 px serif "page", A−/A+ (remembered),
  ← → between notes, Esc.
- **Guided tour** (`Tour.tsx`, `lib/tour.ts`): dims the page, highlights
  elements marked `data-tour="…"`, skips steps whose element isn't on screen,
  opens on first visit (per browser) and from **?**.
- **Dark mode** (`index.css`, `lib/theme.ts`, `ThemeToggle.tsx`; see D17):
  - Every color is a CSS variable at the top of `index.css`. The dark theme
    is a second set of values for the same variables, so components never
    mention themes.
  - The CSS picks dark when the device is dark (`prefers-color-scheme`)
    unless `<html data-theme="light">`, or when `data-theme="dark"`.
  - The header button cycles Sistem → Açık → Koyu, sets `data-theme`, and
    saves the choice in localStorage (`notex-theme`; Sistem removes it).
  - A few lines of plain script in `index.html` apply the saved choice
    before React loads, so a dark page doesn't flash white on load.
  - Adding UI: never write a literal color like `#fff`. Use a variable, or
    add one with a light value and a dark value.
- **Dialogs and toasts** (`state/confirm.ts`, `state/toast.ts`): a tiny store
  + one host component each; any code can `await confirmDialog({...})` or
  `showToast({...})`.
- **Comments, list items (checkbox), images on existing notes, lightbox** —
  small additions on `NoteCard`.

---

## 7. Security, in one place

| Threat | Protection | Where |
|---|---|---|
| Someone reads your notes | Google login; every query filtered by `user_id` | `auth.js`, all routes |
| Forged/edited session cookie | HMAC signature with `SESSION_SECRET` | `auth.js` |
| Other sites using your session (CSRF) | `SameSite=Strict`, same-origin app | `auth.js`, D6 |
| JavaScript stealing the cookie | `httpOnly` | `auth.js` |
| Password guessing on login | Google handles it; 20 attempts / 15 min / IP | `auth.js` |
| SQL injection | parameterized queries only | all `pool.query` |
| Overwriting another user's note by id | upsert requires the same owner → 403 | `routes/notes.js` |
| Server reading locked notes | encryption in the browser; no password hash stored | `crypto.ts`, D8 |
| SSRF via the image proxy | private-address checks on every hop | `imageProxy.js` |
| Using up shared free tiers | 150 AI calls/day, 40/min, 50 MB per user | `routes/ai.js`, `notes.js` |
| Leaked secrets | `.env` git-ignored; secrets only in Render; rotate if shared | `.gitignore` |

---

## 8. Testing

| Layer | Tool | Command | What it covers |
|---|---|---|---|
| Web logic | Vitest | `cd web && npm test` | 134 tests: parser, recurrence, agenda, move rules, crypto, tree, paste, theme, sharing, store (incl. folder moves with real encryption) |
| Web types & style | tsc, oxlint | `npm run build`, `npm run lint` | type errors, suspicious code |
| Server API | node:test + embedded-postgres | `cd server && npm test` | 22 tests: login, isolation between users, sync/409, quotas, reminders, AI with a fake model, image proxy |
| The real app | Playwright (scratch scripts) | — | clicked through each feature in Chrome, desktop + phone width |

The browser tests were kept outside the repo (they mock the API and were
written per feature). Many real bugs were found by them — e.g. the AI folder
of the previous note leaking into the next one, the tour always skipping the
note step on first visit. **Adding a committed Playwright suite is a good next
step** (section 12).

A test habit worth keeping: **write the rule as a pure function first, test
it, then build the UI on it** — that's how the reminder parser (52 cases) and
move rules were done.

---

## 9. Everyday workflows

### Run locally

```powershell
# terminal 1
cd server
npm install        # first time / after package changes
npm run migrate    # after schema changes
npm run dev        # http://localhost:8000
# terminal 2
cd web
npm install
npm run dev        # http://localhost:5173  (open this)
```

Local runs use **your real Neon database** (from `server/.env`). Additive
schema changes are safe; for risky ones we used a throwaway database.

### Ship a change

1. `git checkout -b my-change` (never work directly on `main`)
2. edit → `npm test` / `npm run lint` / `npm run build`
3. `git add -A && git commit -m "…"` → `git push -u origin my-change`
4. open a pull request on GitHub, try it locally, merge
5. Render deploys in ~1–2 minutes; check `/api/health` and the **Logs** tab

### Change the database

Add an idempotent statement to `server/db/schema.sql` (e.g.
`ALTER TABLE notes ADD COLUMN IF NOT EXISTS …`). Render applies it on the next
start; locally run `npm run migrate`. Prefer **adding** columns with defaults;
dropping/renaming needs a plan (old and new code run briefly side by side).

### Add or rotate a secret

Put it in `server/.env` (local) and **Render → Environment** (production).
If a secret was ever pasted somewhere public, create a new one and replace it.

### When something breaks

| Symptom | Look at |
|---|---|
| Site doesn't load / "Yükleniyor" forever | Render **Logs**; free service may be waking up (~1 min) |
| Red banner "kaydedilemedi (…)" | the reason in brackets; browser DevTools → **Network** tab |
| AI stopped suggesting | search shows the AI error text; limits (150/day); Cloudflare dashboard usage |
| "password authentication failed" | `DATABASE_URL` in `.env`/Render (copy with Neon's copy button) |
| Google button error "origin not allowed" | Google Cloud → OAuth client → Authorized JavaScript origins |

Browser **DevTools** (F12): *Console* for errors, *Network* for each request
(status code + response), *Application → Local Storage* for the tour/reader
settings.

---

## 10. How we worked with Claude Code

- **`CLAUDE.md`** is read by Claude at the start of every session: project
  rules (UI text Turkish, never send locked notes to AI, every query scoped to
  the user …) and where things are.
- **`docs/PROJECT_LOG.md`** is the project's memory. Every decision has an ID
  (D1–D16), the reason, and — for AI — the measurements. Superseded decisions
  stay, marked as such, so the *why* is never lost. Every work session added a
  dated entry: what, why, how verified, what's next.
- **The loop we followed** for each feature: discuss (when there were real
  choices) → build on a branch → tests → browser check → local run for you →
  merge → verify the live site.
- **Measure before choosing**: models, prompts and search strategies were
  compared on realistic Turkish notes before building.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **API** | the set of URLs the server offers (`/api/notes` …) |
| **Endpoint / route** | one method + URL, e.g. `PUT /api/notes/:id` |
| **JSON** | the text format for data between browser and server |
| **HTTP status code** | the server's short answer: 200 OK, 404 not found … (3.6) |
| **Middleware** | a function that runs before route handlers (login check, JSON parsing) |
| **Environment variable** | a setting given to a program from outside (`DATABASE_URL`) |
| **`.env` file** | local file of environment variables; never committed |
| **Dependency** | a library the project uses (listed in `package.json`) |
| **Build** | turning source code into the optimized files that run in production |
| **Deploy** | putting a new version live (merge → Render) |
| **Migration** | a change to the database structure |
| **Idempotent** | safe to run many times with the same result |
| **Upsert** | insert, or update if it exists |
| **Tombstone** | a "deleted" marker row instead of removing it |
| **UUID** | a random 128-bit id, practically never repeats |
| **Cookie** | small data the browser sends with every request to a site |
| **HMAC** | a signature proving data came from someone with the secret key |
| **JWT** | a signed JSON token (Google's ID token is one) |
| **OAuth / OpenID Connect** | the standards behind "Sign in with Google" |
| **CORS** | browser rule limiting which sites may read responses from others |
| **CSRF** | an attack making your browser send requests you didn't intend |
| **SSRF** | an attack making a server fetch internal addresses |
| **PBKDF2** | slow password-to-key function |
| **AES-GCM** | encryption that also detects tampering |
| **Salt / IV** | random values so equal inputs don't give equal outputs |
| **LLM** | large language model (Mistral, Qwen …) |
| **Prompt** | the instructions and input given to an LLM |
| **Token** (AI) | a chunk of text (~¾ word) models count in |
| **Embedding / vector** | numbers representing a text's meaning |
| **Cosine similarity** | how alike two vectors are (1 = same direction) |
| **Re-rank** | a second, smarter pass over a shortlist |
| **Neuron** (Cloudflare) | Cloudflare's unit of AI usage (10,000 free per day) |
| **Debounce** | wait until input stops before acting (AI calls after typing) |
| **Hook** (React) | `useState`, `useEffect` … functions that give components state/effects |
| **Props** | inputs passed to a React component |
| **Pure function** | output depends only on input; no side effects — easy to test |
| **Lint** | automatic check for suspicious code |

---

## 12. Learning path

Small exercises, in order, each touching one layer. Do them on a branch; the
tests tell you if you broke something.

1. **Read a flow.** Follow "delete a note" from the trash icon
   (`NoteCard.tsx` → `askDelete`) through `store.remove` to
   `routes/notes.js` `DELETE`. Then watch it in DevTools → Network.
2. **Change text (UI).** Change a tour step's wording in `lib/tour.ts`;
   run `npm test` (the tour tests still pass?) and `npm run dev`.
3. **Pure logic + test.** Teach `reminder.ts` a new phrase, e.g.
   *"hafta sonu"* → next Saturday 10:00. Write the test in
   `reminder.test.ts` **first**, see it fail, then make it pass.
4. **Server route + test.** Add `GET /api/stats` returning your note count
   and today's AI usage (`ai_usage`). Scope it by `req.userId`; add a test in
   `server/test/api.test.js`.
5. **Database column.** Add `notes.pinned BOOLEAN DEFAULT FALSE` in
   `schema.sql`, pass it through `routes/notes.js` (`toApi`, validation,
   insert), `lib/types.ts`, and show pinned notes first in `NotesPage`.
6. **AI prompt.** Add two examples to `CATEGORY_SYSTEM` in `prompts.js`
   and re-run `node --env-file=.env scripts/eval-cloud-ai.mjs <model>` —
   did the folders change? (That's how we compare prompts.)
7. **A committed browser test.** Add Playwright to `web/` and write one test:
   log in (mock), write a note, check it appears. This is the biggest missing
   piece in the project's safety net.

When you want to go deeper on any section, ask for a **Q&A session** on it —
e.g. "quiz me on how sessions work", or "walk me through `moveFolder` line by
line".
