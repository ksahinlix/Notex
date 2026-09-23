// Checks meaning-based search with Cloudflare's bge-m3 embeddings on Turkish
// notes: are the expected notes on top, and how do scores of relevant vs.
// unrelated notes compare (used to pick the result cut-off in src/ai/search.js).
// Usage (from server/): node --env-file=.env scripts/eval-cloud-search.mjs
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const T = process.env.CLOUDFLARE_API_TOKEN;

const notes = {
  "İş / Notex / Toplantılar": ["Sprint planlama toplantısı: login ekranı bitti, arama gelecek hafta", "Pazartesi 10:00 ekip toplantısında deploy konuşulacak", "Müşteriyle görüşme: yeni özellik talepleri"],
  "İş / Notex / Fikirler": ["Notlara sesli giriş eklenebilir", "Klasörlere renk verme özelliği güzel olur", "Paylaşılabilir not bağlantısı"],
  "İş / Faturalar": ["Ekim ayı hosting faturası ödendi", "KDV beyannamesi son gün 26 Ekim"],
  "Kişisel / İzlenecekler": ["Inception", "Breaking Bad dizisi", "Interstellar filmi"],
  "Kişisel / Okunacaklar": ["Suç ve Ceza", "Sapiens kitabı", "Tutunamayanlar"],
  "Kişisel / Sağlık": ["Diş hekimi randevusu perşembe", "Günde 2 litre su içmeyi unutma", "Kan tahlili sonuçları normal"],
  "Kişisel / Alışveriş": ["Süt, yumurta, ekmek al", "Yeni koşu ayakkabısı bak", "Çamaşır suyu bitti"],
  "Kişisel / Tarifler": ["Mercimek çorbası: 1 su bardağı mercimek, soğan, havuç", "Fırında tavuk için marinasyon"],
  "Ev / Tamirat": ["Mutfak musluğu damlatıyor, tesisatçı çağır", "Balkon kapısının menteşesi gıcırdıyor"],
  "Yazılım / React": ["useEffect bağımlılık dizisi boş olursa sadece ilk renderda çalışır", "React Query ile cache yönetimi"],
  "Seyahat / İtalya": ["Roma otel rezervasyonu 12-15 Mayıs", "Floransa müzeleri için bilet al"],
};
const searches = [
  ["film", ["Inception", "Interstellar filmi"]],
  ["doktor", ["Diş hekimi randevusu perşembe", "Kan tahlili sonuçları normal"]],
  ["evde bozulan şeyler", ["Mutfak musluğu damlatıyor, tesisatçı çağır", "Balkon kapısının menteşesi gıcırdıyor"]],
  ["market listesi", ["Süt, yumurta, ekmek al", "Çamaşır suyu bitti"]],
  ["toplantı", ["Sprint planlama toplantısı: login ekranı bitti, arama gelecek hafta", "Pazartesi 10:00 ekip toplantısında deploy konuşulacak"]],
  ["kitap", ["Sapiens kitabı", "Suç ve Ceza", "Tutunamayanlar"]],
  ["yemek", ["Mercimek çorbası: 1 su bardağı mercimek, soğan, havuç", "Fırında tavuk için marinasyon"]],
  ["tatil", ["Roma otel rezervasyonu 12-15 Mayıs", "Floransa müzeleri için bilet al"]],
  ["ödemeler", ["Ekim ayı hosting faturası ödendi", "KDV beyannamesi son gün 26 Ekim"]],
  ["hook kullanımı", ["useEffect bağımlılık dizisi boş olursa sadece ilk renderda çalışır"]],
];

async function embed(texts) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/ai/run/@cf/baai/bge-m3`, {
    method: "POST",
    headers: { authorization: "Bearer " + T, "content-type": "application/json" },
    body: JSON.stringify({ text: texts }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result.data.map((v) => { const n = Math.hypot(...v); return v.map((x) => x / n); });
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const list = Object.entries(notes).flatMap(([p, ts]) => ts.map((t) => ({ p, t })));
for (const withPath of [true, false]) {
  const vecs = await embed(list.map((n) => (withPath ? `${n.p}\n${n.t}` : n.t)));
  let hits = 0, total = 0;
  console.log(`\n=== bge-m3, path in text: ${withPath}`);
  for (const [q, want] of searches) {
    const [qv] = await embed([q]);
    const ranked = list.map((n, i) => [n.t, dot(qv, vecs[i])]).sort((a, b) => b[1] - a[1]);
    const h = ranked.slice(0, want.length).filter(([t]) => want.includes(t)).length;
    hits += h; total += want.length;
    const rel = ranked.filter(([t]) => want.includes(t)).map(([, s]) => s);
    const other = ranked.filter(([t]) => !want.includes(t)).map(([, s]) => s);
    console.log(`  "${q}": ${h}/${want.length} | top ${ranked[0][1].toFixed(3)} weakest relevant ${Math.min(...rel).toFixed(3)} strongest other ${Math.max(...other).toFixed(3)} median other ${other.sort()[Math.floor(other.length / 2)].toFixed(3)}`);
  }
  console.log(`  SEARCH ${hits}/${total}`);
}

// ---- shortlist (embeddings) + rerank (language model) ----
async function rerank(model, query, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.t}`).join("\n");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: "Bearer " + T, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "Kişisel notlarda arama yapıyorsun. Aşağıdaki notlardan arama sorgusuyla ANLAM olarak ilgili olanları seç (kelime geçmese de konu olarak ilgiliyse seç; alakasızları seçme). En ilgiliden başlayarak numaralarını döndür. Sadece JSON: {\"ids\":[numara,...]}" },
        { role: "user", content: `Sorgu: ${JSON.stringify(query)}\n\nNotlar:\n${list}` },
      ],
      temperature: 0, max_tokens: 200,
    }),
  });
  const j = await r.json();
  const res = j.result?.response;
  const obj = res && typeof res === "object" ? res : JSON.parse(String(typeof res === "string" ? res : j.result?.choices?.[0]?.message?.content).match(/\{[\s\S]*\}/)[0]);
  return { ids: obj.ids.map(Number).filter((n) => n >= 1 && n <= candidates.length), usage: j.result?.usage };
}
const vecs = await embed(list.map((n) => `${n.p}\n${n.t}`));
for (const model of ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/qwen/qwen3-30b-a3b-fp8"]) {
  let tp = 0, fp = 0, fn = 0, recall12 = 0, total = 0, ms = 0, tin = 0;
  console.log(`\n=== shortlist 12 + rerank with ${model}`);
  for (const [q, want] of searches) {
    const [qv] = await embed([q]);
    const top = list.map((n, i) => ({ ...n, s: dot(qv, vecs[i]) })).sort((a, b) => b.s - a.s).slice(0, 12);
    recall12 += top.filter((c) => want.includes(c.t)).length; total += want.length;
    const t0 = Date.now();
    const { ids, usage } = await rerank(model, q, top);
    ms += Date.now() - t0; tin += usage?.prompt_tokens ?? 0;
    const picked = ids.map((i) => top[i - 1].t);
    const good = picked.filter((t) => want.includes(t)).length;
    tp += good; fp += picked.length - good; fn += want.length - good;
    console.log(`  "${q}": picked ${picked.length} -> ${good}/${want.length} right, ${picked.length - good} extra | ${picked.slice(0, 4).map((t) => t.slice(0, 22)).join(" · ")}`);
  }
  console.log(`  shortlist recall ${recall12}/${total} · found ${tp}/${total} · extra ${fp} · avg ${Math.round(ms / searches.length)} ms · avg tokens in ${Math.round(tin / searches.length)}`);
}
