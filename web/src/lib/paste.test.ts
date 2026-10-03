// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blocksToText, domToBlocks, htmlToBlocks, normalizeMathUnicode } from './paste'

describe('htmlToBlocks', () => {
  it('keeps text and images in order', () => {
    const html = `<html><body><h1>Başlık</h1><p>İlk paragraf <b>kalın</b> metin.</p>
      <img src="https://site.com/a.jpg" alt="kedi"><p>İkinci paragraf</p>
      <figure><img src="/img/b.png"><figcaption>Alt yazı</figcaption></figure><script>alert(1)</script></body></html>`
    expect(htmlToBlocks(html, 'https://site.com/yazi')).toEqual([
      { type: 'text', content: 'Başlık', style: 'h1' },
      {
        type: 'text',
        content: 'İlk paragraf kalın metin.',
        spans: [{ text: 'İlk paragraf ' }, { text: 'kalın', marks: ['b'] }, { text: ' metin.' }],
      },
      { type: 'image', src: 'https://site.com/a.jpg', alt: 'kedi' },
      { type: 'text', content: 'İkinci paragraf' },
      { type: 'image', src: 'https://site.com/img/b.png' },
      { type: 'text', content: 'Alt yazı' },
    ])
  })

  it('a block content is always its plain text, whatever the formatting', () => {
    // Search, the AI classifier and the reminder parser only read `content`.
    const blocks = htmlToBlocks('<h2>Başlık</h2><ul><li>bir <b>kalın</b></li><li>iki</li></ul>')
    expect(blocksToText(blocks)).toBe('Başlık\nbir kalın\niki')
    for (const b of blocks) if (b.type === 'text' && b.spans) expect(b.spans.map((s) => s.text).join('')).toBe(b.content)
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

describe('formatting kept on paste (D27)', () => {
  it('turns each heading level into a block of its own', () => {
    expect(htmlToBlocks('<h1>Bir</h1><h2>İki</h2><h3>Üç</h3><h5>Beş</h5>')).toEqual([
      { type: 'text', content: 'Bir', style: 'h1' },
      { type: 'text', content: 'İki', style: 'h2' },
      { type: 'text', content: 'Üç', style: 'h3' },
      // Deeper headings all land on the smallest size rather than inventing more.
      { type: 'text', content: 'Beş', style: 'h3' },
    ])
  })

  it('keeps bullet and numbered items apart, one block each', () => {
    expect(htmlToBlocks('<ul><li>süt</li><li>ekmek</li></ul><ol><li>önce</li><li>sonra</li></ol>')).toEqual([
      { type: 'text', content: 'süt', list: 'bullet' },
      { type: 'text', content: 'ekmek', list: 'bullet' },
      { type: 'text', content: 'önce', list: 'number' },
      { type: 'text', content: 'sonra', list: 'number' },
    ])
  })

  it('takes the kind from the nearest list, so a nested one keeps its own', () => {
    const blocks = htmlToBlocks('<ul><li>dış<ol><li>iç</li></ol></li></ul>')
    expect(blocks.map((b) => (b.type === 'text' ? [b.content, b.list] : []))).toEqual([
      ['dış', 'bullet'],
      ['iç', 'number'],
    ])
  })

  it('records bold and italic as runs, and the plain text beside them', () => {
    expect(htmlToBlocks('<p>bu <b>kalın</b> ve <i>eğik</i></p>')).toEqual([
      {
        type: 'text',
        content: 'bu kalın ve eğik',
        spans: [{ text: 'bu ' }, { text: 'kalın', marks: ['b'] }, { text: ' ve ' }, { text: 'eğik', marks: ['i'] }],
      },
    ])
  })

  it('handles both at once, and <strong>/<em> the same as <b>/<i>', () => {
    const [block] = htmlToBlocks('<p><strong><em>ikisi</em></strong></p>')
    expect(block).toEqual({ type: 'text', content: 'ikisi', spans: [{ text: 'ikisi', marks: ['b', 'i'] }] })
  })

  it('reads the inline styles Google Docs and Word write instead of tags', () => {
    expect(htmlToBlocks('<p><span style="font-weight:700">kalın</span> <span style="font-style:italic">eğik</span></p>')).toEqual([
      {
        type: 'text',
        content: 'kalın eğik',
        spans: [{ text: 'kalın', marks: ['b'] }, { text: ' ' }, { text: 'eğik', marks: ['i'] }],
      },
    ])
  })

  it('leaves plain text exactly as it was before any of this', () => {
    // The shape notes have always had: one block, many lines.
    expect(htmlToBlocks('<div>a<br>b</div><div>c</div>')).toEqual([{ type: 'text', content: 'a\nb\nc' }])
  })

  it('does not mark a run that is only whitespace', () => {
    const [block] = htmlToBlocks('<p>bir<b> </b>iki</p>')
    expect(block).toEqual({ type: 'text', content: 'bir iki' })
  })

  it('keeps an image between a heading and a list', () => {
    expect(htmlToBlocks('<h2>Başlık</h2><img src="data:image/png;base64,A"><ul><li>madde</li></ul>')).toEqual([
      { type: 'text', content: 'Başlık', style: 'h2' },
      { type: 'image', src: 'data:image/png;base64,A' },
      { type: 'text', content: 'madde', list: 'bullet' },
    ])
  })
})
