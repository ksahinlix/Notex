import { describe, expect, it } from 'vitest'
import { createProtectedFolder } from './crypto'
import { buildBlocks, matchesQuery, newNote, open, seal, withImages, withText } from './notes'

describe('seal / open', () => {
  it('keeps plain notes readable', async () => {
    const n = await seal(newNote(['A']), { text: 'hi' }, null)
    expect(n.encrypted).toBe(false)
    expect(n.cipher).toBeNull()
    expect(await open(n, null)).toEqual({ text: 'hi' })
  })

  it('puts every field of an encrypted note inside the cipher', async () => {
    const { key } = await createProtectedFolder('A', 'pw')
    const content = {
      text: 'secret', reminderLabel: 'dentist', listItemText: 'x',
      blocks: buildBlocks('secret', ['data:image/png;base64,AAAA']),
      comments: [{ id: 'c', text: 'note', createdAt: '2026-01-01T00:00:00Z' }],
    }
    const n = await seal(newNote(['A']), content, key)
    expect(n.encrypted).toBe(true)
    expect(n.content).toBeNull()
    for (const word of ['secret', 'dentist', 'AAAA', 'note']) expect(JSON.stringify(n)).not.toContain(word)
    expect(await open(n, key)).toEqual(content)
    await expect(open(n, null)).rejects.toThrow()
  })

  it('moving from encrypted to plain keeps images (prototype bug)', async () => {
    const { key } = await createProtectedFolder('A', 'pw')
    const content = withImages({ text: 't' }, ['data:image/png;base64,BBBB'])
    const enc = await seal(newNote(['A']), content, key)
    const plain = await seal({ ...enc, path: ['B'] }, await open(enc, key), null)
    expect(plain.content?.blocks).toEqual(content.blocks)
  })
})

describe('content helpers', () => {
  it('edits text without losing images', () => {
    const c = withImages({ text: 'old' }, ['img1'])
    expect(withText(c, 'new').blocks).toEqual([{ type: 'text', content: 'new' }, { type: 'image', src: 'img1' }])
  })

  it('searches text, comments and path, Turkish-aware', () => {
    const n = newNote(['İş', 'Proje'])
    const c = { text: 'Toplantı notları', comments: [{ id: '1', text: 'ertelendi', createdAt: '' }] }
    expect(matchesQuery(n, c, 'TOPLANTI')).toBe(true)
    expect(matchesQuery(n, c, 'ertelendi')).toBe(true)
    expect(matchesQuery(n, c, 'iş')).toBe(true)
    expect(matchesQuery(n, c, 'yok')).toBe(false)
    expect(matchesQuery(n, undefined, 'proje')).toBe(true)
  })
})

describe('withImages keeps formatting (D27)', () => {
  const formatted = {
    text: 'Başlık\nmadde',
    blocks: [
      { type: 'text' as const, content: 'Başlık', style: 'h2' as const },
      { type: 'text' as const, content: 'madde', list: 'bullet' as const },
    ],
  }

  it('leaves the headings and lists alone and puts the image after them', () => {
    expect(withImages(formatted, ['data:image/png;base64,A']).blocks).toEqual([
      { type: 'text', content: 'Başlık', style: 'h2' },
      { type: 'text', content: 'madde', list: 'bullet' },
      { type: 'image', src: 'data:image/png;base64,A' },
    ])
  })

  it('keeps the images already there, in order', () => {
    const withOne = withImages(formatted, ['a'])
    expect(withImages(withOne, ['b']).blocks?.filter((b) => b.type === 'image')).toEqual([
      { type: 'image', src: 'a' },
      { type: 'image', src: 'b' },
    ])
  })

  it('still works on a note that never had blocks', () => {
    expect(withImages({ text: 'düz not' }, ['a']).blocks).toEqual([
      { type: 'text', content: 'düz not' },
      { type: 'image', src: 'a' },
    ])
  })
})
