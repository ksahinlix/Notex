import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { COOKIE_NAME, createSessionToken } from "../src/auth.js";
import { AiError, MODELS, extractJson } from "../src/ai/cloudflare.js";
import { cleanPath, categoryUserPrompt } from "../src/ai/prompts.js";
import { createAiService } from "../src/ai/service.js";
import { startTestDb } from "./helpers/db.js";

// ---- pure helpers ----

test("extractJson handles the formats different models use", () => {
  assert.deepEqual(extractJson({ response: { path: ["A", "B"] } }), { path: ["A", "B"] });
  assert.deepEqual(extractJson({ response: 'Tamam: {"path":["A"]}' }), { path: ["A"] });
  assert.deepEqual(extractJson({ choices: [{ message: { content: '<think>hmm {x}</think>\n```json\n{"ids":[2,1]}\n```' } }] }), { ids: [2, 1] });
  assert.throws(() => extractJson({ response: "no json here" }), AiError);
});

test("cleanPath tidies names and reuses existing spelling", () => {
  const folders = [["Sağlık", "Randevu"], ["Eğlence", "İzlenecekler"]];
  assert.deepEqual(cleanPath(["sağlık", "randevu"], folders), ["Sağlık", "Randevu"]);
  assert.deepEqual(cleanPath(["eğlence", "filmler"], folders), ["Eğlence", "Filmler"]);
  assert.deepEqual(cleanPath(["  kitaplar ", "Kitaplar"], []), ["Kitaplar"]);
  assert.deepEqual(cleanPath(["a", "b", "c", "d"], []), ["A", "B", "C"]);
  assert.equal(cleanPath("nope", []), null);
  assert.match(categoryUserPrompt("x", []), /\(yok\)/);
});

// ---- service + routes with a fake AI and a real database ----

