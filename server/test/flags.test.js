// Flags on notes (D26): a fixed set, kept in plaintext so a locked note can
// still be marked and filtered.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { FLAGS, validateNote } from "../src/routes/notes.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base, kaan, ayse;

const verifyGoogle = async (c) => {
  if (!c.startsWith("good:")) throw new Error("bad token");
  const email = c.slice(5);
  return { sub: "sub-" + email, email, name: email.split("@")[0], picture: null };
};

function client() {
  let cookie = null;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  call.login = async (email) => (await call("POST", "/api/auth/google", { credential: "good:" + email })).body.user;
  return call;
}

const note = (over) => ({
  path: ["Genel"], encrypted: false, content: { text: "bir not" }, cipher: null,
  isListItem: false, checked: false, reminderAt: null,
  createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z", ...over,
});
const flagsOf = async (c, id) => (await c("GET", "/api/notes")).body.notes.find((n) => n.id === id)?.flags;

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  await kaan.login("kaan@example.com");
  await ayse.login("ayse@example.com");
});

after(async () => {
  server?.close();
  await db?.stop();
});

beforeEach(async () => {
  await pool.query("DELETE FROM notes");
});

test("a note has no flags until it is given some", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1" }));
  assert.deepEqual(await flagsOf(kaan, "n1"), []);
});

test("flags are saved and come back, and more than one may be on", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", flags: ["onemli", "acil"] }));
  assert.deepEqual(await flagsOf(kaan, "n1"), ["onemli", "acil"]);

  await kaan("PUT", "/api/notes/n1", note({ id: "n1", flags: ["fikir"], updatedAt: "2026-09-21T10:00:00.000Z" }));
  assert.deepEqual(await flagsOf(kaan, "n1"), ["fikir"], "replacing them replaces them");

  await kaan("PUT", "/api/notes/n1", note({ id: "n1", flags: [], updatedAt: "2026-09-22T10:00:00.000Z" }));
  assert.deepEqual(await flagsOf(kaan, "n1"), [], "and they can all come off");
});

test("only the known flags are accepted", async () => {
  assert.deepEqual(FLAGS, ["onemli", "acil", "beklemede", "fikir"]);
  const bad = await kaan("PUT", "/api/notes/n2", note({ id: "n2", flags: ["kendi-etiketim"] }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /flags must be from/);

  assert.equal((await kaan("PUT", "/api/notes/n3", note({ id: "n3", flags: "onemli" }))).status, 400, "not a bare string either");
  assert.equal((await kaan("PUT", "/api/notes/n4", note({ id: "n4", flags: ["onemli", "onemli"] }))).status, 400, "and not the same one twice");
  assert.equal((await kaan("GET", "/api/notes")).body.notes.length, 0, "nothing was written");
});

test("a locked note can be flagged without being unlocked", async () => {
  // The flag lives beside the ciphertext, like `checked` and `reminderAt`, so
  // the list can be filtered while the folder is locked (D8).
  await kaan("PUT", "/api/notes/s1", note({ id: "s1", encrypted: true, content: null, cipher: "iv:gizli", flags: ["onemli"] }));
  const got = (await kaan("GET", "/api/notes")).body.notes[0];
  assert.deepEqual(got.flags, ["onemli"]);
  assert.equal(got.cipher, "iv:gizli");
  assert.equal(got.content, null, "and no words leaked to make room for it");
});

test("validateNote is the one place that decides", () => {
  assert.equal(validateNote(note({ flags: ["beklemede"] })), null);
  assert.equal(validateNote(note({ flags: [] })), null);
  assert.equal(validateNote(note({})), null, "leaving flags out is fine");
  assert.match(validateNote(note({ flags: ["yok"] })), /flags must be from/);
  assert.match(validateNote(note({ flags: { onemli: true } })), /flags must be from/);
});

test("flags belong to the note, so a shared folder shows the same ones", async () => {
  await kaan("PUT", "/api/notes/sh", note({ id: "sh", path: ["Ev"], flags: ["acil"] }));
  const made = await kaan("POST", "/api/shares", { path: ["Ev"], email: "ayse@example.com" });
  await ayse("POST", "/api/shares/accept", { token: made.body.token });
  assert.deepEqual(await flagsOf(ayse, "sh"), ["acil"], "she sees his flag");

  await ayse("PUT", "/api/notes/sh", note({ id: "sh", path: ["Ev"], flags: ["acil", "beklemede"], updatedAt: "2026-09-25T10:00:00.000Z" }));
  assert.deepEqual(await flagsOf(kaan, "sh"), ["acil", "beklemede"], "and may add one");
});

test("an old client that knows nothing about flags does not wipe them", async () => {
  // `flags` left out of the body means "no flags" on a fresh note, but an
  // existing note being edited by an old build would otherwise lose them.
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", flags: ["onemli"] }));
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", updatedAt: "2026-09-21T10:00:00.000Z" }));
  assert.deepEqual(await flagsOf(kaan, "n1"), ["onemli"]);
});
