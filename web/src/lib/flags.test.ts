import { describe, expect, it } from 'vitest'
import { FLAGS, flagCounts, flagInfo, flagsOf, hasFlag, toggleFlag } from './flags'

const note = (flags?: string[]) => ({ flags })

describe('the set itself', () => {
  it('is the four the server accepts, and has no "Bitti"', () => {
    expect(FLAGS.map((f) => f.id)).toEqual(['onemli', 'acil', 'beklemede', 'fikir'])
    // "Done" would mean two things at once beside a to-do folder's tick (D22).
    expect(FLAGS.some((f) => f.label.toLowerCase().includes('bitti'))).toBe(false)
  })

  it('knows a flag by id and shrugs at anything else', () => {
    expect(flagInfo('onemli')?.label).toBe('Önemli')
    expect(flagInfo('kendi-etiketim')).toBeUndefined()
  })
})

describe('flagsOf', () => {
  it('lists them in the set order, not the order they were added', () => {
    expect(flagsOf(note(['fikir', 'onemli'])).map((f) => f.id)).toEqual(['onemli', 'fikir'])
  })

  it('ignores anything it does not recognise, so an old note cannot break the card', () => {
    expect(flagsOf(note(['onemli', 'bitti'])).map((f) => f.id)).toEqual(['onemli'])
  })

  it('copes with a note that has no flags at all', () => {
    expect(flagsOf(note())).toEqual([])
    expect(flagsOf(note([]))).toEqual([])
  })
})

describe('toggleFlag', () => {
  it('switches one on and off', () => {
    expect(toggleFlag(note([]), 'acil')).toEqual(['acil'])
    expect(toggleFlag(note(['acil']), 'acil')).toEqual([])
  })

  it('keeps the others and the listed order', () => {
    expect(toggleFlag(note(['fikir']), 'onemli')).toEqual(['onemli', 'fikir'])
    expect(toggleFlag(note(['onemli', 'fikir']), 'fikir')).toEqual(['onemli'])
  })

  it('drops an unknown flag rather than carrying it along', () => {
    expect(toggleFlag(note(['bitti']), 'onemli')).toEqual(['onemli'])
  })
})

describe('hasFlag and flagCounts', () => {
  it('answers for one note', () => {
    expect(hasFlag(note(['onemli']), 'onemli')).toBe(true)
    expect(hasFlag(note(['onemli']), 'acil')).toBe(false)
    expect(hasFlag(note(), 'acil')).toBe(false)
  })

  it('counts across notes, one note counting for each flag it carries', () => {
    expect(flagCounts([note(['onemli', 'acil']), note(['onemli']), note(), note(['bitti'])])).toEqual({
      onemli: 2, acil: 1, beklemede: 0, fikir: 0,
    })
  })
})
