// Backups (D23): what goes into the dump, who may ask for one, and whether it
// actually comes back — the round trip is the point of the feature.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { backupKey, buildBackup, restoreBackup, runBackup } from "../src/backup.js";
import { createApp } from "../src/app.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base, kaan, ayse, kaanUser, ayseUser;
const CRON = "cron-secret";
const SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90"; // the route wants 32+ hex chars

const verifyGoogle = async (c) => {
  if (!c.startsWith("good:")) throw new Error("bad token");
  const email = c.slice(5);
  return { sub: "sub-" + email, email, name: email.split("@")[0], picture: null };
};

function client() {
  let cookie = null;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  call.login = async (email) => (await call("POST", "/api/auth/google", { credential: "good:" + email })).body.user;
  return call;
}

const note = (over) => ({
  path: ["Genel"], encrypted: false, content: { text: "x" }, cipher: null,
  isListItem: false, checked: false, reminderAt: null,
  createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z", ...over,
});

// A fake bucket, so the shape of what would be uploaded is testable without
// talking to Cloudflare.
const uploads = [];
const fakeR2 = { bucket: "test", async put(key, body, type) { uploads.push({ key, body, type }); return key; } };

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle, cronSecret: CRON, r2: fakeR2 });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  kaanUser = await kaan.login("kaan@example.com");
  ayseUser = await ayse.login("ayse@example.com");

  await kaan("PUT", "/api/notes/n1", note({ id: "n1", path: ["Ev", "Alışveriş"], content: { text: "süt al" } }));
  await kaan("PUT", "/api/notes/n2", note({ id: "n2", path: ["Kişisel", "Günlük"], encrypted: true, content: null, cipher: "iv:gizli-sifreli-metin" }));
  await kaan("PUT", "/api/notes/n3", note({ id: "n3", content: { text: "silinecek" } }));
  await kaan("DELETE", "/api/notes/n3");
  await ayse("PUT", "/api/notes/a1", note({ id: "a1", content: { text: "ayşenin notu" } }));

  await kaan("PUT", "/api/protected-folders/" + encodeURIComponent("Kişisel/Günlük"), {
    pathKey: "Kişisel/Günlük", salt: SALT, iterations: 310000, checkCipher: "iv:check",
  });
  await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"));
  await kaan("POST", "/api/shares", { path: ["Ev"], email: "ayse@example.com" });
});

after(async () => {
  server?.close();
  await db?.stop();
});

test("the dump holds everything a rebuild needs, and nothing deleted", async () => {
  const dump = await buildBackup(pool);
  assert.equal(dump.format, "notex-backup/1");
  assert.equal(dump.scope, "all");
  assert.equal(dump.counts.users, 2);
  assert.equal(dump.counts.notes, 3, "n3 was deleted, so it is not in the backup");
  assert.ok(!dump.notes.some((n) => n.id === "n3"));
  assert.equal(dump.counts.protectedFolders, 1);
  assert.equal(dump.counts.todoFolders, 1);
  assert.equal(dump.counts.shares, 1);

  // What makes a locked folder openable again must travel with it (D8).
  const folder = dump.protectedFolders[0];
  assert.deepEqual(
    { pathKey: folder.pathKey, salt: folder.salt, iterations: folder.iterations, checkCipher: folder.checkCipher },
    { pathKey: "Kişisel/Günlük", salt: SALT, iterations: 310000, checkCipher: "iv:check" },
  );
});

test("a locked note travels as ciphertext and nothing else", async () => {
  const dump = await buildBackup(pool);
  const locked = dump.notes.find((n) => n.id === "n2");
  assert.equal(locked.encrypted, true);
  assert.equal(locked.cipher, "iv:gizli-sifreli-metin");
  assert.equal(locked.content, null);
  // Its folder path is plaintext in the database by design, but its words are not.
  assert.ok(!JSON.stringify(locked).includes("gizli-metin"));
});

test("the export button gives you your own notes and nobody else's", async () => {
  const mine = await buildBackup(pool, { userId: kaanUser.id });
  assert.equal(mine.scope, "user");
  assert.deepEqual(mine.notes.map((n) => n.id).sort(), ["n1", "n2"]);
  assert.equal(mine.users.length, 1);
  assert.equal(mine.users[0].email, "kaan@example.com");

  const hers = await buildBackup(pool, { userId: ayseUser.id });
  assert.deepEqual(hers.notes.map((n) => n.id), ["a1"]);
});

test("GET /api/export needs a session and serves a named file", async () => {
  assert.equal((await client()("GET", "/api/export")).status, 401);
  const res = await kaan("GET", "/api/export");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="notex-\d{4}-\d{2}-\d{2}\.json"/);
  assert.deepEqual(res.body.notes.map((n) => n.id).sort(), ["n1", "n2"]);
});

