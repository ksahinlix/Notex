// End-to-end API tests against a real Postgres: TEST_DATABASE_URL if set,
// otherwise a throwaway local one (see helpers/db.js).
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MAX_BYTES_PER_USER } from "../src/routes/notes.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base;

// Fake Google: the "credential" is "good:<email>"; anything else is rejected.
const verifyGoogle = async (credential) => {
  if (!credential.startsWith("good:")) throw new Error("bad token");
  const email = credential.slice(5);
  return { sub: "sub-" + email.toLowerCase(), email, name: email.split("@")[0], picture: null };
};

function client() {
  let cookie = null;
  const call = async (method, path, body, { auth = true } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  call.login = (email) => call("POST", "/api/auth/google", { credential: "good:" + email });
  return call;
}

function note(id, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id, path: ["Work", "Notex"], encrypted: false, content: { text: "hello" }, cipher: null,
    isListItem: false, checked: false, reminderAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  // Notes and a folder from the single-user era (no owner yet).
  await pool.query(`INSERT INTO notes (id, path, encrypted, content) VALUES ('old-1', '{Eski,Notlar}', false, '{"text":"eski not"}')`);
  await pool.query(`INSERT INTO protected_folders (path_key, salt, iterations, check_cipher) VALUES ('Gizli', '${"ab".repeat(16)}', 600000, 'aXY=:Y3Q=')`);
  const app = createApp({ pool, sessionSecret: "test-secret", googleClientId: "test-client", verifyGoogle, ownerEmail: "Owner@Example.com" });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  await db?.stop();
});

test("health, config and Google login", async () => {
  const api = client();
  assert.deepEqual((await api("GET", "/api/health")).body, { ok: true, db: "up" });
  assert.deepEqual((await api("GET", "/api/auth/config")).body, { googleClientId: "test-client" });
  assert.equal((await api("GET", "/api/notes")).status, 401);
  assert.equal((await api("POST", "/api/auth/google", { credential: "forged" })).status, 401);
  assert.equal((await api("POST", "/api/auth/google", {})).status, 400);
  const login = await api.login("stranger@example.com");
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, "stranger@example.com");
  const me = await api("GET", "/api/auth/me");
  assert.equal(me.body.authenticated, true);
  assert.equal(me.body.user.email, "stranger@example.com");
  // A stranger does not get the old notes.
  assert.deepEqual((await api("GET", "/api/notes")).body.notes, []);
  await api("POST", "/api/auth/logout");
  assert.equal((await api("GET", "/api/auth/me")).body.authenticated, false);
});

test("the owner's first login takes over notes from the single-user era", async () => {
  const owner = client();
  await owner.login("owner@example.com"); // email match is case-insensitive
  assert.deepEqual((await owner("GET", "/api/notes")).body.notes.map((n) => n.id), ["old-1"]);
  assert.deepEqual((await owner("GET", "/api/protected-folders")).body.folders.map((f) => f.pathKey), ["Gizli"]);
  // Signing in again finds the same user.
  const again = client();
  const r = await again.login("owner@example.com");
  assert.equal(r.body.user.id, (await owner("GET", "/api/auth/me")).body.user.id);
});

