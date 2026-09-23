# Notex — notes for Claude

Personal hierarchical note app (Category > Folder > … > Page) with on-device AI
and end-to-end encrypted folders. The owner is Turkish-speaking; conversation is
in English, and the **UI text is Turkish**.

**Read `docs/PROJECT_LOG.md` first.** It holds every decision (D1, D2, …) with
its reasoning. Don't re-open a decision unless the user asks; if one must
change, add a new decision that supersedes it.

## Keep the log up to date
After any meaningful change, add a dated entry to the **Log** section of
`docs/PROJECT_LOG.md`: what we did, why, how it was verified, and what's next.
New decisions go in the Decisions table and get their own section. Update
`README.md` if setup or commands change.

## Layout
- `server/`: Express 5 + `pg`, plain JS ES modules, Node 22+.
  - `src/app.js` builds the app; `src/index.js` starts it.
  - Schema in `db/schema.sql`; it must stay idempotent because it runs on
    every deploy.
- `web/`: Vite + React + TypeScript.
  - Pure logic lives in `src/lib/` (types, api, crypto, tree, notes, format,
    images), with `*.test.ts` next to the testable ones.
  - `src/state/store.ts`: the app store (notes, folders, unlocked keys,
    password prompts). All note changes go through it: local update first,
    then `PUT` to the server.
  - `src/ai/`: on-device embeddings (D12): model in a Web Worker, ranking in
    `vector.ts`, hooks in `useAi.ts`. Model evaluation: `scripts/eval-ai.mjs`.
  - `src/components/`: UI (NotesPage, Sidebar, NoteCard, Composer,
    PasswordModal, Lightbox, Reminders).
- UI changes: check them in a real browser (Playwright with Chromium at
  `/opt/pw-browsers/chromium` in cloud sessions) on desktop and at phone width.
- `docs/prototype.jsx`: the original prototype, a design reference only. Don't
  import from it.

## Commands
- web: `npm run dev`, `npm test`, `npm run lint`, `npm run build`
- server: `npm run dev`, `npm test`, `npm run migrate`, `npm run hash-password -- "<pw>"`
- The server's API tests need `TEST_DATABASE_URL`. In a cloud session, a local
  Postgres can be started with `service postgresql start`.

## Rules
- AI features run on-device only, and are for search and classification only.
  No chatbot UI and no server-side LLM.
- Encrypted notes: every text field goes inside `cipher`. Never add plaintext
  content fields for encrypted notes, and never store password hashes for
  folders (see D8).
- Notes are only created or replaced via `PUT /api/notes/:id` with a
  client-generated id and `updatedAt` (see D9).
- Never commit `.env` files or secrets.
