// Prompts and output clean-up for the AI features (D13 prompt, now run in the
// cloud: D15). Tested prompt design: "topic first", 10 varied examples, and
// the list of existing folders so they are reused.

export const CATEGORY_SYSTEM = `Sen bir not uygulamasında notları konularına göre klasörlere ayıran asistansın.
Notun NE HAKKINDA olduğunu belirle ve ona genel bir klasör yolu ver: "Ana kategori / Alt kategori".

Kurallar:
- Genelde 2 seviye. Her ad 1-2 kelime, Türkçe, baş harfi büyük.
- Adlar genel ve tekrar kullanılabilir olsun: aynı konudaki başka notlar da oraya gidebilmeli.
- Notun kendisini, kişi adlarını, tarihleri ya da saatleri klasör adı yapma.
- Sana MEVCUT KLASÖRLER listesi verilir. Notun konusu bunlardan biriyle AYNI konuysa o yolu aynen kullan. Sadece benzer kategoride ama farklı konuysa (ör. Market ile Temizlik, Randevu ile İlaçlar) yeni alt klasör aç. Hiçbiri uymuyorsa yeni yol oluştur.

Örnekler:
"Pazartesi 9'da haftalık ekip toplantısı" -> {"konu":"iş toplantısı","path":["İş","Toplantılar"]}
"Dune 2 izlenecek" -> {"konu":"izlenecek film","path":["Eğlence","İzlenecekler"]}
"Mercimek çorbası tarifi" -> {"konu":"yemek tarifi","path":["Yemek","Tarifler"]}
"Kira 12.000 TL ödendi" -> {"konu":"ev gideri","path":["Finans","Faturalar"]}
"Çamaşır makinesi su kaçırıyor" -> {"konu":"ev arızası","path":["Ev","Tamirat"]}
"Tansiyon ilacını akşam al" -> {"konu":"sağlık","path":["Sağlık","İlaçlar"]}
"Antalya uçak bileti 3 Temmuz" -> {"konu":"seyahat planı","path":["Seyahat","Planlar"]}
"React'te useMemo ne zaman kullanılır" -> {"konu":"yazılım bilgisi","path":["Yazılım","React"]}
"Kahve, şeker, çay alınacak" -> {"konu":"market alışverişi","path":["Alışveriş","Market"]}
"Sapiens kitabı okunacak" -> {"konu":"okunacak kitap","path":["Kitaplar","Okunacaklar"]}

Sadece JSON döndür: {"konu": string, "path": [string, ...]}`;

const MAX_FOLDERS_IN_PROMPT = 80;
const MAX_NOTE_CHARS = 800;

export function categoryUserPrompt(text, folders) {
  const list = folders.slice(0, MAX_FOLDERS_IN_PROMPT).map((p) => "- " + p.join(" / ")).join("\n") || "(yok)";
  return `MEVCUT KLASÖRLER:\n${list}\n\nNot: ${JSON.stringify(text.slice(0, MAX_NOTE_CHARS))}`;
}

export const SEARCH_SYSTEM = `Kişisel notlarda arama yapıyorsun. Aşağıdaki notlardan arama sorgusuyla ANLAM olarak ilgili olanları seç (kelime geçmese de konu olarak ilgiliyse seç; alakasızları seçme). En ilgiliden başlayarak numaralarını döndür. Sadece JSON: {"ids":[numara,...]}`;

export function searchUserPrompt(query, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  return `Sorgu: ${JSON.stringify(query)}\n\nNotlar:\n${list}`;
}

const low = (s) => s.toLocaleLowerCase("tr");

/**
 * Cleans a model's path: trims, capitalizes, drops empty/overlong and
 * repeated segments ("Kitaplar / Kitaplar"), caps depth at 3, and reuses the
 * exact spelling of an existing folder when only the letter case differs.
 */
export function cleanPath(raw, folders) {
  if (!Array.isArray(raw)) return null;
  const segs = [];
  for (const r of raw) {
    let s = String(r).replace(/[/\\"“”]/g, " ").replace(/\s+/g, " ").trim();
    if (!s || s.length > 40) continue;
    s = s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
    if (segs.length && low(segs[segs.length - 1]) === low(s)) continue;
    segs.push(s);
  }
  if (!segs.length) return null;
  segs.length = Math.min(segs.length, 3);
  for (let i = 0; i < segs.length; i++) {
    const prefix = segs.slice(0, i).map(low).join("/");
    const match = folders.find((f) => f.length > i && f.slice(0, i).map(low).join("/") === prefix && low(f[i]) === low(segs[i]));
    if (match) segs[i] = match[i];
  }
  return segs;
}
