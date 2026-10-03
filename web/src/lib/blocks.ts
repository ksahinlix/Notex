// Small helpers over a note's blocks (D27).

import type { Block } from './types'

/**
 * The number to draw against each block, for numbered list items. Items count
 * within their own run, so two lists in one note each start at 1 and anything
 * between them — a paragraph, a heading, an image — resets the count.
 *
 * Numbering is worked out here rather than stored, so a list keeps reading
 * correctly after an item is edited away.
 */
export function listNumbers(blocks: Block[]): number[] {
  let n = 0
  return blocks.map((b) => {
    n = b.type === 'text' && b.list === 'number' ? n + 1 : 0
    return n
  })
}

/** True when a block carries anything beyond plain text. */
export const isFormatted = (b: Block) => b.type === 'text' && (!!b.style || !!b.list || !!b.spans)
