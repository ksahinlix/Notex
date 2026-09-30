// Compares Cloudflare Workers AI models at classifying Turkish notes into
// folders, starting from an empty notebook (each answer becomes an existing
// folder for the next note). Uses the same prompt as the app.
// Usage (from server/): node --env-file=.env scripts/eval-cloud-ai.mjs [model ...]
// The app's own prompt, so the numbers say something about the app. (It used
// to copy it out of the browser's llm.ts, which went away with on-device AI.)
import { CATEGORY_SYSTEM, categoryUserPrompt } from "../src/ai/prompts.js";

const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const T = process.env.CLOUDFLARE_API_TOKEN;

// --seeded: start from a notebook that already has folders, with notes whose
// topics match none of them. This is where a prompt that leans on the existing
// list shows itself — a poor fit gets chosen instead of a new folder.
const SEED = [
  "İş / Toplantılar", "Ev / Tamirat", "Alışveriş / Market", "Sağlık / Randevular",
  "Finans / Faturalar", "Yazılım / React", "Seyahat / Planlar", "Kitaplar / Okunacaklar",
  "Eğlence / İzlenecekler", "Yemek / Tarifler",
];
const seededNotes = [
  "Köpeğin aşı kartını yenilet",
  "Spor salonu üyeliği başladı, salı ve perşembe",
  "Vergi beyannamesi son gün 31 Mart",
  "Gitar akort etme uygulaması indir",
  "Araba lastiklerini kışlıkla değiştir",
  "İngilizce kelime çalışması: günde 20 kelime",
  "Ehliyet yenileme için sağlık raporu gerekiyor",
  "Balkona çiçek sulama sistemi kurulabilir",
];

const notes = [
  "Yarın 15:00 diş hekimi randevusu",
  "Inception filmini izle",
  "Süt, yumurta ve ekmek alınacak",
  "Notex uygulamasına karanlık tema eklenebilir",
  "Mutfak musluğu damlatıyor, tesisatçı çağır",
  "Breaking Bad dizisine başla",
  "Göz doktoruna git",
  "Sprint toplantısında deploy konuşuldu, login bitti",
  "Suç ve Ceza kitabını oku",
  "Kombi bakımı yaptırılmalı",
  "Notex: notlara etiket ekleme fikri",
  "Deterjan ve peçete al",
  "Roma otel rezervasyonu 12-15 Mayıs",
  "Elektrik faturası 450 TL ödendi",
  "Kedi bakımı: kediler günde 16 saat uyur. Mama önerileri: tahılsız mama, bol su.",
  "Postgres'te index nasıl eklenir: CREATE INDEX ...",
  "Annemin doğum günü hediyesi: şal veya kitap",
];

async function classify(model, text, folders) {
  const user = categoryUserPrompt(text, folders.map((f) => f.split(" / ")));
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: "Bearer " + T, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: CATEGORY_SYSTEM },
        // Qwen3 thinks before answering unless told not to.
        { role: "user", content: user + (model.includes("qwen3") ? " /no_think" : "") },
      ],
      temperature: 0,
      max_tokens: 1500,
      ...(model.includes("gpt-oss") ? { reasoning: { effort: "low" } } : {}),
    }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  // Formats differ: some models return an already-parsed object in `response`,
  // others text in `response` or in OpenAI-style `choices`.
  const res = j.result?.response;
  let obj = res && typeof res === "object" ? res : null;
  if (!obj) {
    const raw = String(typeof res === "string" ? res : j.result?.choices?.[0]?.message?.content ?? "");
    const json = raw.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("no JSON in: " + raw.slice(0, 80));
    obj = JSON.parse(json);
  }
  if (!Array.isArray(obj.path)) throw new Error("no path in: " + JSON.stringify(obj).slice(0, 100));
  const path = obj.path.map((s) => String(s).trim()).filter(Boolean);
  return { path, usage: j.result?.usage };
}

const seeded = process.argv.includes("--seeded");
for (const model of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  console.log(`\n=== ${model}${seeded ? " (notebook that already has folders)" : ""}`);
  const folders = new Set(seeded ? SEED : []);
  const list = seeded ? seededNotes : notes;
  let reusedSeed = 0;
  let ms = 0, tokensIn = 0, tokensOut = 0, fails = 0;
  for (const note of list) {
    const t0 = Date.now();
    let line;
    try {
      const { path, usage } = await classify(model, note, [...folders].sort());
      const key = path.join(" / ");
      if (SEED.includes(key)) reusedSeed++;
      line = `${key}${folders.has(key) ? "  (reused)" : ""}`;
      folders.add(key);
      tokensIn += usage?.prompt_tokens ?? 0;
      tokensOut += usage?.completion_tokens ?? 0;
    } catch (e) {
      fails++;
      line = "ERROR " + e.message.slice(0, 100);
    }
    ms += Date.now() - t0;
    console.log(`  ${note.slice(0, 50).padEnd(50)} -> ${line}`);
  }
  const n = list.length;
  console.log(`  avg ${Math.round(ms / n)} ms/note · ${folders.size} folders · avg tokens in ${Math.round(tokensIn / n)} out ${Math.round(tokensOut / n)} · errors ${fails}`);
  if (seeded) console.log(`  ${reusedSeed}/${n} notes went into a folder that already existed`);
}
