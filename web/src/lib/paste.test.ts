// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blocksToText, domToBlocks, htmlToBlocks, normalizeMathUnicode } from './paste'

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

describe('domToBlocks in editor mode (pre)', () => {
  const editor = (html: string) => {
    const el = document.createElement('div')
    el.innerHTML = html
    return domToBlocks(el, undefined, { pre: true })
  }

  it('keeps a newline typed with Shift+Enter instead of turning it into a space', () => {
    // The editor is white-space: pre-wrap, so the break is a real \n in a text node.
    expect(editor('satir1\nsatir2')).toEqual([{ type: 'text', content: 'satir1\nsatir2' }])
  })

  it('still handles the <div> that plain Enter makes', () => {
    expect(editor('satir1<div>satir2</div>')).toEqual([{ type: 'text', content: 'satir1\nsatir2' }])
  })

  it('keeps a blank line between paragraphs', () => {
    expect(editor('bir<div><br></div><div>iki</div>')).toEqual([{ type: 'text', content: 'bir\n\niki' }])
  })

  it('keeps indentation, which pasted HTML would lose', () => {
    expect(editor('madde\n    girintili')).toEqual([{ type: 'text', content: 'madde\n    girintili' }])
    // The same text as pasted HTML is still squeezed.
    const el = document.createElement('div')
    el.innerHTML = 'madde\n    girintili'
    expect(domToBlocks(el)).toEqual([{ type: 'text', content: 'madde girintili' }])
  })

  it('keeps images in their place among the lines', () => {
    expect(editor('bir\niki<img src="data:image/png;base64,AAA">üç')).toEqual([
      { type: 'text', content: 'bir\niki' },
      { type: 'image', src: 'data:image/png;base64,AAA' },
      { type: 'text', content: 'üç' },
    ])
  })

  it('trims the ends but not the middle', () => {
    expect(editor('\n\nbir\n\n\niki\n\n')).toEqual([{ type: 'text', content: 'bir\n\n\niki' }])
  })
})