test("note create, update, conflict, delete, sync", async () => {
  const api = client();
  await api.login("a@example.com");
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

test("users can't see, change or delete each other's notes and folders", async () => {
  const a = client();
  const b = client();
  await a.login("alice@example.com");
  await b.login("bob@example.com");
  assert.equal((await a("PUT", "/api/notes/shared-id", note("shared-id", { content: { text: "alice" } }))).status, 200);

  assert.deepEqual((await b("GET", "/api/notes")).body.notes, []);
  const since = await b("GET", `/api/notes?since=${encodeURIComponent("2000-01-01T00:00:00Z")}`);
  assert.deepEqual(since.body.notes, []);
  const later = new Date(Date.now() + 5000).toISOString();
  assert.equal((await b("PUT", "/api/notes/shared-id", note("shared-id", { content: { text: "bob" }, updatedAt: later }))).status, 403);
  assert.equal((await b("DELETE", "/api/notes/shared-id")).status, 404);
  assert.equal((await a("GET", "/api/notes")).body.notes[0].content.text, "alice");

  // The same folder name can be protected by both, independently.
  const folder = { salt: "cd".repeat(16), iterations: 600000, checkCipher: "aXY=:Y3Q=" };
  assert.equal((await a("PUT", "/api/protected-folders/Kişisel", folder)).status, 200);
  assert.equal((await b("PUT", "/api/protected-folders/Kişisel", { ...folder, salt: "ef".repeat(16) })).status, 200);
  assert.equal((await a("GET", "/api/protected-folders")).body.folders[0].salt, "cd".repeat(16));
  assert.equal((await b("DELETE", "/api/protected-folders/Kişisel")).status, 204);
  assert.equal((await a("GET", "/api/protected-folders")).body.folders.length, 1);
});

test("protected folders", async () => {
  const api = client();
  await api.login("folders@example.com");
  const key = encodeURIComponent("Personal/Diary");
  const body = { salt: "ab".repeat(16), iterations: 600000, checkCipher: "aXY=:Y3Q=" };
  assert.equal((await api("PUT", `/api/protected-folders/${key}`, { ...body, iterations: 10 })).status, 400);
  assert.equal((await api("PUT", `/api/protected-folders/${key}`, body)).body.pathKey, "Personal/Diary");
  assert.equal((await api("GET", "/api/protected-folders")).body.folders.length, 1);
  assert.equal((await api("DELETE", `/api/protected-folders/${key}`)).status, 204);
  assert.equal((await api("GET", "/api/protected-folders")).body.folders.length, 0);
});

test("storage quota per user", async () => {
  const api = client();
  await api.login("big@example.com");
  const me = (await api("GET", "/api/auth/me")).body.user.id;
  // Pretend this user already stores almost the whole quota.
  await pool.query(`INSERT INTO notes (id, user_id, path, encrypted, content) VALUES ('big-1', $1, '{X}', false, $2)`, [
    me, JSON.stringify({ text: "x".repeat(MAX_BYTES_PER_USER - 1000) }),
  ]);
  assert.equal((await api("PUT", "/api/notes/small", note("small", { content: { text: "ok" } }))).status, 200);
  const tooBig = note("big-2", { content: { text: "y".repeat(5000) } });
  assert.equal((await api("PUT", "/api/notes/big-2", tooBig)).status, 413);
});

test("reminders with and without a date", async () => {
  const api = client();
  await api.login("rem@example.com");
  const undated = await api("PUT", "/api/notes/r1", note("r1", { isReminder: true }));
  assert.equal(undated.body.isReminder, true);
  assert.equal(undated.body.reminderAt, null);
  const dated = await api("PUT", "/api/notes/r2", note("r2", { reminderAt: "2030-01-01T09:00:00.000Z" }));
  assert.equal(dated.body.isReminder, true); // a date implies a reminder
  const none = await api("PUT", "/api/notes/r3", note("r3"));
  assert.equal(none.body.isReminder, false);
  assert.equal((await api("PUT", "/api/notes/r4", note("r4", { isReminder: "yes" }))).status, 400);
});

test("repeating reminders", async () => {
  const api = client();
  await api.login("repeat@example.com");
  const monthly = note("m1", { reminderAt: "2026-09-28T06:00:00.000Z", repeat: "monthly", reminderDoneUntil: "2026-09-28T06:00:00.000Z" });
  const r = await api("PUT", "/api/notes/m1", monthly);
  assert.equal(r.status, 200);
  assert.equal(r.body.repeat, "monthly");
  assert.equal(r.body.reminderDoneUntil, "2026-09-28T06:00:00.000Z");
  assert.equal((await api("PUT", "/api/notes/m2", note("m2", { repeat: "hourly", reminderAt: "2026-09-28T06:00:00.000Z" }))).status, 400);
  assert.equal((await api("PUT", "/api/notes/m3", note("m3", { repeat: "weekly" }))).status, 400); // needs a date
  assert.equal((await api("PUT", "/api/notes/m4", note("m4"))).body.repeat, null);
});
