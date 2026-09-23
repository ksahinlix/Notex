import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { fileToDataUrl, imageFilesFrom, resolveImageSrc } from '../lib/images'
import { blocksToText, domToBlocks, htmlToBlocks, normalizeMathUnicode } from '../lib/paste'
import type { Block } from '../lib/types'

export interface RichEditorHandle {
  getBlocks(): Block[]
  getText(): string
  clear(): void
  focus(): void
  /** Inserts picked image files at the cursor (or at the end). */
  insertFiles(files: File[]): void
}

interface Props {
  initialBlocks?: Block[]
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** Called on every change with the plain text and whether the editor is empty. */
  onChange?: (text: string, empty: boolean) => void
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void
  /** True while pasted images are still loading (saving should wait). */
  onBusyChange?: (busy: boolean) => void
}

// Tiny grey box shown while a pasted image downloads.
const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="6" fill="#e4e4e7"/></svg>')
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Text + inline images editor (contentEditable). Replaces the plain textarea
 * so that content pasted from web pages keeps its images in place.
 * Only plain text and <img> survive: formatting is dropped on purpose.
 */
const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialBlocks, placeholder, className, autoFocus, onChange, onSubmit, onBusyChange },
  ref,
) {
  const el = useRef<HTMLDivElement>(null)
  const pending = useRef(0)
  const nextId = useRef(0)

  // Fill the editor once with the initial content (editing an existing note).
  useEffect(() => {
    const root = el.current!
    root.replaceChildren()
    for (const b of initialBlocks ?? []) {
      if (b.type === 'image') root.appendChild(makeImg(b.src))
      else
        b.content.split('\n').forEach((line, i, lines) => {
          root.appendChild(document.createTextNode(line))
          if (i < lines.length - 1) root.appendChild(document.createElement('br'))
        })
    }
    if (autoFocus) focusEnd(root)
    changed()
    // Only on mount: later changes are made by the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function changed() {
    const root = el.current
    if (!root) return
    const text = root.innerText.trim()
    root.classList.toggle('empty', !text && !root.querySelector('img'))
    onChange?.(text, !text && !root.querySelector('img:not([data-pending])'))
  }

  const setBusy = (delta: number) => {
    pending.current += delta
    onBusyChange?.(pending.current > 0)
  }

  useImperativeHandle(ref, () => ({
    getBlocks: () => (el.current ? domToBlocks(el.current).filter((b) => b.type === 'text' || b.src !== PLACEHOLDER) : []),
    getText: () => (el.current ? blocksToText(domToBlocks(el.current)) : ''),
    clear: () => {
      el.current?.replaceChildren()
      changed()
    },
    focus: () => el.current && focusEnd(el.current),
    insertFiles: (files) => {
      const root = el.current
      if (!root || !files.length) return
      if (!root.contains(window.getSelection()?.anchorNode ?? null)) focusEnd(root)
      void insertFiles(files)
    },
  }))

  /** Inserts blocks at the cursor; web images get a placeholder that is replaced once loaded. */
  function insertBlocks(blocks: Block[]) {
    const ids: [string, string][] = []
    const html = blocks
      .map((b) => {
        if (b.type === 'text') return escapeHtml(normalizeMathUnicode(b.content)).replace(/\n/g, '<br>')
        const id = `p${nextId.current++}`
        ids.push([id, b.src])
        return `<img data-pending="${id}" class="ed-img" src="${PLACEHOLDER}" alt="">`
      })
      .join('') // images are block-level, so no extra line breaks around them
    document.execCommand('insertHTML', false, html)
    changed()
    for (const [id, src] of ids) {
      setBusy(1)
      void resolveImageSrc(src).then((url) => {
        const img = el.current?.querySelector<HTMLImageElement>(`img[data-pending="${id}"]`)
        if (img) {
          if (url) {
            img.src = url
            img.removeAttribute('data-pending')
          } else {
            img.replaceWith(document.createTextNode('[görsel yüklenemedi] '))
          }
        }
        setBusy(-1)
        changed()
      })
    }
  }

  async function insertFiles(files: File[]) {
    setBusy(1)
    // Shrinking takes a moment and focus may move meanwhile: remember the cursor.
    const root = el.current!
    const sel = window.getSelection()
    const saved = sel?.rangeCount && root.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null
    try {
      const urls = await Promise.all(files.map((f) => fileToDataUrl(f).catch(() => null)))
      const html = urls.map((u) => (u ? `<img class="ed-img" src="${u}" alt="">` : '[görsel okunamadı] ')).join('')
      if (saved) {
        root.focus()
        sel?.removeAllRanges()
        sel?.addRange(saved)
      } else focusEnd(root)
      document.execCommand('insertHTML', false, html)
    } finally {
      setBusy(-1)
      changed()
    }
  }

  function handleData(dt: DataTransfer): boolean {
    const html = dt.getData('text/html')
    const files = imageFilesFrom(dt.items?.length ? dt.items : dt.files)
    if (html && /<img/i.test(html)) {
      // Web page / Word content with pictures: keep text and images in order.
      const blocks = htmlToBlocks(html)
      // A copied single image often comes both as a file and as HTML: prefer the file.
      if (files.length && blocks.every((b) => b.type === 'image')) void insertFiles(files)
      else insertBlocks(blocks)
      return true
    }
    if (files.length) {
      void insertFiles(files)
      return true
    }
    const text = dt.getData('text/plain')
    if (text) {
      document.execCommand('insertText', false, normalizeMathUnicode(text))
      changed()
      return true
    }
    return false
  }

  return (
    <div
      ref={el}
      className={`editor ${className ?? ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={changed}
      onPaste={(e) => {
        e.preventDefault()
        handleData(e.clipboardData)
      }}
      onDrop={(e) => {
        e.preventDefault()
        // Put the caret where the drop happened before inserting.
        const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        if (pos) {
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(pos)
        }
        handleData(e.dataTransfer)
      }}
      onDragOver={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          onSubmit?.()
        }
      }}
    />
  )
})

function makeImg(src: string) {
  const img = document.createElement('img')
  img.className = 'ed-img'
  img.src = src
  img.alt = ''
  return img
}

function focusEnd(root: HTMLElement) {
  root.focus()
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export default RichEditor
