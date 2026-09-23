// Path rules for moving notes and folders.
//
// Rule 1 (moving a note): the note keeps its own folder name.
//   "Sistem Tasarım / LSA" dropped on "Yazılım" -> "Yazılım / LSA".
//   A one-level note ("Genel") is the category itself: it goes to the target.
//   If the target already ends with that name, no "LSA / LSA".
// Rule 2 (moving a folder): the whole branch moves under the new parent,
//   keeping its structure. Renaming is a move to the same parent.

import { pathStartsWith } from './tree'

const low = (s: string) => s.toLocaleLowerCase('tr')

/** Where a note lands when dropped on `target` (Rule 1). */
export function noteMoveTarget(notePath: string[], target: string[]): string[] {
  if (notePath.length < 2) return target
  const leaf = notePath[notePath.length - 1]
  if (target.length && low(target[target.length - 1]) === low(leaf)) return target
  return [...target, leaf]
}

/** The note's new path when `folder` moves to `newFolder`, or null if the note isn't in it. */
export function pathAfterFolderMove(notePath: string[], folder: string[], newFolder: string[]): string[] | null {
  if (!pathStartsWith(notePath, folder)) return null
  return [...newFolder, ...notePath.slice(folder.length)]
}

/** Error message if `folder` can't move to `newFolder`, otherwise null. */
export function folderMoveError(folder: string[], newFolder: string[]): string | null {
  if (!newFolder.length || newFolder.some((s) => !s.trim() || s.includes('/'))) return 'Geçersiz klasör adı.'
  if (newFolder.join('/') === folder.join('/')) return 'Klasör zaten orada.'
  if (pathStartsWith(newFolder, folder)) return 'Bir klasör kendi içine taşınamaz.'
  return null
}

/** New path of `folder` when moved into `parent` (null parent = top level). */
export const folderInto = (folder: string[], parent: string[] | null): string[] => [...(parent ?? []), folder[folder.length - 1]]

/** New path of `folder` when renamed to `name`. */
export const folderRenamed = (folder: string[], name: string): string[] => [...folder.slice(0, -1), name.trim()]
