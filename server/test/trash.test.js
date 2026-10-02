// The trash (D24): deleting keeps the note for a while, restoring brings it
// back, and the content is wiped for real only when it has aged out.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { purgeTrash, TRASH_DAYS } from "../src/trash.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base, kaan, ayse, stranger;

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
const ids = (r) => r.body.notes.map((n) => n.id).sort();
/** Pretends a note was deleted `days` ago. */
const age = (id, days) => pool.query(`UPDATE notes SET deleted_at = now() - ($2 || ' days')::interval WHERE id = $1`, [id, String(days)]);

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  stranger = client();
  await kaan.login("kaan@example.com");
  await ayse.login("ayse@example.com");
  await stranger.login("yabanci@example.com");
});

after(async () => {
  server?.close();
  await db?.stop();
});

beforeEach(async () => {
  await pool.query("DELETE FROM notes");
});

test("a deleted note leaves the list but keeps everything it had", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", content: { text: "silinecek", blocks: [{ type: "text", content: "silinecek" }] } }));
  assert.equal((await kaan("DELETE", "/api/notes/n1")).status, 204);

  const live = await kaan("GET", "/api/notes");
  assert.deepEqual(ids(live), [], "gone from the notes");
  assert.equal(live.body.trashCount, 1, "and counted in the trash");

  const trash = await kaan("GET", "/api/notes/trash");
  assert.deepEqual(ids(trash), ["n1"]);
  assert.equal(trash.body.notes[0].content.text, "silinecek", "the words are still there");
  assert.deepEqual(trash.body.notes[0].content.blocks, [{ type: "text", content: "silinecek" }]);
  assert.equal(trash.body.days, TRASH_DAYS, "and it says for how long");
});

test("restoring puts it back in its folder", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", path: ["Ev", "Alışveriş"] }));
  await kaan("DELETE", "/api/notes/n1");

  const back = await kaan("POST", "/api/notes/n1/restore");
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.path, ["Ev", "Alışveriş"]);
  assert.equal(back.body.deletedAt, null);

  assert.deepEqual(ids(await kaan("GET", "/api/notes")), ["n1"]);
  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), [], "and it has left the trash");
});

test("a locked note comes back still locked", async () => {
  await kaan("PUT", "/api/notes/s1", note({ id: "s1", encrypted: true, content: null, cipher: "iv:gizli" }));
  await kaan("DELETE", "/api/notes/s1");

  const trash = await kaan("GET", "/api/notes/trash");
  assert.equal(trash.body.notes[0].cipher, "iv:gizli", "the trash holds ciphertext, not words");
  assert.equal(trash.body.notes[0].content, null);

  const back = await kaan("POST", "/api/notes/s1/restore");
  assert.equal(back.body.encrypted, true);
  assert.equal(back.body.cipher, "iv:gizli");
});

test("deleting it for good wipes the content but leaves the tombstone for other devices", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", content: { text: "gizli kalsın" } }));
  await kaan("DELETE", "/api/notes/n1");
  assert.equal((await kaan("DELETE", "/api/notes/n1/forever")).status, 204);

  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), [], "nothing left to restore");
  assert.equal((await kaan("GET", "/api/notes")).body.trashCount, 0);

  // The row survives, so a device syncing with ?since= still learns it went (D9).
  const since = await kaan("GET", "/api/notes?since=2020-01-01T00:00:00.000Z");
  const row = since.body.notes.find((n) => n.id === "n1");
  assert.ok(row, "the tombstone is still sent");
  assert.ok(row.deletedAt, "marked deleted");
  assert.deepEqual(row.content, {}, "with nothing in it");
  assert.ok(!JSON.stringify(since.body).includes("gizli kalsın"));

  assert.equal((await kaan("POST", "/api/notes/n1/restore")).status, 410, "and it cannot be restored");
});

