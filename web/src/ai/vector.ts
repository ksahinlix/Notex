// Pure ranking logic for on-device AI (D3). Vectors are L2-normalized, so the
// dot product is the cosine similarity.
//
// Calibrated for multilingual-e5-small (see web/scripts/eval-ai.mjs): its
// similarities are compressed (roughly 0.78–0.89), so we rank relative to the
// best match instead of using an absolute threshold.

export type Vec = Float32Array | number[]

export function dot(a: Vec, b: Vec): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Search results within this distance of the best match are kept. */
export const SEARCH_WINDOW = 0.035
export const SEARCH_LIMIT = 12
/** Exact keyword matches get this bonus so they stay on top. */
export const KEYWORD_BONUS = 0.1

export interface Ranked {
  id: string
  score: number
}

/**
 * Ranks notes for a search. Keyword matches are always included (first);
 * other notes only if they are close to the best semantic match.
 */
export function rankNotes(query: Vec, items: { id: string; vec: Vec }[], keywordIds: Set<string>): Ranked[] {
  const scored = items.map(({ id, vec }) => ({ id, sim: dot(query, vec), kw: keywordIds.has(id) }))
  const bestSim = Math.max(-Infinity, ...scored.map((s) => s.sim))
  return scored
    .filter((s) => s.kw || s.sim >= bestSim - SEARCH_WINDOW)
    .map((s) => ({ id: s.id, score: s.sim + (s.kw ? KEYWORD_BONUS : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(SEARCH_LIMIT, keywordIds.size))
}

export interface FolderSuggestion {
  path: string[]
  score: number
}

/**
 * Suggests existing pages (note paths) for a new note: 60% how similar the
 * page's closest two notes are, 40% how similar the page name itself is.
 */
export function suggestFolders(
  query: Vec,
  notes: { path: string[]; vec: Vec }[],
  nameVecs: Map<string, Vec>,
  k = 3,
): FolderSuggestion[] {
  const byPage = new Map<string, { path: string[]; sims: number[] }>()
  for (const n of notes) {
    const key = n.path.join('/')
    const page = byPage.get(key) ?? { path: n.path, sims: [] }
    page.sims.push(dot(query, n.vec))
    byPage.set(key, page)
  }
  const out: FolderSuggestion[] = []
  for (const [key, { path, sims }] of byPage) {
    const top = sims.sort((a, b) => b - a).slice(0, 2)
    const noteScore = top.reduce((a, b) => a + b, 0) / top.length
    const nameVec = nameVecs.get(key)
    out.push({ path, score: nameVec ? 0.6 * noteScore + 0.4 * dot(query, nameVec) : noteScore })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k)
}

/** Text used to embed a note: its path gives useful context (tested: better folder accuracy). */
export function noteEmbeddingText(path: string[], text: string): string {
  return `${path.join(' / ')}\n${text}`.slice(0, 1500)
}
