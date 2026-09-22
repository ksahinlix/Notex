# Notex

A personal, hierarchical note app with on-device AI for sorting and searching
notes, and end-to-end encrypted folders. Web first, then mobile.

- **Why things are built this way:** [`docs/PROJECT_LOG.md`](docs/PROJECT_LOG.md)
- **Original prototype:** [`docs/prototype.jsx`](docs/prototype.jsx)

## Project layout

```
server/   Node.js + Express API, Postgres schema (db/schema.sql)
web/      Vite + React + TypeScript app
docs/     project log, prototype, original summary
render.yaml  deployment config for Render
```

## Running locally

Requirements: **Node.js 22+**, and a Postgres database (a free
[Neon](https://neon.tech) project is fine).

### 1. Server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `server/.env`:

| Variable | How to get it |
|----------|---------------|
| `DATABASE_URL` | Neon dashboard → your project → **Connect** → copy the connection string |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_PASSWORD_HASH` | `npm run hash-password -- "your password"`, then paste it in **single quotes** |

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

Log in with the password you hashed above.

## Tests

```bash
cd web && npm test && npm run lint && npm run build
cd server && npm test
```

The server's API tests need an empty test database. Put
`TEST_DATABASE_URL=...` in `server/.env.test`; without it they are skipped.
**Its tables are wiped on every run**, so never point it at real data.

## Deploying (Render + Neon)

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, then pick the repo. Render reads `render.yaml`.
3. When asked, set `DATABASE_URL` (Neon) and `APP_PASSWORD_HASH`.
   `SESSION_SECRET` is generated automatically.
4. Open the service URL and log in. The schema is applied on each start.

The free service sleeps after ~15 minutes idle, so the first visit after that
takes up to a minute.
