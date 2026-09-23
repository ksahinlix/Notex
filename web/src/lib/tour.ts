// The guided tour's steps. Each step points at an element marked with
// data-tour="<target>"; steps whose element isn't on screen are skipped
// (e.g. the note buttons when there are no notes yet).

export interface TourStep {
  /** data-tour value of the element to highlight; none = a centered card. */
  target?: string
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Notex'e hoş geldin 👋",
    body: 'Notlarını yazarsın, yapay zekâ onları kendisi klasörlere ayırır. Bu kısa tur uygulamanın neler yapabildiğini gösteriyor.',
  },
  {
    target: 'composer',
    title: 'Aklına geleni yaz',
    body: 'Notlarını buraya yaz. Web sayfalarından görselli içerik de yapıştırabilir ya da görsel sürükleyebilirsin. Ctrl+Enter kaydeder.',
  },
  {
    target: 'path',
    title: 'Klasörü AI seçsin',
    body: 'Klasörü boş bırakırsan yapay zekâ notunu okuyup uygun klasörü seçer, gerekirse yenisini oluşturur. Alttaki önerilerden birine tıklayarak değiştirebilir ya da kendin yazabilirsin.',
  },
  {
    target: 'reminder',
    title: 'Hatırlatmalar',
    body: '“Yarın 15:00 dişçi”, “Kredi kartı ekstresi her ayın 28’i” ya da “… hatırlat” yazınca hatırlatma kendiliğinden eklenir. Bu düğmeyle zamanı ve tekrarı elle de seçebilirsin.',
  },
  {
    target: 'fullscreen',
    title: 'Uzun yazılar için tam ekran',
    body: 'Uzun notları tam ekranda rahatça yaz; Esc ile çık.',
  },
  {
    target: 'tree',
    title: 'Klasörlerin',
    body: 'Klasöre tıklayınca yalnızca o klasörün notları görünür. Notları ⋮⋮ tutamacından sürükleyip bir klasöre bırak; not kendi klasör adını korur (ör. Yazılım / LSA). Klasörün ⋯ menüsünden yeniden adlandırabilir ya da taşıyabilir, 🔒 ile şifreleyebilirsin.',
  },
  {
    target: 'search',
    title: 'Anlamına göre ara',
    body: 'Kelimeyle birlikte anlamca da arar: “yemek” yazınca tarif notların, “yazılım” yazınca o konudaki notların bulunur. Eşleşen kelimeler sarıyla işaretlenir.',
  },
  {
    target: 'note',
    title: 'Not düğmeleri',
    body: '📖 okuma modu (büyük yazı, ← → ile notlar arasında gezinme), ✏️ düzenle, 📁 taşı, 💬 yorum, 🖼 görsel ekle, 🗑 sil.',
  },
  {
    target: 'reminders-tab',
    title: 'Hatırlatmalar sayfası',
    body: 'Tüm hatırlatmaların burada: gecikmişler, önümüzdeki 6 ay aya göre, tarihsizler. Tekrarlayanlarda ✓ yalnızca o seferi tamamlar.',
  },
  {
    target: 'help',
    title: 'Hepsi bu kadar!',
    body: 'Bu turu istediğin zaman bu düğmeyle yeniden açabilirsin. İyi notlar!',
  },
]

/** Steps whose target is on screen (centered steps always stay). */
export function availableSteps(steps: TourStep[], exists: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => !s.target || exists(s.target))
}

const doneKey = (userId: string) => `notex-tour-done:${userId}`

export function tourDone(userId: string): boolean {
  try {
    return localStorage.getItem(doneKey(userId)) === '1'
  } catch {
    return true // no storage (private mode): don't pop up every time
  }
}

export function markTourDone(userId: string) {
  try {
    localStorage.setItem(doneKey(userId), '1')
  } catch {
    /* private mode */
  }
}
