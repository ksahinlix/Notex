// Folders whose notes are checkable (D22): the owner marks them, everyone who
// can see the folder sees the mark, and it follows the folder when it moves.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base, kaan, ayse, stranger, kaanUser;

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
const keys = (r) => r.body.folders.map((f) => f.pathKey).sort();

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  stranger = client();
  kaanUser = await kaan.login("kaan@example.com");
  await ayse.login("ayse@example.com");
  await stranger.login("yabanci@example.com");
});

after(async () => {
  server?.close();
  await db?.stop();
});

test("a folder is marked and unmarked by its owner", async () => {
  assert.deepEqual(keys(await kaan("GET", "/api/todo-folders")), []);
  assert.equal((await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"))).status, 201);
  assert.deepEqual(keys(await kaan("GET", "/api/todo-folders")), ["Ev/Alışveriş"]);

  // Marking twice is not two folders.
  await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"));
  assert.deepEqual(keys(await kaan("GET", "/api/todo-folders")), ["Ev/Alışveriş"]);

  assert.equal((await kaan("DELETE", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"))).status, 204);
  assert.deepEqual(keys(await kaan("GET", "/api/todo-folders")), []);
  assert.equal((await kaan("DELETE", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"))).status, 404, "and again is a 404");
});

test("nobody else sees it, until the folder is shared with them", async () => {
  await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"));
  assert.deepEqual(keys(await ayse("GET", "/api/todo-folders")), [], "not before the invitation");

  const made = await kaan("POST", "/api/shares", { path: ["Ev"], email: "ayse@example.com" });
  assert.deepEqual(keys(await ayse("GET", "/api/todo-folders")), [], "not while it is waiting");

  await ayse("POST", "/api/shares/accept", { token: made.body.token });
  const hers = await ayse("GET", "/api/todo-folders");
  assert.deepEqual(keys(hers), ["Ev/Alışveriş"], "after accepting, the same folder is a to-do folder for her too");
  assert.equal(hers.body.folders[0].ownerId, kaanUser.id, "and it says whose it is");

  assert.deepEqual(keys(await stranger("GET", "/api/todo-folders")), [], "a stranger sees nothing");
});

test("her own marks stay hers", async () => {
  await ayse("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"));
  const mine = await kaan("GET", "/api/todo-folders");
  assert.equal(mine.body.folders.length, 1, "his list still has one");
  assert.equal(mine.body.folders[0].ownerId, kaanUser.id, "his own");
  await ayse("DELETE", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş"));
});

test("renaming the folder carries the mark, subfolders included", async () => {
  await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Ev/Alışveriş/Market"));
  const moved = await kaan("POST", "/api/todo-folders/move", { from: ["Ev"], to: ["Yaşam"] });
  assert.equal(moved.body.moved, 2, "the folder and the one inside it");
  assert.deepEqual(keys(await kaan("GET", "/api/todo-folders")), ["Yaşam/Alışveriş", "Yaşam/Alışveriş/Market"]);
});

test("a folder with a similar name is left alone", async () => {
  await kaan("PUT", "/api/todo-folders/" + encodeURIComponent("Yaşamtarzı"));
  await kaan("POST", "/api/todo-folders/move", { from: ["Yaşam"], to: ["Ev"] });
  const after = keys(await kaan("GET", "/api/todo-folders"));
  assert.ok(after.includes("Yaşamtarzı"), "Yaşamtarzı is not inside Yaşam");
  assert.ok(after.includes("Ev/Alışveriş"), "and the real one moved");
});

test("signing out leaves it alone", async () => {
  const nobody = client();
  assert.equal((await nobody("GET", "/api/todo-folders")).status, 401);
  assert.equal((await nobody("PUT", "/api/todo-folders/Ev")).status, 401);
});
