// Sharing a folder (D18). These tests are the guard rail for the rule that
// replaced "every query is scoped to req.userId": a stranger must see and
// change nothing, an invite grants nothing until it is accepted, and taking
// a share back takes effect at once.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base;

const verifyGoogle = async (credential) => {
  if (!credential.startsWith("good:")) throw new Error("bad token");
  const email = credential.slice(5);
  return { sub: "sub-" + email.toLowerCase(), email, name: email.split("@")[0], picture: null };
};

function client() {
  let cookie = null;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  call.login = async (email) => {
    const r = await call("POST", "/api/auth/google", { credential: "good:" + email });
    return r.body.user;
  };
  return call;
}

function note(id, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id, path: ["Alışveriş"], encrypted: false, content: { text: "süt" }, cipher: null,
    isListItem: false, checked: false, reminderAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

let kaan, ayse, stranger, kaanUser;

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "test-secret", googleClientId: "test-client", verifyGoogle });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  stranger = client();
  kaanUser = await kaan.login("kaan@example.com");
  await ayse.login("ayse@example.com");
  await stranger.login("yabanci@example.com");
  await kaan("PUT", "/api/notes/k1", note("k1")); // in the folder to be shared
  await kaan("PUT", "/api/notes/k2", note("k2", { path: ["Kişisel"], content: { text: "özel" } }));
});

after(async () => {
  server?.close();
  await db?.stop();
});

test("an invite grants nothing until it is accepted", async () => {
  const made = await kaan("POST", "/api/shares", { path: ["Alışveriş"], email: "Ayse@Example.com" });
  assert.equal(made.status, 201);
  assert.equal(made.body.status, "pending");
  assert.ok(made.body.token);

  const seen = await ayse("GET", "/api/notes");
  assert.deepEqual(seen.body.notes.map((n) => n.id), [], "pending share shows no notes");
  const write = await ayse("PUT", "/api/notes/a1", note("a1", { ownerId: kaanUser.id }));
  assert.equal(write.status, 403, "and no writing either");

  const invites = await ayse("GET", "/api/shares");
  assert.equal(invites.body.withMe.length, 1, "but she is told about the invite");
  assert.equal(invites.body.withMe[0].owner.email, "kaan@example.com");
});

