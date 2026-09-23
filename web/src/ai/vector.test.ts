import { describe, expect, it } from 'vitest'
import { dot, noteEmbeddingText, rankNotes, suggestFolders } from './vector'

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs)
  return xs.map((x) => x / n)
}

describe('rankNotes', () => {
  it('keeps notes close to the best match, keyword matches first', () => {
    const q = unit(1, 0)
    const items = [
      { id: 'best', vec: unit(1, 0.05) },
      { id: 'close', vec: unit(1, 0.2) },
      { id: 'far', vec: unit(0.2, 1) },
      { id: 'kw-far', vec: unit(0, 1) },
    ]
    // cos(best)≈1.00, cos(close)≈0.98 (within the window), cos(far)≈0.20 (dropped);
    // kw-far has cos 0 but is a keyword match, so it is kept.
    const r = rankNotes(q, items, new Set(['kw-far']))
    expect(r.map((x) => x.id)).toEqual(['best', 'close', 'kw-far'])
  })

  it('handles no items', () => {
    expect(rankNotes(unit(1, 0), [], new Set())).toEqual([])
  })
})

describe('suggestFolders', () => {
  it('ranks pages by their notes and their name', () => {
    const q = unit(1, 0, 0)
    const notes = [
      { path: ['Kişisel', 'Sağlık'], vec: unit(1, 0.1, 0) },
      { path: ['Kişisel', 'Sağlık'], vec: unit(0.9, 0.3, 0) },
      { path: ['Ev', 'Tamirat'], vec: unit(0, 1, 0) },
      { path: ['İş'], vec: unit(0, 0, 1) },
    ]
    const names = new Map([['Kişisel/Sağlık', unit(1, 0, 0)]])
    const s = suggestFolders(q, notes, names, 2)
    expect(s).toHaveLength(2)
    expect(s[0].path).toEqual(['Kişisel', 'Sağlık'])
    expect(s[0].score).toBeGreaterThan(s[1].score)
  })
})

describe('helpers', () => {
  it('dot of unit vectors is cosine', () => {
    expect(dot(unit(1, 0), unit(1, 0))).toBeCloseTo(1)
    expect(dot(unit(1, 0), unit(0, 1))).toBeCloseTo(0)
  })

  it('embedding text includes the path and is capped', () => {
    expect(noteEmbeddingText(['A', 'B'], 'hi')).toBe('A / B\nhi')
    expect(noteEmbeddingText(['A'], 'x'.repeat(5000)).length).toBe(1500)
  })
})
