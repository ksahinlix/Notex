import { describe, expect, it } from 'vitest'
import { fitted, imageFilesFrom, smaller } from './images'

// Note: fileToDataUrl itself needs a real canvas, which jsdom has not got, so
// the encoding is measured in a browser instead (scratchpad e2e16). What is
// testable here is the arithmetic it depends on.

describe('fitted', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitted(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitted(1600, 900)).toEqual({ width: 1600, height: 900, scaled: false })
  })

  it('shrinks by the longest side, keeping the shape', () => {
    expect(fitted(3200, 2400)).toEqual({ width: 1600, height: 1200, scaled: true })
    expect(fitted(2400, 3200)).toEqual({ width: 1200, height: 1600, scaled: true })
  })

  it('rounds to whole pixels', () => {
    const r = fitted(4001, 3000)
    expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true)
    expect(r).toEqual({ width: 1600, height: 1200, scaled: true })
  })

  it('handles a panorama without collapsing the short side to zero', () => {
    expect(fitted(10000, 200)).toEqual({ width: 1600, height: 32, scaled: true })
  })
})

describe('smaller', () => {
  it('keeps the re-encoded one when it saved something', () => {
    expect(smaller('data:image/png;base64,' + 'A'.repeat(5000), 'data:image/webp;base64,AAA')).toMatch(/webp/)
  })

  it('keeps the original when re-encoding made it bigger', () => {
    // A two-colour PNG beats any lossy codec; the point is never to grow.
    const original = 'data:image/png;base64,AAA'
    expect(smaller(original, 'data:image/webp;base64,' + 'A'.repeat(5000))).toBe(original)
  })

  it('keeps the original on a tie, so nothing is re-encoded for nothing', () => {
    const a = 'data:image/png;base64,AAAA'
    expect(smaller(a, 'data:image/webp;base64,AA')).not.toBe(a)
    expect(smaller('data:image/png;base64,AA', 'data:image/webp;base64,AA')).toBe('data:image/png;base64,AA')
  })
})

describe('imageFilesFrom', () => {
  const file = (type: string) => new File(['x'], 'f', { type })

  it('takes images and ignores everything else', () => {
    const list = [file('image/png'), file('application/pdf'), file('image/webp')]
    expect(imageFilesFrom(list as unknown as FileList).map((f) => f.type)).toEqual(['image/png', 'image/webp'])
  })

  it('copes with nothing at all', () => {
    expect(imageFilesFrom(null)).toEqual([])
    expect(imageFilesFrom(undefined)).toEqual([])
  })
})
