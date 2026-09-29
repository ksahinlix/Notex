// Notifications end to end (D21): who may subscribe, who may drive the
// scheduler endpoint, and who gets told when a shared reminder comes due.
// WARNING: the tables in the TEST_DATABASE_URL database are emptied.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { recipientsOf, sendDueReminders } from "../src/push.js";
import { startTestDb } from "./helpers/db.js";

let db, pool, server, base, kaan, ayse, kaanUser, ayseUser;
const sent = [];

// Stands in for the push services: records what would be delivered.
const push = {
  publicKey: "test-public-key",
  async sendToUsers(_pool, userIds, payload) {
    sent.push({ userIds: [...userIds].sort(), payload });
    return { sent: userIds.length, gone: 0 };
  },
};

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
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  call.login = async (email) => (await call("POST", "/api/auth/google", { credential: "good:" + email })).body.user;
  return call;
}

const sub = (n) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: "key-" + n, auth: "auth-" + n } });
const note = (id, extra = {}) => {
  const now = new Date().toISOString();
  return {
    id, path: ["Ev"], encrypted: false, content: { text: "Kira öde" }, cipher: null,
    isListItem: false, checked: false, reminderAt: null, createdAt: now, updatedAt: now, ...extra,
  };
};

before(async () => {
  db = await startTestDb();
  pool = db.pool;
  const app = createApp({ pool, sessionSecret: "s", googleClientId: "c", verifyGoogle, push, cronSecret: "cron-secret" });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  kaan = client();
  ayse = client();
  kaanUser = await kaan.login("kaan@example.com");
  ayseUser = await ayse.login("ayse@example.com");
});

after(async () => {
  server?.close();
  await db?.stop();
});

test("a browser subscribes, appears as a device, and can leave again", async () => {
  assert.equal((await kaan("GET", "/api/push/key")).body.publicKey, "test-public-key");
  assert.equal((await kaan("POST", "/api/push/subscribe", sub(1))).status, 201);
  assert.deepEqual((await kaan("GET", "/api/push/status")).body, { configured: true, devices: 1 });

  // The same device saying so twice is still one device.
  await kaan("POST", "/api/push/subscribe", sub(1));
  assert.equal((await kaan("GET", "/api/push/status")).body.devices, 1);
  await kaan("POST", "/api/push/subscribe", sub(2));
  assert.equal((await kaan("GET", "/api/push/status")).body.devices, 2);

  assert.equal((await kaan("POST", "/api/push/unsubscribe", { endpoint: sub(2).endpoint })).status, 204);
  assert.equal((await kaan("GET", "/api/push/status")).body.devices, 1);
});

test("rubbish subscriptions are refused, and a stranger cannot subscribe at all", async () => {
  assert.equal((await kaan("POST", "/api/push/subscribe", { endpoint: "http://not-https", keys: {} })).status, 400);
  assert.equal((await kaan("POST", "/api/push/subscribe", { endpoint: "https://x/1" })).status, 400);
  const nobody = client();
  assert.equal((await nobody("POST", "/api/push/subscribe", sub(9))).status, 401);
  assert.equal((await nobody("GET", "/api/push/status")).status, 401);
});

test("the scheduler endpoint needs the shared secret", async () => {
  const nobody = client();
  assert.equal((await nobody("POST", "/api/reminders/due")).status, 401, "no key");
  assert.equal((await nobody("POST", "/api/reminders/due", undefined, { "x-cron-key": "wrong" })).status, 401);
  // A signed-in user is not automatically allowed either: this is not theirs to run.
  assert.equal((await kaan("POST", "/api/reminders/due")).status, 401);
  assert.equal((await nobody("POST", "/api/reminders/due", undefined, { "x-cron-key": "cron-secret" })).status, 200);
});

test("a reminder that has come due is sent once, then not again", async () => {
  const due = new Date(Date.now() - 60_000).toISOString();
  await kaan("PUT", "/api/notes/r1", note("r1", { reminderAt: due, isReminder: true, content: { text: "Kira öde" } }));
  sent.length = 0;

  const first = await sendDueReminders(pool, push);
  assert.equal(first.due, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].userIds, [kaanUser.id]);
  assert.equal(sent[0].payload.body, "Kira öde");

  const second = await sendDueReminders(pool, push);
  assert.equal(second.due, 0, "the same occurrence is not sent twice");
});

test("everyone the folder is shared with is told, once they have accepted", async () => {
  const made = await kaan("POST", "/api/shares", { path: ["Ev"], email: "ayse@example.com" });
  const due = new Date(Date.now() - 60_000).toISOString();
  await kaan("PUT", "/api/notes/r2", note("r2", { reminderAt: due, isReminder: true, content: { text: "Faturayı öde" } }));

  sent.length = 0;
  await sendDueReminders(pool, push);
  assert.deepEqual(sent[0].userIds, [kaanUser.id], "while the invite is waiting, only the owner");

  await ayse("POST", "/api/shares/accept", { token: made.body.token });
  await kaan("PUT", "/api/notes/r3", note("r3", { reminderAt: due, isReminder: true, content: { text: "Süt al" } }));
  sent.length = 0;
  await sendDueReminders(pool, push);
  assert.deepEqual(sent[0].userIds, [kaanUser.id, ayseUser.id].sort(), "after accepting, both");
});

test("a locked note's words never leave the server", async () => {
  const due = new Date(Date.now() - 60_000).toISOString();
  await kaan("PUT", "/api/notes/r4", note("r4", {
    path: ["Gizli"], encrypted: true, cipher: "aXY=:Y3Q=", content: null,
    reminderAt: due, isReminder: true,
  }));
  sent.length = 0;
  await sendDueReminders(pool, push);
  const payload = sent.find((s) => s.payload.noteId === "r4").payload;
  assert.equal(payload.body, "Kilitli bir notunda hatırlatman var.");
  assert.equal(payload.title, "Hatırlatma", "not even the folder name");
});

test("recipients follow the share, not the folder name", async () => {
  const mine = { user_id: kaanUser.id, path: ["Ev", "Alışveriş"] };
  assert.deepEqual((await recipientsOf(pool, mine)).sort(), [kaanUser.id, ayseUser.id].sort(), "a subfolder is covered");
  const other = { user_id: kaanUser.id, path: ["İş"] };
  assert.deepEqual(await recipientsOf(pool, other), [kaanUser.id], "an unshared folder is not");
});
