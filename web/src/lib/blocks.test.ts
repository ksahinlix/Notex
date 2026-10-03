import { describe, expect, it } from 'vitest'
import { isFormatted, listNumbers } from './blocks'
import type { Block } from './types'

const para = (content: string): Block => ({ type: 'text', content })
const item = (content: string, list: 'bullet' | 'number'): Block => ({ type: 'text', content, list })

describe('listNumbers', () => {
  it('numbers a run of items from one', () => {
    expect(listNumbers([item('a', 'number'), item('b', 'number'), item('c', 'number')])).toEqual([1, 2, 3])
  })

  it('starts again after anything that is not a numbered item', () => {
    const blocks = [item('a', 'number'), item('b', 'number'), para('araya giren'), item('c', 'number')]
    expect(listNumbers(blocks)).toEqual([1, 2, 0, 1])
  })

  it('is not interrupted by bullets being bullets, but does restart after them', () => {
    expect(listNumbers([item('a', 'number'), item('x', 'bullet'), item('b', 'number')])).toEqual([1, 0, 1])
  })

  it('an image between two lists separates them', () => {
    const blocks: Block[] = [item('a', 'number'), { type: 'image', src: 'x' }, item('b', 'number')]
    expect(listNumbers(blocks)).toEqual([1, 0, 1])
  })

  it('gives a number for every block, so it lines up with the list', () => {
    const blocks = [para('a'), item('b', 'number')]
    expect(listNumbers(blocks)).toHaveLength(blocks.length)
  })
})

describe('isFormatted', () => {
  it('knows plain text from the rest', () => {
    expect(isFormatted(para('düz'))).toBe(false)
    expect(isFormatted({ type: 'text', content: 'b', style: 'h2' })).toBe(true)
    expect(isFormatted(item('b', 'bullet'))).toBe(true)
    expect(isFormatted({ type: 'text', content: 'b', spans: [{ text: 'b', marks: ['b'] }] })).toBe(true)
    expect(isFormatted({ type: 'image', src: 'x' })).toBe(false)
  })
})
