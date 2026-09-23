import { describe, expect, it } from 'vitest'
import { cleanPath, userPrompt } from './llm'

describe('cleanPath', () => {
  const folders = [['Sağlık', 'Randevu'], ['Eğlence', 'İzlenecekler']]

  it('reuses the exact spelling of existing folders', () => {
    expect(cleanPath(['sağlık', 'randevu'], folders)).toEqual(['Sağlık', 'Randevu'])
    expect(cleanPath(['eğlence', 'filmler'], folders)).toEqual(['Eğlence', 'Filmler'])
  })

  it('capitalizes, trims and drops repeated or bad segments', () => {
    expect(cleanPath(['  kitaplar ', 'Kitaplar'], [])).toEqual(['Kitaplar'])
    expect(cleanPath(['ev/iş', 'ışık'], [])).toEqual(['Ev iş', 'Işık'])
    expect(cleanPath(['', 'x'.repeat(50), 'Notlar'], [])).toEqual(['Notlar'])
    expect(cleanPath('nope', [])).toBeNull()
    expect(cleanPath([], [])).toBeNull()
  })
})

it('userPrompt lists folders and the note', () => {
  expect(userPrompt('Göz doktoru', [['Sağlık', 'Randevu']])).toBe('MEVCUT KLASÖRLER:\n- Sağlık / Randevu\n\nNot: "Göz doktoru"')
  expect(userPrompt('x', [])).toContain('(yok)')
})
