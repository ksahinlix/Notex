// Turns HTML (pasted from a web page, Word, or our own editor) into note
// blocks: text and images in their original order. Ported and cleaned up
// from the prototype (docs/prototype.jsx: domToBlocks, pickImgSrc,
// normalizeMathUnicode).

import type { Block } from './types'

type ImageBlock = Extract<Block, { type: 'image' }>

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'UL', 'OL', 'TABLE'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG', 'HEAD', 'TITLE', 'META', 'LINK'])

/** Best image URL: largest srcset candidate, or the real URL behind lazy-loading placeholders. */
export function pickImgSrc(img: Element): string {
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset')
  if (srcset) {
    const candidates = srcset
      .split(',')
      .map((s) => s.trim().split(/\s+/))
      .filter((p) => p[0])
      .sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0))
    if (candidates.length) return candidates[0][0]
  }
  const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src')
  const src = img.getAttribute('src')
  // A 1x1 placeholder gif or a tiny data URL means the real image is in data-src.
  if (lazy && (!src || src.startsWith('data:image/gif') || (src.startsWith('data:') && src.length < 200))) return lazy
  return src || lazy || ''
}

/** Math-styled letters (𝐀, 𝑎, 𝟏 ...) that some sites use for bold/italic -> plain letters, so search works. */
export function normalizeMathUnicode(s: string): string {
  return s.replace(/[\u{1D400}-\u{1D7FF}]|\u210E/gu, (ch) => {
    const cp = ch.codePointAt(0)!
    if (cp === 0x210e) return 'h'
    const ranges: [number, number, number][] = [
      [0x1d400, 0x1d419, 65], [0x1d41a, 0x1d433, 97], // bold
      [0x1d434, 0x1d44d, 65], [0x1d44e, 0x1d467, 97], // italic
      [0x1d468, 0x1d481, 65], [0x1d482, 0x1d49b, 97], // bold italic
      [0x1d7ce, 0x1d7d7, 48], // bold digits
    ]
    for (const [from, to, base] of ranges) if (cp >= from && cp <= to) return String.fromCharCode(cp - from + base)
    return ch
  })
}

/** Walks a DOM tree and collects text and images in order. */
export function domToBlocks(root: Node, baseUrl?: string): Block[] {
  const blocks: Block[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) blocks.push({ type: 'text', content: buffer })
    buffer = ''
  }
  const newline = () => {
    buffer = buffer.replace(/ +$/, '')
    if (buffer && !buffer.endsWith('\n')) buffer += '\n'
  }
  // Like browsers: runs of whitespace in HTML are one space; only block
  // elements and <br> make new lines (except inside <pre>).
  const walk = (node: Node, pre = false) => {
    if (node.nodeType === 3) {
      let t = node.textContent ?? ''
      if (!pre) {
        t = t.replace(/\s+/g, ' ')
        if (!buffer || buffer.endsWith('\n')) t = t.replace(/^ /, '') // start of a line
      }
      buffer += normalizeMathUnicode(t.replace(/\u00a0/g, ' '))
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (SKIP_TAGS.has(el.tagName)) return
    if (el.tagName === 'IMG') {
      let src = pickImgSrc(el)
      if (src && baseUrl && !/^(data:|https?:)/i.test(src)) {
        try {
          src = new URL(src, baseUrl).href
        } catch {
          /* keep as is */
        }
      }
      if (src) {
        flush()
        const alt = el.getAttribute('alt') || ''
        blocks.push(alt ? { type: 'image', src, alt } : { type: 'image', src })
      }
      return
    }
    if (el.tagName === 'BR') {
      buffer += '\n'
      return
    }
    const isBlock = BLOCK_TAGS.has(el.tagName)
    if (isBlock) newline()
    el.childNodes.forEach((c) => walk(c, pre || el.tagName === 'PRE'))
    if (isBlock) newline()
  }
  root.childNodes.forEach((c) => walk(c))
  flush()
  return tidyBlocks(blocks)
}

/**
 * Merges adjacent text, collapses extra spaces and blank lines, and trims each
 * text block. Images are shown as their own block, so the text around them
 * needs no leading or trailing line breaks.
 */
export function tidyBlocks(blocks: Block[]): Block[] {
  const merged: Block[] = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (b.type === 'text' && last?.type === 'text') last.content += b.content
    else merged.push(b.type === 'text' ? { ...b } : b)
  }
  return merged
    .map((b) => (b.type === 'text' ? { ...b, content: b.content.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() } : b))
    .filter((b) => b.type === 'image' || b.content !== '')
}

export function htmlToBlocks(html: string, baseUrl?: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Word/Chrome put the page URL in the clipboard HTML; use it for relative image links.
  const source = baseUrl ?? doc.querySelector('base')?.getAttribute('href') ?? undefined
  return domToBlocks(doc.body, source)
}

export function blocksToText(blocks: Block[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
    .trim()
}

export const imageBlocks = (blocks: Block[]) => blocks.filter((b): b is ImageBlock => b.type === 'image')
