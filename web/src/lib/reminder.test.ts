import { describe, expect, it } from 'vitest'
import { parseReminder } from './reminder'

// Wednesday, 23 September 2026, 14:00 local time
const NOW = new Date(2026, 8, 23, 14, 0)

function at(text: string) {
  const r = parseReminder(text, NOW)
  if (!r) return null
  if (!r.date) return 'undated'
  const d = r.date
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

describe('parseReminder', () => {
  it.each([
    ['Yarın 15:00 diş hekimi randevusu', '2026-09-24 15:00'],
    ["yarın saat 10'da toplantı", '2026-09-24 10:00'],
    ['Bugün akşam 7 annemi ara', '2026-09-23 19:00'],
    ["bugün öğleden sonra 3'te kargo gelecek", '2026-09-23 15:00'],
    ['öbür gün sabah 8.30 uçuş', '2026-09-25 08:30'],
    ['Perşembe günü faturayı öde', '2026-09-24 09:00'],
    ["cuma akşam 8'de sinema", '2026-09-25 20:00'],
    ['pazartesiye kadar raporu bitir', '2026-09-28 09:00'],
    ['Çarşamba 11:00 sprint', '2026-09-30 11:00'], // today is Wednesday, 11:00 already passed
    ['çarşamba 16:00 demo', '2026-09-23 16:00'], // still ahead today
    ['haftaya salı dişçi', '2026-10-06 09:00'],
    ["25 Ekim'de KDV beyannamesi", '2026-10-25 09:00'],
    ['3 şubat doğum günü', '2027-02-03 09:00'], // already past this year
    ['12-15 Mayıs Roma oteli', '2027-05-12 09:00'],
    ['30.09 kira', '2026-09-30 09:00'],
    ['1/10/2026 saat 14:30 noter', '2026-10-01 14:30'],
    ['3 gün sonra kombi bakımı', '2026-09-26 09:00'],
    ['2 hafta sonra kontrol', '2026-10-07 09:00'],
    ['1 saat sonra ilacı al', '2026-09-23 15:00'],
    ['yarım saat sonra fırını kapat', '2026-09-23 14:30'],
    ['30 dk sonra toplantıya katıl', '2026-09-23 14:30'],
    ['17:30 spor salonu', '2026-09-23 17:30'],
    ['09:00 günlük standup', '2026-09-24 09:00'], // passed today -> tomorrow
    ['gece 1 yedek al', '2026-09-24 01:00'],
    ['gece 11 dizi', '2026-09-23 23:00'],
    ['öğlen yemeğinde Ali ile buluş', '2026-09-24 12:00'],
  ])('%s -> %s', (text, want) => {
    expect(at(text)).toBe(want)
  })

  it.each([
    ['Faturayı ödemeyi hatırlat', 'undated'],
    ['Annemi aramayı unutma', 'undated'],
    ['Bana ilaçları hatırlatır mısın', 'undated'],
    ['reminder: call the bank', 'undated'],
    ['Yarın 10:00 toplantıyı hatırlat', '2026-09-24 10:00'], // a date wins over the keyword
  ])('reminder word: %s -> %s', (text, want) => {
    expect(at(text)).toBe(want)
  })

  it.each([
    ["Kredi kartı ekstresi her ayın 28'i", 'monthly', '2026-09-28 09:00'],
    ["Kira her ayın 1'inde öde", 'monthly', '2026-10-01 09:00'],
    ["Her ay 15'inde saat 10'da fatura", 'monthly', '2026-10-15 10:00'],
    ["Aidat her ayın 31'i", 'monthly', '2026-10-31 09:00'], // September has no 31st
    ['aylık abonelik ödemesi', 'monthly', '2026-10-23 09:00'],
    ['Her pazartesi 10:00 ekip toplantısı', 'weekly', '2026-09-28 10:00'],
    ['haftalık rapor', 'weekly', '2026-09-30 09:00'],
    ["Her gün 8'de ilaç", 'daily', '2026-09-24 08:00'],
    ['her akşam yürüyüş', 'daily', '2026-09-23 19:00'],
    ['Her yıl 5 Mart doğum günü', 'yearly', '2027-03-05 09:00'],
  ])('repeating: %s -> %s from %s', (text, repeat, first) => {
    expect(parseReminder(text, NOW)?.repeat).toBe(repeat)
    expect(at(text)).toBe(first)
  })

  it('one-time reminders have no repeat', () => {
    expect(parseReminder('Yarın 15:00 diş hekimi', NOW)?.repeat).toBeUndefined()
  })

  it('reports the reminder word as matched', () => {
    expect(parseReminder('Faturayı ödemeyi hatırlat', NOW)).toEqual({ date: null, matched: 'hatırlat' })
  })

  it.each([
    'Süt, yumurta ve ekmek alınacak',
    'Elektrik faturası 450 TL ödendi',
    'Inception filmini izle',
    'Sprint toplantısında deploy konuşuldu',
    'Suç ve Ceza kitabını oku',
    'React 19.2 sürümüne geç',
    'Sabahattin Ali kitapları',
    'Günaydın mesajı',
  ])('no reminder in: %s', (text) => {
    expect(parseReminder(text, NOW)).toBeNull()
  })

  it('reports the matched words', () => {
    expect(parseReminder('Yarın 15:00 diş hekimi', NOW)?.matched).toBe('Yarın 15:00')
    expect(parseReminder('Cuma akşam 8\'de sinema', NOW)?.matched).toBe("Cuma akşam 8'de")
  })
})
