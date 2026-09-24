// Finds a reminder date/time in Turkish note text, e.g.
//   "Yarın 15:00 diş hekimi"        -> tomorrow 15:00
//   "perşembe akşam 7'de toplantı"  -> next Thursday 19:00
//   "3 gün sonra faturayı öde"      -> in 3 days, 09:00
//   "25 Ekim'de KDV beyannamesi"    -> 25 October, 09:00
//   "yarım saat sonra ara"          -> in 30 minutes
// Rule-based on purpose: it is instant, works without AI, and date math is
// exactly what small language models get wrong.

import type { Repeat } from './recurrence'

export interface ParsedReminder {
  /** Set for repeating reminders ("her ayın 28'i"); date is then the next occurrence. */
  repeat?: Repeat
  /** null: a reminder without a date ("... hatırlat", "unutma"). */
  date: Date | null
  /** The recognized parts of the text, e.g. "yarın 15:00" or "hatırlat". */
  matched: string
}

const DEFAULT_HOUR = 9
const MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık']
// JS getDay(): 0 = Sunday
const WEEKDAYS: Record<string, number> = { pazar: 0, pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6 }
const NUMBER_WORDS: Record<string, number> = { bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, yarım: 0.5 }

// JS's \b only understands ASCII letters, so it breaks on "ş", "ö", "ı" ...
// These Unicode-aware boundaries are used instead.
const B = '(?<![\\p{L}\\d])'
const E = '(?![\\p{L}\\d])'
/** Optional Turkish suffix: 10'da, Ekim'de, perşembeye, yarından ... */
const SUF = "(?:'?\\p{L}*)"
const re = (src: string) => new RegExp(src, 'u')

interface Hit {
  index: number
  text: string
}
type Match = RegExpExecArray & Hit

function find(r: RegExp, s: string): Match | null {
  const m = r.exec(s)
  return m ? Object.assign(m, { text: m[0] }) : null
}

const PART = '(sabah|öğlen|öğle|öğleden sonra|akşam|gece)'

/** Hour/minute from the text, with day-part words ("akşam 7" -> 19:00). */
function parseTime(s: string): { h: number; m: number; hit: Hit } | null {
  const HH = '([01]?\\d|2[0-3])'
  // "15:00", "15.30", "akşam 7:30", "saat 15:00'te"
  let m = find(re(`${B}(?:${PART}\\s+)?(?:saat\\s+)?${HH}[:.]([0-5]\\d)${E}${SUF}`), s)
  if (m) return adjust(Number(m[2]), Number(m[3]), m[1], m)
  // "10'da", "saat 3'te", "akşam 7'de"
  m = find(re(`${B}(?:${PART}\\s+)?(?:saat\\s+)?${HH}'(?:de|da|te|ta)${E}`), s)
  if (m) return adjust(Number(m[2]), 0, m[1], m)
  // "akşam 7", "sabah saat 9"
  m = find(re(`${B}${PART}\\s+(?:saat\\s+)?${HH}${E}`), s)
  if (m) return adjust(Number(m[2]), 0, m[1], m)
  // "saat 3"
  m = find(re(`${B}saat\\s+${HH}${E}`), s)
  if (m) return adjust(Number(m[1]), 0, undefined, m)
  // a bare day part: "öğlen", "akşam", "sabah"
  m = find(re(`${B}(öğlen|öğle|akşam|sabah)${E}`), s)
  if (m) return { h: m[1] === 'akşam' ? 19 : m[1] === 'sabah' ? 9 : 12, m: 0, hit: m }
  return null
}

function adjust(h: number, min: number, part: string | undefined, hit: Hit) {
  const pm = part === 'öğleden sonra' || part === 'akşam' || (part === 'gece' && h >= 5)
  if (pm && h < 12) h += 12
  return { h, m: min, hit }
}

function atTime(d: Date, h: number, m: number) {
  const out = new Date(d)
  out.setHours(h, m, 0, 0)
  return out
}

function addDays(d: Date, n: number) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Day of month + month (+ year) in the future: this year, or next year if already past. */
function futureDate(now: Date, day: number, month: number, year?: number) {
  let d = new Date(year ?? now.getFullYear(), month, day)
  if (year === undefined && d < atTime(now, 0, 0)) d = new Date(now.getFullYear() + 1, month, day)
  return d
}

/**
 * A day of the month written without a month name ("ayın 26'sında"): this
 * month if that day is still ahead, otherwise the next month that has it
 * (so "31'inde" skips the short months).
 */
function monthDay(now: Date, day: number, nextMonth: boolean): Date | null {
  const today = atTime(now, 0, 0)
  for (let i = nextMonth ? 1 : 0; i < 14; i++) {
    const y = now.getFullYear() + Math.floor((now.getMonth() + i) / 12)
    const m = (now.getMonth() + i) % 12
    if (day > new Date(y, m + 1, 0).getDate()) continue
    const d = new Date(y, m, day)
    if (d >= today) return d
  }
  return null
}

