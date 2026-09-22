// Category tree helpers (Category > Folder > ... > Page, unlimited depth).

import type { Note, ProtectedFolder } from './types'

export interface TreeNode {
  children: Record<string, TreeNode>
  /** Number of notes at or below this node. */
  count: number
}

export function buildTree(notes: Pick<Note, 'path'>[]): TreeNode {
  const root: TreeNode = { children: {}, count: 0 }
  for (const n of notes) {
    let cur = root
    cur.count++
    for (const seg of n.path) {
      cur = cur.children[seg] ??= { children: {}, count: 0 }
      cur.count++
    }
  }
  return root
}

/** Indented text form of the tree, used as context for the AI classifier. */
export function serializeTree(node: TreeNode, depth = 0): string {
  return Object.entries(node.children)
    .map(([name, child]) => `${'  '.repeat(depth)}- ${name}\n${serializeTree(child, depth + 1)}`)
    .join('')
}

/** All paths in the tree (every folder, not only leaves). */
export function allPaths(node: TreeNode, prefix: string[] = []): string[][] {
  return Object.entries(node.children).flatMap(([name, child]) => {
    const p = [...prefix, name]
    return [p, ...allPaths(child, p)]
  })
}

export function pathStartsWith(path: string[], prefix: string[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg)
}

export const pathKeyOf = (path: string[]) => path.join('/')

/** "A / B / C" or "A/B/C" -> ["A", "B", "C"] */
export function parsePath(input: string): string[] {
  return input.split('/').map((s) => s.trim()).filter(Boolean)
}

/** The protected folder that covers `path` (the folder itself or an ancestor), if any. */
export function findProtectedAncestor(folders: ProtectedFolder[], path: string[]): ProtectedFolder | undefined {
  return folders.find((f) => pathStartsWith(path, f.pathKey.split('/')))
}
