// Compares embedding models on Turkish notes (folder suggestion + search).
// Run from web/: node scripts/eval-ai.mjs Xenova/multilingual-e5-small [more models]
// Results that led to the model choice are in docs/PROJECT_LOG.md (D12).
import { pipeline, AutoTokenizer, AutoModel } from '@huggingface/transformers'
const MODELS = process.argv.slice(2)
const WITHPATH = process.env.WITHPATH !== '0'
const folders = {
  'İş / Notex / Toplantılar': ['Sprint planlama toplantısı: login ekranı bitti, arama gelecek hafta', 'Pazartesi 10:00 ekip toplantısında deploy konuşulacak', 'Müşteriyle görüşme: yeni özellik talepleri'],
  'İş / Notex / Fikirler': ['Notlara sesli giriş eklenebilir', 'Klasörlere renk verme özelliği güzel olur', 'Paylaşılabilir not bağlantısı'],
  'İş / Faturalar': ['Ekim ayı hosting faturası ödendi', 'KDV beyannamesi son gün 26 Ekim'],
  'Kişisel / İzlenecekler': ['Inception', 'Breaking Bad dizisi', 'Interstellar filmi'],
  'Kişisel / Okunacaklar': ['Suç ve Ceza', 'Sapiens kitabı', 'Tutunamayanlar'],
  'Kişisel / Sağlık': ['Diş hekimi randevusu perşembe', 'Günde 2 litre su içmeyi unutma', 'Kan tahlili sonuçları normal'],
  'Kişisel / Alışveriş': ['Süt, yumurta, ekmek al', 'Yeni koşu ayakkabısı bak', 'Çamaşır suyu bitti'],
  'Kişisel / Tarifler': ['Mercimek çorbası: 1 su bardağı mercimek, soğan, havuç', 'Fırında tavuk için marinasyon'],
  'Ev / Tamirat': ['Mutfak musluğu damlatıyor, tesisatçı çağır', 'Balkon kapısının menteşesi gıcırdıyor'],
  'Yazılım / React': ['useEffect bağımlılık dizisi boş olursa sadece ilk renderda çalışır', 'React Query ile cache yönetimi'],
  'Seyahat / İtalya': ['Roma otel rezervasyonu 12-15 Mayıs', 'Floransa müzeleri için bilet al'],
}
const newNotes = [
  ['The Office dizisini izle', 'Kişisel / İzlenecekler'],
  ['Göz doktoruna git', 'Kişisel / Sağlık'],
  ['Cuma günkü müşteri toplantısı notları: fiyat teklifi istendi', 'İş / Notex / Toplantılar'],
  ['Banyodaki lamba yanmıyor', 'Ev / Tamirat'],
  ['Deterjan ve peçete alınacak', 'Kişisel / Alışveriş'],
  ['Uygulamaya karanlık tema eklesek mi?', 'İş / Notex / Fikirler'],
  ['Vitamin D takviyesi almaya başla', 'Kişisel / Sağlık'],
  ['Kombi bakımı yaptırılmalı', 'Ev / Tamirat'],
  ['Simyacı romanını oku', 'Kişisel / Okunacaklar'],
  ['Elektrik faturası 450 TL', 'İş / Faturalar'],
  ['Karnıyarık nasıl yapılır: patlıcan, kıyma, domates', 'Kişisel / Tarifler'],
  ['useState ile form state tutmak', 'Yazılım / React'],
  ['Venedik gondol turu', 'Seyahat / İtalya'],
  ['Oppenheimer izlenecek', 'Kişisel / İzlenecekler'],
  ['Notlara etiket ekleme özelliği', 'İş / Notex / Fikirler'],
  ['Baş ağrısı için ibuprofen', 'Kişisel / Sağlık'],
]
const searches = [
  ['film', ['Inception', 'Interstellar filmi']],
  ['doktor', ['Diş hekimi randevusu perşembe', 'Kan tahlili sonuçları normal']],
  ['evde bozulan şeyler', ['Mutfak musluğu damlatıyor, tesisatçı çağır', 'Balkon kapısının menteşesi gıcırdıyor']],
  ['market listesi', ['Süt, yumurta, ekmek al', 'Çamaşır suyu bitti']],
  ['toplantı', ['Sprint planlama toplantısı: login ekranı bitti, arama gelecek hafta', 'Pazartesi 10:00 ekip toplantısında deploy konuşulacak']],
  ['kitap', ['Sapiens kitabı', 'Suç ve Ceza', 'Tutunamayanlar']],
  ['yemek', ['Mercimek çorbası: 1 su bardağı mercimek, soğan, havuç', 'Fırında tavuk için marinasyon']],
  ['tatil', ['Roma otel rezervasyonu 12-15 Mayıs', 'Floransa müzeleri için bilet al']],
  ['ödemeler', ['Ekim ayı hosting faturası ödendi', 'KDV beyannamesi son gün 26 Ekim']],
  ['hook kullanımı', ['useEffect bağımlılık dizisi boş olursa sadece ilk renderda çalışır']],
]
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