test("POST /api/backup is closed to everyone without the cron key", async () => {
  assert.equal((await kaan("POST", "/api/backup")).status, 401, "a signed-in user cannot drive it either");
  assert.equal((await client()("POST", "/api/backup", undefined, { "x-cron-key": "wrong" })).status, 401);
});

test("POST /api/backup writes one gzipped object to the bucket", async () => {
  uploads.length = 0;
  const res = await client()("POST", "/api/backup", undefined, { "x-cron-key": CRON });
  assert.equal(res.status, 200);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].type, "application/gzip");
  assert.match(uploads[0].key, /^notex\/\d{4}\/notex-\d{8}T\d{6}Z\.json\.gz$/);
  assert.equal(res.body.key, uploads[0].key);

  const back = JSON.parse(zlib.gunzipSync(uploads[0].body).toString("utf8"));
  assert.equal(back.counts.notes, 3);
  assert.ok(uploads[0].body.length < Buffer.byteLength(JSON.stringify(back)), "gzip actually made it smaller");
});

test("GET /api/backup hands the file over, for a job that stores it itself", async () => {
  const res = await fetch(`${base}/api/backup`, { headers: { "x-cron-key": CRON } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.match(res.headers.get("content-disposition"), /attachment; filename="notex-\d{8}T\d{6}Z\.json\.gz"/);
  assert.equal(JSON.parse(res.headers.get("x-notex-counts")).notes, 3, "it says what is inside without unzipping");

  const dump = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  assert.equal(dump.format, "notex-backup/1");
  assert.equal(dump.scope, "all");
  assert.equal(dump.counts.notes, 3);
});

test("GET /api/backup needs the cron key too, and works without a bucket", async () => {
  assert.equal((await fetch(`${base}/api/backup`)).status, 401);
  assert.equal((await kaan("GET", "/api/backup")).status, 401, "a signed-in user cannot pull it either");

  // Pulling is the card-free route, so it must not depend on R2 at all.
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle, cronSecret: CRON, r2: null });
  const srv = app.listen(0);
  const res = await fetch(`http://localhost:${srv.address().port}/api/backup`, { headers: { "x-cron-key": CRON } });
  assert.equal(res.status, 200);
  srv.close();
});

test("without a bucket configured it says so instead of failing quietly", async () => {
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle, cronSecret: CRON, r2: null });
  const srv = app.listen(0);
  const res = await fetch(`http://localhost:${srv.address().port}/api/backup`, {
    method: "POST",
    headers: { "x-cron-key": CRON },
  });
  assert.equal(res.status, 503);
  srv.close();
});

test("a backup restores: wipe everything, put it back, get the same notes", async () => {
  const before = await buildBackup(pool);
  const file = zlib.gzipSync(Buffer.from(JSON.stringify(before))); // exactly what lands in R2

  await pool.query("TRUNCATE users, notes, protected_folders, todo_folders, shares, push_subscriptions, ai_usage, note_vectors CASCADE");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notes")).rows[0].n, 0, "really empty");

  const dump = JSON.parse(zlib.gunzipSync(file).toString("utf8"));
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await restoreBackup(c, dump);
    await c.query("COMMIT");
  } finally {
    c.release();
  }

  const after = await buildBackup(pool);
  assert.deepEqual(after.counts, before.counts);
  assert.deepEqual(after.notes.map((n) => n.id).sort(), before.notes.map((n) => n.id).sort());
  assert.deepEqual(after.notes.find((n) => n.id === "n2").cipher, "iv:gizli-sifreli-metin", "the locked note came back whole");
  assert.deepEqual(after.protectedFolders, before.protectedFolders, "and it can still be unlocked");
  assert.deepEqual(after.todoFolders.map((t) => t.pathKey), before.todoFolders.map((t) => t.pathKey));
  assert.deepEqual(after.shares.map((s) => s.id), before.shares.map((s) => s.id));
});

test("restoring the same file twice changes nothing more", async () => {
  const dump = await buildBackup(pool);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await restoreBackup(c, dump);
    await restoreBackup(c, dump);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  assert.deepEqual((await buildBackup(pool)).counts, dump.counts);
});

test("restore refuses a file that is not a backup", async () => {
  const c = await pool.connect();
  try {
    await assert.rejects(() => restoreBackup(c, { format: "something-else", users: [] }), /notex-backup\/1/);
  } finally {
    c.release();
  }
});

test("the key sorts by time and is grouped by year", () => {
  const a = backupKey(new Date("2026-10-02T14:00:00Z"));
  const b = backupKey(new Date("2026-10-02T15:00:00Z"));
  assert.equal(a, "notex/2026/notex-20261002T140000Z.json.gz");
  assert.ok(a < b);
});
