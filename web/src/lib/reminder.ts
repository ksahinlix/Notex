// Finds a reminder date/time in Turkish note text, e.g.
//   "Yarın 15:00 diş hekimi"        -> tomorrow 15:00
//   "perşembe akşam 7'de toplantı"  -> next Thursday 19:00
//   "3 gün sonra faturayı öde"      -> in 3 days, 09:00
//   "25 Ekim'de KDV beyannamesi"    -> 25 October, 09:00
//   "yarım saat sonra ara"          -> in 30 minutes
// Rule-based on purpose: it is instant, works without AI, and date math is
// exactly what small language models get wrong.

export interface ParsedReminder {
  date: Date
  /** The recognized parts of the text, e.g. "yarın 15:00". */
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

/** Returns the reminder in the text, or null if it has no date/time. */
export function parseReminder(text: string, now: Date = new Date()): ParsedReminder | null {
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