test("the trash empties itself after the retention period", async () => {
  await kaan("PUT", "/api/notes/old", note({ id: "old", content: { text: "eski" } }));
  await kaan("PUT", "/api/notes/new", note({ id: "new", content: { text: "yeni" } }));
  await kaan("DELETE", "/api/notes/old");
  await kaan("DELETE", "/api/notes/new");
  await age("old", TRASH_DAYS + 1);

  assert.equal(await purgeTrash(pool), 1, "only the one past its time");
  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), ["new"]);
  assert.equal(await purgeTrash(pool), 0, "running it again finds nothing to do");

  const since = await kaan("GET", "/api/notes?since=2020-01-01T00:00:00.000Z");
  assert.ok(!JSON.stringify(since.body).includes("eski"), "the words are really gone");
  assert.ok(since.body.notes.some((n) => n.id === "old"), "but the tombstone stayed");
});

test("a note in a folder shared with you can be deleted and restored by either of you", async () => {
  await kaan("PUT", "/api/notes/sh", note({ id: "sh", path: ["Ev", "Alışveriş"], content: { text: "süt" } }));
  const made = await kaan("POST", "/api/shares", { path: ["Ev"], email: "ayse@example.com" });
  await ayse("POST", "/api/shares/accept", { token: made.body.token });

  assert.equal((await ayse("DELETE", "/api/notes/sh")).status, 204, "she may delete it");
  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), ["sh"], "it is in his trash");
  assert.deepEqual(ids(await ayse("GET", "/api/notes/trash")), ["sh"], "and in hers, since she can see the folder");
  assert.equal((await kaan("GET", "/api/notes")).body.trashCount, 1);

  assert.equal((await ayse("POST", "/api/notes/sh/restore")).status, 200, "and she can undo it");
  assert.deepEqual(ids(await kaan("GET", "/api/notes")), ["sh"]);
});

test("a stranger sees nothing and can do nothing", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1" }));
  await kaan("DELETE", "/api/notes/n1");

  assert.deepEqual(ids(await stranger("GET", "/api/notes/trash")), []);
  assert.equal((await stranger("GET", "/api/notes")).body.trashCount, 0);
  assert.equal((await stranger("POST", "/api/notes/n1/restore")).status, 404, "404, not 403: the id stays secret");
  assert.equal((await stranger("DELETE", "/api/notes/n1/forever")).status, 404);
  assert.equal((await client()("GET", "/api/notes/trash")).status, 401, "and signed out, nothing at all");

  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), ["n1"], "his note is untouched");
});

test("restoring something that was never deleted is a 404, not a surprise", async () => {
  await kaan("PUT", "/api/notes/n1", note({ id: "n1" }));
  assert.equal((await kaan("POST", "/api/notes/n1/restore")).status, 404);
  assert.equal((await kaan("POST", "/api/notes/yok/restore")).status, 404);
  assert.equal((await kaan("DELETE", "/api/notes/yok/forever")).status, 404);
});

test("editing a note after deleting it brings it back; an older edit does not", async () => {
  // PUT already clears deleted_at (D9, last write wins), and that must keep
  // working now that the trash exists.
  await kaan("PUT", "/api/notes/n1", note({ id: "n1" }));
  await kaan("DELETE", "/api/notes/n1");

  // A save that was already in flight when the delete happened is older than
  // it, so it must not resurrect the note.
  const stale = await kaan("PUT", "/api/notes/n1", note({ id: "n1", content: { text: "eski kayıt" }, updatedAt: "2026-09-21T10:00:00.000Z" }));
  assert.equal(stale.status, 409, "a save older than the delete loses");
  assert.deepEqual(ids(await kaan("GET", "/api/notes")), [], "and the note stays deleted");

  const now = new Date().toISOString();
  await kaan("PUT", "/api/notes/n1", note({ id: "n1", content: { text: "yeniden" }, updatedAt: now }));
  assert.deepEqual(ids(await kaan("GET", "/api/notes")), ["n1"], "a newer one brings it back");
  assert.deepEqual(ids(await kaan("GET", "/api/notes/trash")), []);
});