// Tiny deterministic "embedding": one dimension per topic word.
const TOPICS = ["film", "dizi", "market", "süt", "musluk", "kombi", "gizli"];
function fakeVec(text) {
  const t = text.toLocaleLowerCase("tr");
  const v = TOPICS.map((w) => (t.includes(w) ? 1 : 0));
  v.push(0.01);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

const calls = { embed: [], chat: [] };
let failMainModel = false;
let failRerank = false;
const fakeAi = {
  async embed(texts) {
    calls.embed.push(...texts);
    return texts.map(fakeVec);
  },
  async chatJson(model, system, user) {
    calls.chat.push({ model, user });
    if (user.startsWith("Sorgu:")) {
      if (failRerank) throw new AiError("down", 502);
      // choose the shortlist lines mentioning "film" or "dizi"
      const lines = user.split("\n").filter((l) => /^\d+\./.test(l));
      return { ids: lines.filter((l) => /film|dizi/i.test(l)).map((l) => Number(l.split(".")[0])) };
    }
    if (failMainModel && model === MODELS.category) throw new AiError("quota", 429);
    return /film|dizi/i.test(user.split("Not:")[1]) ? { konu: "film", path: ["eğlence", "izlenecekler"] } : { konu: "x", path: ["Ev", "Tamirat"] };
  },
};

let db, server, base, cookie, otherCookie;
function note(id, path, text, extra = {}) {
  const now = new Date().toISOString();
  return { id, path, encrypted: false, content: { text }, cipher: null, isListItem: false, checked: false, reminderAt: null, createdAt: now, updatedAt: now, ...extra };
}
const api = async (method, url, body, auth = true, as = cookie) => {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(auth ? { cookie: as } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  db = await startTestDb();
  const aiService = createAiService({ pool: db.pool, ai: fakeAi });
  server = createApp({ pool: db.pool, sessionSecret: "s", aiService, aiDailyLimit: 12 }).listen(0);
  base = `http://localhost:${server.address().port}`;
  await db.pool.query(`INSERT INTO users (id, google_sub, email) VALUES ('u1', 'g1', 'u1@x.com'), ('u2', 'g2', 'u2@x.com')`);
  cookie = `${COOKIE_NAME}=${createSessionToken("s", "u1")}`;
  otherCookie = `${COOKIE_NAME}=${createSessionToken("s", "u2")}`;
  for (const n of [
    note("n1", ["Eğlence", "İzlenecekler"], "Inception filmi"),
    note("n2", ["Eğlence", "İzlenecekler"], "Breaking Bad dizisi"),
    note("n3", ["Alışveriş", "Market"], "Süt ve ekmek al"),
    note("n4", ["Ev", "Tamirat"], "Musluk damlatıyor"),
    note("secret", ["Kişisel", "Günlük"], null, { encrypted: true, content: null, cipher: "aXY=:Y3Q=" }),
  ])
    assert.equal((await api("PUT", `/api/notes/${n.id}`, n)).status, 200);
});
after(async () => {
  server?.close();
  await db?.stop();
});

test("AI routes need login and valid input", async () => {
  assert.equal((await api("POST", "/api/ai/classify", { text: "film" }, false)).status, 401);
  assert.equal((await api("POST", "/api/ai/classify", { text: "x" })).status, 400);
  assert.equal((await api("GET", "/api/ai/search?q=a")).status, 400);
});

test("classify: model's folder with existing spelling, plus similar folders", async () => {
  const r = await api("POST", "/api/ai/classify", { text: "Oppenheimer filmini izle" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.path, ["Eğlence", "İzlenecekler"]);
  assert.equal(r.body.isNew, false);
  assert.ok(Array.isArray(r.body.alternatives));
  assert.ok(!r.body.alternatives.some((p) => p.join("/") === "Eğlence/İzlenecekler"));
  // the prompt lists existing folders
  assert.match(calls.chat.at(-1).user, /- Eğlence \/ İzlenecekler/);
});

test("classify: falls back to the second model when the main one fails", async () => {
  failMainModel = true;
  const r = await api("POST", "/api/ai/classify", { text: "Kombi bakımı" });
  failMainModel = false;
  assert.equal(r.status, 200);
  assert.equal(r.body.model, MODELS.categoryFallback);
  assert.deepEqual(r.body.path, ["Ev", "Tamirat"]);
});

test("encrypted notes are never sent to the AI and get no vectors", async () => {
  const { rows } = await db.pool.query("SELECT note_id FROM note_vectors ORDER BY note_id");
  assert.deepEqual(rows.map((r) => r.note_id), ["n1", "n2", "n3", "n4"]);
  assert.ok(!calls.embed.some((t) => t.includes("Günlük")));
});

test("vectors follow edits; search re-ranks by meaning", async () => {
  const before = calls.embed.length;
  const edited = note("n4", ["Ev", "Tamirat"], "Kombi arızalı", { updatedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await api("PUT", "/api/notes/n4", edited)).status, 200);
  const r = await api("GET", "/api/ai/search?q=izlenecek film");
  assert.equal(r.status, 200);
  assert.equal(r.body.reranked, true);
  assert.deepEqual(r.body.ids.sort(), ["n1", "n2"]);
  assert.ok(calls.embed.slice(before).some((t) => t.includes("Kombi arızalı")), "edited note re-embedded");

  failRerank = true;
  const f = await api("GET", "/api/ai/search?q=film");
  failRerank = false;
  assert.equal(f.body.reranked, false);
  assert.equal(f.body.ids[0], "n1"); // falls back to vector order
});

test("without Cloudflare configured the AI routes answer 503", async () => {
  const s = createApp({ pool: db.pool, sessionSecret: "s" }).listen(0);
  const res = await fetch(`http://localhost:${s.address().port}/api/ai/search?q=film`, { headers: { cookie } });
  s.close();
  assert.equal(res.status, 503);
});

test("AI only sees the signed-in user's notes", async () => {
  const r = await api("GET", "/api/ai/search?q=film", undefined, true, otherCookie);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ids, []); // u2 has no notes; u1's films are not visible
  const c = await api("POST", "/api/ai/classify", { text: "Dune filmini izle" }, true, otherCookie);
  assert.equal(c.body.isNew, true); // u1's "Eğlence / İzlenecekler" is not u2's folder
  assert.deepEqual(c.body.alternatives, []);
  assert.match(calls.chat.filter((x) => x.user.includes("Dune")).at(-1).user, /(yok)/);
});

test("daily AI limit per user", async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await api("GET", "/api/ai/search?q=film", undefined, true, otherCookie);
  assert.equal(last.status, 429);
  assert.equal(last.body.error, "daily AI limit reached");
  // invalid requests don't count, and other users are unaffected
  assert.equal((await api("GET", "/api/ai/search?q=a", undefined, true, otherCookie)).status, 400);
  assert.equal((await api("GET", "/api/ai/search?q=film")).status, 200);
});
