// Pure helpers for creating, sealing (encrypting) and opening notes.
// "Sealing" puts a note's content either in plaintext (`content`) or, when a
// folder key is given, inside `cipher`. Every field of NoteContent goes into
// the cipher, so nothing readable is left behind (D8).

import { decryptJson, encryptJson } from './crypto'
import type { Block, Note, NoteContent } from './types'

export const nowIso = () => new Date().toISOString()

export function newId(): string {
  return crypto.randomUUID()
}

/** A new note shell. Call `seal` to attach its content. */
export function newNote(
  path: string[],
  meta: { isListItem?: boolean; reminderAt?: string | null; isReminder?: boolean; repeat?: Note['repeat'] } = {},
): Note {
  const now = nowIso()
  return {
    id: newId(),
    path,
    encrypted: false,
    content: { text: '' },
    cipher: null,
    isListItem: !!meta.isListItem,
    checked: false,
    reminderAt: meta.reminderAt ?? null,
    isReminder: !!meta.isReminder || !!meta.reminderAt,
    repeat: meta.reminderAt ? (meta.repeat ?? null) : null,
    reminderDoneUntil: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** Returns a copy of `note` holding `content`, encrypted if `key` is given, with a fresh updatedAt. */
export async function seal(note: Note, content: NoteContent, key: CryptoKey | null): Promise<Note> {
  const base = { ...note, updatedAt: nowIso() }
  if (key) return { ...base, encrypted: true, content: null, cipher: await encryptJson(key, content) }
  return { ...base, encrypted: false, content, cipher: null }
}

/** Reads a note's content. Encrypted notes need their folder key. */
export async function open(note: Note, key: CryptoKey | null): Promise<NoteContent> {
  if (!note.encrypted) return note.content ?? { text: '' }
  if (!key) throw new Error('note is locked')
  return decryptJson<NoteContent>(key, note.cipher!)
}

/** Text + images -> blocks, keeping images after the text. */
export function buildBlocks(text: string, images: string[]): Block[] {
  const blocks: Block[] = []
  if (text.trim()) blocks.push({ type: 'text', content: text.trim() })
  for (const src of images) blocks.push({ type: 'image', src })
  return blocks
}

export function imagesOf(content: NoteContent): string[] {
  return (content.blocks ?? []).flatMap((b) => (b.type === 'image' ? [b.src] : []))
}

/** Replaces the text of a note while keeping its images. */
export function withText(content: NoteContent, text: string): NoteContent {
  return { ...content, text, blocks: buildBlocks(text, imagesOf(content)) }
}

export function withImages(content: NoteContent, images: string[]): NoteContent {
  return { ...content, blocks: buildBlocks(content.text, [...imagesOf(content), ...images]) }
}

/** Case-insensitive search over text, list text, comments and path. */
export function matchesQuery(note: Note, content: NoteContent | undefined, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('tr')
  if (!q) return true
  const hay = [
    content?.text,
    content?.listItemText,
    content?.reminderLabel,
    ...(content?.comments ?? []).map((c) => c.text),
    note.path.join(' / '),
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase('tr')
  return hay.includes(q)
}
