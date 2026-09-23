import { describe, expect, it } from 'vitest'
import { highlightParts, queryTerms } from './highlight'

describe('highlight', () => {
  it('finds query words case-insensitively, Turkish-aware', () => {
    expect(highlightParts('İstanbul ve IŞIK', queryTerms('istanbul ışık'))).toEqual([
      { text: 'İstanbul', hit: true },
      { text: ' ve ', hit: false },
      { text: 'IŞIK', hit: true },
    ])
  })

  it('prefers the longest match and ignores 1-letter words', () => {
    expect(queryTerms('a film filmler')).toEqual(['filmler', 'film'])
    expect(highlightParts('filmleri izle', queryTerms('film filmler'))).toEqual([
      { text: 'filmler', hit: true },
      { text: 'i izle', hit: false },
    ])
  })

  it('returns the text unchanged when nothing matches', () => {
    expect(highlightParts('merhaba', queryTerms('yok'))).toEqual([{ text: 'merhaba', hit: false }])
    expect(highlightParts('merhaba', [])).toEqual([{ text: 'merhaba', hit: false }])
  })
})