/** Returns the reminder in the text, or null if it has no date/time. */
// Words that ask for a reminder even without a date: hatırlat(ma), anımsat,
// unutma(yayım), remind(er).
const KEYWORD = re(`${B}(hatırlat\\p{L}*|anımsat\\p{L}*|unutma\\p{L}*|remind\\p{L}*)${E}`)

/**
 * Returns the reminder in the text: a date/time if one is written, otherwise
 * an undated reminder if the text asks for one ("hatırlat"), otherwise null.
 */
export function parseReminder(text: string, now: Date = new Date()): ParsedReminder | null {
  const repeating = parseRepeat(text, now)
  if (repeating) return repeating
  const dated = parseDate(text, now)
  if (dated) return dated
  const k = find(KEYWORD, text.toLocaleLowerCase('tr'))
  return k ? { date: null, matched: text.slice(k.index, k.index + k.text.length) } : null
}

// "her ayın 28'i", "her ay 15'inde", "aylık"; "her pazartesi", "her hafta",
// "haftalık"; "her gün", "her sabah", "günlük"; "her yıl 5 Mart", "yıllık".
const REPEAT_WORD = re(
  `${B}(?:her\\s+(ayın|ay|hafta|gün|sabah|akşam|gece|yıl|sene|pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)\\p{L}*|(aylık|haftalık|günlük|yıllık))${E}`,
)
// 30/31 first, and no digit may follow: otherwise "31'i" would match as "3".
const MONTH_DAY = re(`${B}her\\s+ay(?:ın)?\\s+(3[01]|[0-2]?\\d)(?!\\d)(?:'\\p{L}*|\\.)?(?:\\s+günü?\\p{L}*)?`)

/** A repeating reminder: its rule and next occurrence, or null. */
function parseRepeat(text: string, now: Date): ParsedReminder | null {
  const s = text.toLocaleLowerCase('tr')
  const w = find(REPEAT_WORD, s)
  if (!w) return null
  const word = w[1] ?? w[2]
  const t = parseTime(s)
  const hits: Hit[] = [w]
  if (t) hits.push(t.hit)
  const at = (d: Date) => atTime(d, t?.h ?? DEFAULT_HOUR, t?.m ?? 0)

  if (word === 'ayın' || word === 'ay' || word === 'aylık') {
    const dm = find(MONTH_DAY, s) // "28'i", "15'inde", "3."
    if (dm) hits.push(dm)
    const day = dm ? Number(dm[1]) : now.getDate()
    // First date: the next month that really has this day, so "her ayın 31'i"
    // keeps the 31st (shorter months then use their last day, see recurrence.ts).
    for (let i = 0; i < 14; i++) {
      const y = now.getFullYear() + Math.floor((now.getMonth() + i) / 12)
      const m = (now.getMonth() + i) % 12
      if (day > new Date(y, m + 1, 0).getDate()) continue
      const date = at(new Date(y, m, day))
      if (date > now) return { date, repeat: 'monthly', matched: joinHits(text, hits) }
    }
    return null
  }
  if (word === 'yıl' || word === 'sene' || word === 'yıllık') {
    const d = parseDate(text, now) // "5 mart" -> next 5 March
    let date = d?.date ?? at(now)
    if (!d && date <= now) date = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate(), date.getHours(), date.getMinutes())
    return { date, repeat: 'yearly', matched: d ? d.matched : joinHits(text, hits) }
  }
  if (word === 'hafta' || word === 'haftalık' || WEEKDAYS[word] !== undefined) {
    const d = parseDate(text, now) // a weekday in the text -> its next date
    let date = d?.date ?? at(now)
    if (!d && date <= now) date = addDays(date, 7)
    return { date, repeat: 'weekly', matched: d ? d.matched : joinHits(text, hits) }
  }
  // her gün / sabah / akşam / gece, günlük
  const hour = word === 'akşam' ? 19 : word === 'gece' ? 22 : DEFAULT_HOUR
  let date = t ? atTime(now, t.h, t.m) : atTime(now, hour, 0)
  if (date <= now) date = addDays(date, 1)
  return { date, repeat: 'daily', matched: joinHits(text, hits) }
}

// "(bu|gelecek|önümüzdeki) ayın 26'sında", "ayın 3 günü". A suffix is
// required, so "bu ay 3 kitap okudum" is not a date.
const MONTH_DAY_NAMED = re(`${B}(?:(bu|gelecek|önümüzdeki|şu)\\s+)?ay(?:ın)?\\s+(3[01]|[0-2]?\\d)(?!\\d)(?:'\\p{L}+|\\.|\\s+günü\\p{L}*)`)
// The same with "ayın" left out: "26'sında", "3'ünde". The possessive + "de"
// ("its 26th") is what marks a date; "saat 3'te" and "sayfa 26'da" don't match.
const MONTH_DAY_ALONE = re(`${B}(3[01]|[0-2]?\\d)(?!\\d)'s?[ıiuü]n[dt][ae]${E}`)

