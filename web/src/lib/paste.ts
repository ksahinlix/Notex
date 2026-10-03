// Turns HTML (pasted from a web page, Word, or our own editor) into note
// blocks: text and images in their original order, plus the little formatting
// we keep — headings, list items, bold and italic (D27).
//
// A block's `content` is always its plain text. Search, the AI classifier and
// the reminder parser read that, so formatting is only ever extra.

import type { Block, BlockStyle, ListKind, Mark, Span } from './types'

type ImageBlock = Extract<Block, { type: 'image' }>

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'UL', 'OL', 'TABLE'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG', 'HEAD', 'TITLE', 'META', 'LINK'])
const HEADINGS: Record<string, BlockStyle> = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3' }

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
  return s.replace(/[\u{1D400}-\u{1D7FF}]|ℎ/gu, (ch) => {
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

/** Bold/italic from the tag, or from the inline style Google Docs and Word write. */
function markOf(el: Element): Mark | null {
  if (el.tagName === 'B' || el.tagName === 'STRONG') return 'b'
  if (el.tagName === 'I' || el.tagName === 'EM') return 'i'
  const style = (el as HTMLElement).style
  if (style) {
    const weight = style.fontWeight
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) return 'b'
    if (style.fontStyle === 'italic') return 'i'
  }
  return null
}

/** Whether an <li> sits in a numbered list or a bulleted one. */
function listKindOf(el: Element): ListKind {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.tagName === 'OL') return 'number'
    if (p.tagName === 'UL') return 'bullet'
  }
  return 'bullet'
}

/**
 * Trims the ends (so spans and content always agree), drops marks from runs
 * that are only whitespace — a bold space is indistinguishable from a plain
 * one and would make an unformatted block look formatted — and merges runs
 * that end up alike.
 */
function tidySpans(spans: Span[]): Span[] {
  const trimmed = spans.map((s) => ({ ...s }))
  if (trimmed.length) trimmed[0].text = trimmed[0].text.replace(/^\s+/, '')
  if (trimmed.length) trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/\s+$/, '')

  const out: Span[] = []
  for (const s of trimmed) {
    if (!s.text) continue
    const marks = s.text.trim() ? s.marks : undefined
    const last = out[out.length - 1]
    if (last && (last.marks ?? []).join('') === (marks ?? []).join('')) last.text += s.text
    else out.push(marks?.length ? { text: s.text, marks } : { text: s.text })
  }
  return out
}

/**
 * Walks a DOM tree and collects text, images, headings, list items and
 * bold/italic runs, in order.
 *
 * Everything is gathered a line at a time. A heading or a list item becomes
 * its own block; a run of ordinary lines is merged back into one block joined
 * by newlines, which is the shape notes had before formatting existed.
 *
 * `pre` is for our own editor rather than pasted HTML. The editor is
 * `white-space: pre-wrap`, so Shift+Enter puts a real newline inside a text
 * node; collapsing runs of whitespace the way a browser lays out HTML would
 * silently turn that line break back into a space.
 */
export function domToBlocks(root: Node, baseUrl?: string, { pre: preRoot = false } = {}): Block[] {
  const blocks: Block[] = []
  const marks: Mark[] = []
  let spans: Span[] = []
  let style: BlockStyle | undefined
  let list: ListKind | undefined

  const text = () => spans.map((s) => s.text).join('')

  const add = (value: string) => {
    if (!value) return
    const key = marks.join('')
    const last = spans[spans.length - 1]
    if (last && (last.marks ?? []).join('') === key) last.text += value
    else spans.push(marks.length ? { text: value, marks: [...marks] } : { text: value })
  }

  /**
   * The line break a block element implies. Idempotent, so `<div>a</div>`
   * gives one break and not three; `<br>` adds one unconditionally, which is
   * what makes a blank line.
   */
  const newline = () => {
    const t = text()
    if (!t || t.endsWith('\n')) return
    const last = spans[spans.length - 1]
    last.text = last.text.replace(/ +$/, '')
    last.text += '\n'
  }

  /** Ends a block and keeps it if there is anything in it. */
  const flush = () => {
    const squeezed = preRoot ? spans : spans.map((s) => ({ ...s, text: s.text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n') }))
    const tidied = tidySpans(squeezed)
    const content = tidied.map((s) => s.text).join('')
    if (content) {
      const block: Block = { type: 'text', content }
      if (style) block.style = style
      if (list) block.list = list
      if (tidied.some((s) => s.marks?.length)) block.spans = tidied
      blocks.push(block)
    }
    spans = []
  }

  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === 3) {
      let t = normalizeMathUnicode((node.textContent ?? '').replace(/ /g, ' '))
      // In pasted HTML a newline is layout, not a line break; in our own
      // editor it is exactly a line break, so it survives untouched.
      if (!pre) {
        t = t.replace(/\s+/g, ' ')
        const sofar = text()
        if (!sofar || sofar.endsWith('\n')) t = t.replace(/^ /, '') // start of a line
      }
      add(t)
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
      add('\n')
      return
    }

    const mark = markOf(el)
    if (mark) marks.push(mark)

    // A heading or a list item is a block of its own, so whatever was being
    // collected is closed off first and reopened afterwards. Everything else
    // only implies a line break.
    const heading = HEADINGS[el.tagName]
    const own = !!heading || el.tagName === 'LI'
    const isBlock = BLOCK_TAGS.has(el.tagName)
    if (own) flush()
    else if (isBlock) newline()

    const outerStyle = style
    const outerList = list
    if (heading) style = heading
    if (el.tagName === 'LI') list = listKindOf(el)

    el.childNodes.forEach((c) => walk(c, pre || el.tagName === 'PRE'))

    if (own) flush()
    else if (isBlock) newline()
    style = outerStyle
    list = outerList
    if (mark) marks.pop()
  }

  root.childNodes.forEach((c) => walk(c, preRoot))
  flush()
  return tidyBlocks(blocks, preRoot)
}

/**
 * Merges runs of ordinary lines back into single blocks, so a plain note keeps
 * the one-block-many-lines shape it has always had. Headings, list items and
 * anything carrying marks stay on their own.
 */
export function tidyBlocks(blocks: Block[], pre = false): Block[] {
  const isPlain = (b: Block | undefined): b is Extract<Block, { type: 'text' }> =>
    !!b && b.type === 'text' && !b.style && !b.list && !b.spans
  const out: Block[] = []
  for (const b of blocks) {
    const last = out[out.length - 1]
    if (isPlain(b) && isPlain(last)) last.content += '\n' + b.content
    else out.push(b.type === 'text' ? { ...b } : b)
  }
  // Stacks of blank lines are noise in pasted HTML; what someone typed is left alone.
  return pre ? out : out.map((b) => (b.type === 'text' ? { ...b, content: b.content.replace(/\n{3,}/g, '\n\n') } : b))
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
