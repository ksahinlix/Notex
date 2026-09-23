// Splits text into plain and highlighted parts for the words of a search
// query (Turkish-aware, case-insensitive): "İstanbul" matches "istanbul".

export interface Part {
  text: string
  hit: boolean
}

/** Words of the query worth highlighting (at least 2 letters). */
export function queryTerms(query: string): string[] {
  const words = query.toLocaleLowerCase('tr').split(/\s+/).filter((w) => w.length >= 2)
  return [...new Set(words)].sort((a, b) => b.length - a.length) // longest first
}

export function highlightParts(text: string, terms: string[]): Part[] {
  if (!terms.length || !text) return [{ text, hit: false }]
  const lower = text.toLocaleLowerCase('tr')
  // Turkish lower-casing keeps the length for Turkish text; if some other
  // script changes it, don't risk wrong offsets.
  if (lower.length !== text.length) return [{ text, hit: false }]
  const parts: Part[] = []
  let i = 0
  let plainStart = 0
  while (i < text.length) {
    const term = terms.find((t) => lower.startsWith(t, i))
    if (term) {
      if (i > plainStart) parts.push({ text: text.slice(plainStart, i), hit: false })
      parts.push({ text: text.slice(i, i + term.length), hit: true })
      i += term.length
      plainStart = i
    } else i++
  }
  if (plainStart < text.length) parts.push({ text: text.slice(plainStart), hit: false })
  return parts
}