function parseDate(text: string, now: Date): { date: Date; matched: string } | null {
  const s = text.toLocaleLowerCase('tr')
  const hits: Hit[] = []
  const t = parseTime(s)

  // 1) relative: "3 gün sonra", "2 hafta sonra", "1 saat sonra", "yarım saat sonra", "30 dk sonra"
  const rel = find(re(`${B}(\\d+|bir|iki|üç|dört|beş|yarım)\\s+(dakika|dk|saat|gün|hafta|ay)\\s+sonra${E}`), s)
  if (rel) {
    const n = NUMBER_WORDS[rel[1]] ?? Number(rel[1])
    const unit = rel[2]
    if (unit === 'dakika' || unit === 'dk' || unit === 'saat') {
      const d = new Date(now.getTime() + n * (unit === 'saat' ? 60 : 1) * 60_000)
      d.setSeconds(0, 0)
      return { date: d, matched: text.slice(rel.index, rel.index + rel.text.length) }
    }
    const target = unit === 'ay' ? new Date(now.getFullYear(), now.getMonth() + n, now.getDate()) : addDays(now, unit === 'gün' ? n : n * 7)
    hits.push(rel)
    if (t) hits.push(t.hit)
    return { date: atTime(target, t?.h ?? DEFAULT_HOUR, t?.m ?? 0), matched: joinHits(text, hits) }
  }

  // 2) the day
  let day: Date | null = null
  const rd = find(re(`${B}(bugün|yarın|öbür gün|ertesi gün|haftaya|gelecek hafta)${SUF}`), s)
  const nextWeek = !!rd && (rd[1] === 'haftaya' || rd[1] === 'gelecek hafta')
  if (rd) {
    hits.push(rd)
    day = rd[1] === 'bugün' ? now : rd[1] === 'yarın' ? addDays(now, 1) : nextWeek ? addDays(now, 7) : addDays(now, 2)
  }
  const wd = find(re(`${B}(pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)${SUF}(?:\\s+günü?\\p{L}*)?`), s)
  if (wd) {
    hits.push(wd)
    let diff = (WEEKDAYS[wd[1]] - now.getDay() + 7) % 7
    if (nextWeek) diff += 7
    day = addDays(now, diff)
  }
  const md = find(re(`${B}([0-2]?\\d|3[01])(?:\\s*-\\s*\\d{1,2})?\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?${SUF}`), s)
  if (md) {
    hits.push(md)
    day = futureDate(now, Number(md[1]), MONTHS.indexOf(md[2]), md[3] ? Number(md[3]) : undefined)
  } else {
    // "25.10", "25/10/2026". A one-digit month needs a year, so "React 19.2" is
    // not a date; and no minutes may follow ("15.30" is a time).
    const nd = find(re(`${B}([0-2]?\\d|3[01])[./](0[1-9]|1[0-2]|[1-9](?=[./]\\d{4}))(?:[./](\\d{4}))?${E}(?![:.]\\d)`), s)
    if (nd && !(t && t.hit.index === nd.index)) {
      hits.push(nd)
      day = futureDate(now, Number(nd[1]), Number(nd[2]) - 1, nd[3] ? Number(nd[3]) : undefined)
    } else {
      // A day without a month name: "ayın 26'sında", "gelecek ayın 3'ünde",
      // or the month left out entirely, "26'sında sinemaya gideceğiz".
      const am = find(MONTH_DAY_NAMED, s)
      const bare = am ? null : find(MONTH_DAY_ALONE, s)
      const dm = am ?? bare
      if (dm) {
        const d = monthDay(now, Number(am ? am[2] : dm[1]), am ? am[1] === 'gelecek' || am[1] === 'önümüzdeki' : false)
        if (d) {
          hits.push(dm)
          day = d
        }
      }
    }
  }
  if (t) hits.push(t.hit)
  if (!day && !t) return null

  let date: Date
  if (day) {
    date = atTime(day, t?.h ?? DEFAULT_HOUR, t?.m ?? 0)
    // "perşembe" written on a Thursday after that time means next week
    if (wd && !rd && date <= now) date = addDays(date, 7)
  } else {
    // only a time: today if still ahead, otherwise tomorrow
    date = atTime(now, t!.h, t!.m)
    if (date <= now) date = addDays(date, 1)
  }
  return { date, matched: joinHits(text, hits) }
}

function joinHits(text: string, hits: Hit[]) {
  return [...hits]
    .sort((a, b) => a.index - b.index)
    .filter((h, i, arr) => i === 0 || h.index >= arr[i - 1].index + arr[i - 1].text.length)
    .map((h) => text.slice(h.index, h.index + h.text.length).trim())
    .join(' ')
}
