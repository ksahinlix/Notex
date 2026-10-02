import { describe, expect, it } from 'vitest'
import { isCheckable, movedTodoFolders, noteOwner, splitDone, todoAncestor, todoKeysOf } from './todo'
import type { Note, TodoFolder } from './types'

const note = (over: Partial<Note> = {}): Note => ({
  id: over.id ?? 'n1',
  path: ['Ev', 'Alışveriş'],
  encrypted: false,
  content: { text: 'süt' },
  cipher: null,
  isListItem: false,
  checked: false,
  reminderAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const marks: TodoFolder[] = [
  { ownerId: 'me', pathKey: 'Ev/Alışveriş' },
  { ownerId: 'kaan', pathKey: 'Ev/Alışveriş' },
]

describe('todoAncestor', () => {
  it('matches the folder itself and anything inside it', () => {
    expect(todoAncestor(marks, 'me', ['Ev', 'Alışveriş'])?.pathKey).toBe('Ev/Alışveriş')
    expect(todoAncestor(marks, 'me', ['Ev', 'Alışveriş', 'Market'])?.pathKey).toBe('Ev/Alışveriş')
  })

  it('leaves the folder above it, and a folder with a similar name, alone', () => {
    expect(todoAncestor(marks, 'me', ['Ev'])).toBeUndefined()
    expect(todoAncestor(marks, 'me', ['Ev', 'Alışverişler'])).toBeUndefined()
  })

  it('is per owner: my mark is not hers', () => {
    expect(todoAncestor(marks, 'ayse', ['Ev', 'Alışveriş'])).toBeUndefined()
  })
})

describe('isCheckable', () => {
  it('a note in a to-do folder gets a checkbox even though it is not a list item', () => {
    expect(isCheckable(note(), marks, 'me')).toBe(true)
    expect(isCheckable(note({ path: ['Ev'] }), marks, 'me')).toBe(false)
  })

  it('a list item keeps its checkbox anywhere', () => {
    expect(isCheckable(note({ path: ['İş'], isListItem: true }), marks, 'me')).toBe(true)
  })

  it('a note in a folder shared with me follows the owner’s mark', () => {
    expect(isCheckable(note({ ownerId: 'kaan' }), marks, 'me')).toBe(true)
    expect(isCheckable(note({ ownerId: 'ayse' }), marks, 'me')).toBe(false)
  })

  it('an older note of mine without an ownerId counts as mine', () => {
    expect(noteOwner(note(), 'me')).toBe('me')
    expect(isCheckable(note(), marks, 'me')).toBe(true)
  })
})

describe('splitDone', () => {
  it('sends ticked, checkable notes to the bottom group', () => {
    const open = note({ id: 'a' })
    const ticked = note({ id: 'b', checked: true })
    // Checked but in no to-do folder: an old tick nobody can see, so it stays put.
    const stray = note({ id: 'c', path: ['İş'], checked: true })
    const r = splitDone([open, ticked, stray], marks, 'me')
    expect(r.open.map((n) => n.id)).toEqual(['a', 'c'])
    expect(r.done.map((n) => n.id)).toEqual(['b'])
  })
})

describe('movedTodoFolders', () => {
  it('follows a rename, subfolders included, and leaves similar names alone', () => {
    const before: TodoFolder[] = [
      { ownerId: 'me', pathKey: 'Ev/Alışveriş' },
      { ownerId: 'me', pathKey: 'Ev/Alışveriş/Market' },
      { ownerId: 'me', pathKey: 'Evlilik' },
      { ownerId: 'kaan', pathKey: 'Ev/Alışveriş' },
    ]
    expect(movedTodoFolders(before, 'me', ['Ev'], ['Yaşam'])).toEqual([
      { ownerId: 'me', pathKey: 'Yaşam/Alışveriş' },
      { ownerId: 'me', pathKey: 'Yaşam/Alışveriş/Market' },
      { ownerId: 'me', pathKey: 'Evlilik' },
      { ownerId: 'kaan', pathKey: 'Ev/Alışveriş' },
    ])
  })
})

describe('todoKeysOf', () => {
  it('gives the sidebar only my own marks', () => {
    expect([...todoKeysOf(marks, 'me')]).toEqual(['Ev/Alışveriş'])
    expect([...todoKeysOf(marks, 'ayse')]).toEqual([])
  })
})