async function load(model) {
  if (model.includes('gemma')) {
    const tok = await AutoTokenizer.from_pretrained(model)
    const m = await AutoModel.from_pretrained(model, { dtype: 'q4' })
    const pre = { query: 'task: search result | query: ', passage: 'title: none | text: ' }
    return async (texts, kind) => {
      const inp = await tok(texts.map((t) => pre[kind] + t), { padding: true, truncation: true })
      return (await m(inp)).sentence_embedding.tolist()
    }
  }
  const e5 = model.includes('e5')
  const ext = await pipeline('feature-extraction', model, { dtype: 'q8' })
  return async (texts, kind) => (await ext(texts.map((t) => (e5 ? `${kind}: ${t}` : t)), { pooling: 'mean', normalize: true })).tolist()
}

for (const model of MODELS) {
  const t0 = Date.now()
  const emb = await load(model)
  console.log(`\n=== ${model} path=${WITHPATH} (load ${Date.now() - t0} ms)`)
  const notes = Object.entries(folders).flatMap(([p, ts]) => ts.map((t) => ({ p, t })))
  const t1 = Date.now()
  const vecs = await emb(notes.map((n) => (WITHPATH ? `${n.p}\n${n.t}` : n.t)), 'passage')
  console.log(`embed ${notes.length} notes: ${Date.now() - t1} ms`)
  const names = await emb(Object.keys(folders), 'passage')
  let correct = 0, correct3 = 0
  const margins = []
  for (const [text, want] of newNotes) {
    const [q] = await emb([text], 'query')
    const scores = Object.keys(folders).map((p, fi) => {
      const sims = notes.flatMap((n, i) => (n.p === p ? [dot(q, vecs[i])] : [])).sort((a, b) => b - a)
      const top = sims.slice(0, 2)
      return [p, 0.6 * (top.reduce((a, b) => a + b, 0) / top.length) + 0.4 * dot(q, names[fi])]
    }).sort((a, b) => b[1] - a[1])
    const ok = scores[0][0] === want
    correct += ok
    correct3 += scores.slice(0, 3).some(([p]) => p === want)
    margins.push([ok, scores[0][1] - scores[1][1]])
    if (!ok) console.log(`  miss: ${text} -> ${scores[0][0]} (want ${want}, rank ${scores.findIndex(([p]) => p === want) + 1})`)
  }
  console.log(`FOLDER top1 ${correct}/${newNotes.length}  top3 ${correct3}/${newNotes.length}`)
  let hits = 0, total = 0
  for (const [q, want] of searches) {
    const [qv] = await emb([q], 'query')
    const ranked = notes.map((n, i) => [n.t, dot(qv, vecs[i])]).sort((a, b) => b[1] - a[1])
    const h = ranked.slice(0, want.length).filter(([t]) => want.includes(t)).length
    hits += h; total += want.length
    const relevant = ranked.filter(([t]) => want.includes(t)).map(([, s]) => s)
    const irrelevant = ranked.filter(([t]) => !want.includes(t)).map(([, s]) => s)
    console.log(`  "${q}": ${h}/${want.length} | weakest relevant ${Math.min(...relevant).toFixed(3)} strongest other ${Math.max(...irrelevant).toFixed(3)} | top ${ranked[0][1].toFixed(3)}`)
  }
  console.log(`SEARCH ${hits}/${total}`)
}