test("accepting shows the folder, and she can add and complete items", async () => {
  const invite = (await ayse("GET", "/api/shares")).body.withMe[0];
  const ok = await ayse("POST", "/api/shares/accept", { token: invite.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "accepted");

  const seen = await ayse("GET", "/api/notes");
  assert.deepEqual(seen.body.notes.map((n) => n.id).sort(), ["k1"], "the shared folder only");
  assert.equal(seen.body.notes[0].ownerId, kaanUser.id);

  const added = await ayse("PUT", "/api/notes/a1", note("a1", { ownerId: kaanUser.id, content: { text: "ekmek" } }));
  assert.equal(added.status, 200);
  assert.equal(added.body.ownerId, kaanUser.id, "the note belongs to the folder's owner");
  assert.notEqual(added.body.authorId, kaanUser.id, "but records who wrote it");

  const done = { ...note("k1", { checked: true }), updatedAt: new Date(Date.now() + 1000).toISOString() };
  assert.equal((await ayse("PUT", "/api/notes/k1", done)).status, 200, "she can tick off his item");
  const his = await kaan("GET", "/api/notes");
  assert.equal(his.body.notes.find((n) => n.id === "k1").checked, true, "and he sees it ticked");
  assert.ok(his.body.notes.find((n) => n.id === "a1"), "and sees what she added");
});

test("the share reaches only that folder", async () => {
  const seen = await ayse("GET", "/api/notes");
  assert.equal(seen.body.notes.find((n) => n.id === "k2"), undefined, "not his other folders");
  const write = await ayse("PUT", "/api/notes/k2", note("k2", { path: ["Kişisel"], ownerId: kaanUser.id }));
  assert.equal(write.status, 403);
  assert.equal((await ayse("DELETE", "/api/notes/k2")).status, 404, "and is not told his note exists");
});

test("a subfolder of a shared folder is shared too", async () => {
  await kaan("PUT", "/api/notes/k3", note("k3", { path: ["Alışveriş", "Market"] }));
  const seen = await ayse("GET", "/api/notes");
  assert.ok(seen.body.notes.some((n) => n.id === "k3"));
});

test("a stranger sees and touches nothing", async () => {
  const seen = await stranger("GET", "/api/notes");
  assert.deepEqual(seen.body.notes, []);
  assert.equal((await stranger("PUT", "/api/notes/k1", note("k1", { ownerId: kaanUser.id }))).status, 403);
  assert.equal((await stranger("DELETE", "/api/notes/k1")).status, 404);
  assert.equal((await stranger("POST", "/api/shares/accept", { token: (await kaan("GET", "/api/shares")).body.mine[0].token })).status, 404);
});

test("a note cannot be moved to another owner", async () => {
  const r = await ayse("PUT", "/api/notes/a1", note("a1", { ownerId: "someone-else", updatedAt: new Date(Date.now() + 2000).toISOString() }));
  assert.equal(r.status, 409);
});

test("renaming the shared folder keeps the share", async () => {
  await kaan("POST", "/api/shares/move", { from: ["Alışveriş"], to: ["Ev", "Alışveriş"] });
  await kaan("PUT", "/api/notes/k1", note("k1", { path: ["Ev", "Alışveriş"], updatedAt: new Date(Date.now() + 3000).toISOString() }));
  const seen = await ayse("GET", "/api/notes");
  assert.ok(seen.body.notes.some((n) => n.id === "k1"), "she still sees it at its new place");
  assert.deepEqual((await ayse("GET", "/api/shares")).body.withMe[0].path, ["Ev", "Alışveriş"]);
});

test("taking the share back hides it at once", async () => {
  const mine = (await kaan("GET", "/api/shares")).body.mine[0];
  assert.equal((await kaan("DELETE", "/api/shares/" + mine.id)).status, 204);
  const seen = await ayse("GET", "/api/notes");
  assert.deepEqual(seen.body.notes, [], "nothing of his is left");
  const write = await ayse("PUT", "/api/notes/a2", note("a2", { ownerId: kaanUser.id }));
  assert.equal(write.status, 403);
  const his = await kaan("GET", "/api/notes");
  assert.ok(his.body.notes.some((n) => n.id === "a1"), "what she added stays with his folder");
});

test("locked folders cannot be shared, and you cannot share with yourself", async () => {
  await kaan("PUT", "/api/protected-folders/Gizli", { salt: "ab".repeat(16), iterations: 600000, checkCipher: "aXY=:Y3Q=" });
  const locked = await kaan("POST", "/api/shares", { path: ["Gizli"], email: "ayse@example.com" });
  assert.equal(locked.status, 400);
  assert.match(locked.body.error, /locked/);
  const inside = await kaan("POST", "/api/shares", { path: ["Gizli", "Alt"], email: "ayse@example.com" });
  assert.equal(inside.status, 400);
  const self = await kaan("POST", "/api/shares", { path: ["Alışveriş"], email: "KAAN@example.com" });
  assert.equal(self.status, 400);
  const bad = await kaan("POST", "/api/shares", { path: ["Alışveriş"], email: "not-an-email" });
  assert.equal(bad.status, 400);
});

test("someone invited before they have an account gets the folder when they sign in", async () => {
  await kaan("POST", "/api/shares", { path: ["Ev", "Alışveriş"], email: "yeni@example.com" }); // renamed above
  const yeni = client();
  await yeni.login("yeni@example.com"); // first ever sign-in
  const invites = await yeni("GET", "/api/shares");
  assert.equal(invites.body.withMe.length, 1, "the waiting invite is linked to the new account");
  await yeni("POST", "/api/shares/accept", { id: invites.body.withMe[0].id });
  const seen = await yeni("GET", "/api/notes");
  assert.ok(seen.body.notes.some((n) => n.id === "k1"));
});

test("leaving a share removes it for that person only", async () => {
  const yeni = client();
  await yeni.login("yeni@example.com");
  const mine = (await yeni("GET", "/api/shares")).body.withMe[0];
  assert.equal((await yeni("DELETE", "/api/shares/" + mine.id)).status, 204);
  assert.deepEqual((await yeni("GET", "/api/notes")).body.notes, []);
  assert.ok((await kaan("GET", "/api/notes")).body.notes.some((n) => n.id === "k1"), "the owner keeps his notes");
});

test("someone who accepted once is not asked again (D19)", async () => {
  const irmak = client();
  const irmakUser = await irmak.login("irmak@example.com");
  await kaan("PUT", "/api/notes/k9", note("k9", { path: ["Tatil"], content: { text: "otel" } }));

  // First folder: a normal invitation, nothing shared until accepted.
  const first = await kaan("POST", "/api/shares", { path: ["Tatil"], email: "irmak@example.com" });
  assert.equal(first.body.status, "pending");
  assert.deepEqual((await irmak("GET", "/api/notes")).body.notes, []);
  await irmak("POST", "/api/shares/accept", { token: first.body.token });
  assert.ok((await irmak("GET", "/api/notes")).body.notes.some((n) => n.id === "k9"));

  // Second folder: she already trusted him once, so it is simply there.
  await kaan("PUT", "/api/notes/k10", note("k10", { path: ["Filmler"], content: { text: "izlenecek" } }));
  const second = await kaan("POST", "/api/shares", { path: ["Filmler"], email: "Irmak@Example.com" });
  assert.equal(second.body.status, "accepted", "no second invitation to accept");
  const seen = await irmak("GET", "/api/notes");
  assert.ok(seen.body.notes.some((n) => n.id === "k10"), "the new folder is there at once");

  // She can still walk away from it.
  const hers = (await irmak("GET", "/api/shares")).body.withMe.find((s) => s.path.join("/") === "Filmler");
  assert.equal((await irmak("DELETE", "/api/shares/" + hers.id)).status, 204);
  assert.ok(!(await irmak("GET", "/api/notes")).body.notes.some((n) => n.id === "k10"));
  assert.ok(irmakUser.id);
});

test("the people you have shared with are offered next time", async () => {
  const contacts = (await kaan("GET", "/api/shares")).body.contacts;
  assert.ok(Array.isArray(contacts));
  assert.ok(contacts.some((c) => c.email === "irmak@example.com"), "Irmak accepted, so she is listed");
  assert.equal(contacts.filter((c) => c.email === "irmak@example.com").length, 1, "once, however many folders");
  const stranger = (await kaan("GET", "/api/shares")).body.contacts.some((c) => c.email === "yabanci@example.com");
  assert.equal(stranger, false, "someone who never accepted is not");
});
