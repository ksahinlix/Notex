// Folders whose notes can be ticked off (D22).
//
// The mark sits on the folder, not on the note, and it is stored on the server
// per owner + path, so it follows you to your phone and to the people the
// folder is shared with (D18). Subfolders inherit it, the way a protected
// folder covers everything inside it: a to-do "Alışveriş" also makes
// "Alışveriş / Market" checkable.

import { pathKeyOf, pathStartsWith } from './tree'
import type { Note, TodoFolder } from './types'

/** Whose folder a note lives in. Your own older notes carry no ownerId. */
export const noteOwner = (note: Note, userId: string | null) => note.ownerId ?? userId ?? ''

/** The pathKeys marked by one owner, for the sidebar. */
export const todoKeysOf = (folders: TodoFolder[], ownerId: string | null) =>
  new Set(folders.filter((f) => f.ownerId === (ownerId ?? '')).map((f) => f.pathKey))

/** The marked folder that covers `path` — itself or an ancestor — if any. */
export const todoAncestor = (folders: TodoFolder[], ownerId: string, path: string[]) =>
  folders.find((f) => f.ownerId === ownerId && pathStartsWith(path, f.pathKey.split('/')))

/** A note gets a checkbox: it was written as a list item, or it is in a to-do folder. */
export const isCheckable = (note: Note, folders: TodoFolder[], userId: string | null) =>
  note.isListItem || !!todoAncestor(folders, noteOwner(note, userId), note.path)

/** Ticked notes drop to the bottom of the list, under "Tamamlananlar" (D22). */
export function splitDone(notes: Note[], folders: TodoFolder[], userId: string | null): { open: Note[]; done: Note[] } {
  const open: Note[] = []
  const done: Note[] = []
  for (const n of notes) (n.checked && isCheckable(n, folders, userId) ? done : open).push(n)
  return { open, done }
}

/**
 * The marks after their owner renamed or moved a folder, mirroring what the
 * server does, so the checkboxes don't blink off until the next load.
 */
export function movedTodoFolders(folders: TodoFolder[], ownerId: string, from: string[], to: string[]): TodoFolder[] {
  const a = pathKeyOf(from)
  return folders.map((f) =>
    f.ownerId === ownerId && (f.pathKey === a || f.pathKey.startsWith(a + '/'))
      ? { ...f, pathKey: pathKeyOf(to) + f.pathKey.slice(a.length) }
      : f,
  )
}
