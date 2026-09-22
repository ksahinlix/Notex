// End-to-end API tests against a real Postgres.
// Runs only when TEST_DATABASE_URL is set (e.g. in server/.env.test).
// WARNING: the tables in that database are emptied before the tests.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";

const dbUrl = process.env.TEST_DATABASE_URL;
const opts = { skip: dbUrl ? false : "TEST_DATABASE_URL not set" };

let pool, server, base, cookie;

async function api(method, path, body, { auth = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

function note(id, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id, path: ["Work", "Notex"], encrypted: false, content: { text: "hello" }, cipher: null,
    isListItem: false, checked: false, reminderAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

before(async () => {
  if (!dbUrl) return;
  pool = new pg.Pool({ connectionString: dbUrl });
  await pool.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await pool.query("TRUNCATE notes, protected_folders");
  const app = createApp({ pool, sessionSecret: "test-secret", passwordHash: await hashPassword("pw") });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("health and auth", opts, async () => {
  assert.deepEqual((await api("GET", "/api/health")).body, { ok: true, db: "up" });
  assert.equal((await api("GET", "/api/notes")).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { password: "nope" })).status, 401);
  const login = await api("POST", "/api/auth/login", { password: "pw" });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.deepEqual((await api("GET", "/api/auth/me")).body, { authenticated: true });
});

test("note create, update, conflict, delete, sync", opts, async () => {
  const t0 = new Date(Date.now() - 60_000).toISOString();
  const n = note("n1", { updatedAt: t0 });

  assert.equal((await api("PUT", "/api/notes/n1", { ...n, path: [] })).status, 400);
  assert.equal((await api("PUT", "/api/notes/n1", n)).status, 200);

  const newer = { ...n, content: { text: "edited" }, updatedAt: new Date().toISOString() };
  assert.equal((await api("PUT", "/api/notes/n1", newer)).body.content.text, "edited");

  const stale = await api("PUT", "/api/notes/n1", { ...n, content: { text: "old" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.content.text, "edited");

  const enc = note("n2", { encrypted: true, content: null, cipher: "aXY=:Y3Q=" });
  assert.equal((await api("PUT", "/api/notes/n2", enc)).status, 200);

  const all = await api("GET", "/api/notes");
  assert.deepEqual(all.body.notes.map((x) => x.id).sort(), ["n1", "n2"]);

  const since = all.body.serverTime;
  assert.equal((await api("DELETE", "/api/notes/n1")).status, 204);
  assert.equal((await api("DELETE", "/api/notes/n1")).status, 404);

  const changes = await api("GET", `/api/notes?since=${encodeURIComponent(since)}`);
  assert.equal(changes.body.notes.length, 1);
  assert.equal(changes.body.notes[0].id, "n1");
  assert.ok(changes.body.notes[0].deletedAt);
  assert.deepEqual((await api("GET", "/api/notes")).body.notes.map((x) => x.id), ["n2"]);
});

test("protected folders", opts, async () => {
  const key = encodeURIComponent("Personal/Diary");
  const body = { salt: "ab".repeat(16), iterations: 600000, checkCipher: "aXY=:Y3Q=" };
  assert.equal((await api("PUT", `/api/protected-folders/${key}`, { ...body, iterations: 10 })).status, 400);
  assert.equal((await api("PUT", `/api/protected-folders/${key}`, body)).body.pathKey, "Personal/Diary");
  assert.equal((await api("GET", "/api/protected-folders")).body.folders.length, 1);
  assert.equal((await api("DELETE", `/api/protected-folders/${key}`)).status, 204);
  assert.equal((await api("GET", "/api/protected-folders")).body.folders.length, 0);
});
