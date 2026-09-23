// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blocksToText, htmlToBlocks, normalizeMathUnicode } from './paste'

describe('htmlToBlocks', () => {
  it('keeps text and images in order', () => {
    const html = `<html><body><h1>Başlık</h1><p>İlk paragraf <b>kalın</b> metin.</p>
      <img src="https://site.com/a.jpg" alt="kedi"><p>İkinci paragraf</p>
      <figure><img src="/img/b.png"><figcaption>Alt yazı</figcaption></figure><script>alert(1)</script></body></html>`
    expect(htmlToBlocks(html, 'https://site.com/yazi')).toEqual([
      { type: 'text', content: 'Başlık\nİlk paragraf kalın metin.' },
      { type: 'image', src: 'https://site.com/a.jpg', alt: 'kedi' },
      { type: 'text', content: 'İkinci paragraf' },
      { type: 'image', src: 'https://site.com/img/b.png' },
      { type: 'text', content: 'Alt yazı' },
    ])
  })

  it('prefers the largest srcset image and real lazy-load sources', () => {
    const html = `<img srcset="s.jpg 320w, l.jpg 1280w, m.jpg 640w" src="s.jpg">
      <img src="data:image/gif;base64,R0lGOD" data-src="https://cdn.x/real.jpg">`
    const imgs = htmlToBlocks(html, 'https://x.com/')
    expect(imgs.map((b) => (b.type === 'image' ? b.src : ''))).toEqual(['https://x.com/l.jpg', 'https://cdn.x/real.jpg'])
  })

  it('handles line breaks and extra whitespace', () => {
    const blocks = htmlToBlocks('<div>a<br>b</div><div>   c    d </div><p></p><p></p><p>e</p>')
    expect(blocksToText(blocks)).toBe('a\nb\nc d\ne')
  })

  it('plain text only', () => {
    expect(htmlToBlocks('<p>merhaba</p>')).toEqual([{ type: 'text', content: 'merhaba' }])
  })
})

it('normalizes math-styled letters', () => {
  expect(normalizeMathUnicode('𝐁𝐨𝐥𝐝 𝑖𝑡𝑎𝑙𝑖𝑐 𝟏𝟐')).toBe('Bold italic 12')
})
