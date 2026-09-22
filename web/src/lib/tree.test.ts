import { describe, expect, it } from 'vitest'
import { allPaths, buildTree, findProtectedAncestor, parsePath, pathStartsWith, serializeTree } from './tree'

const notes = [{ path: ['Work', 'Notex'] }, { path: ['Work', 'Notex', 'Ideas'] }, { path: ['Home'] }]

describe('tree', () => {
  it('builds counts per node', () => {
    const t = buildTree(notes)
    expect(t.count).toBe(3)
    expect(t.children.Work.count).toBe(2)
    expect(t.children.Work.children.Notex.children.Ideas.count).toBe(1)
  })

  it('serializes and lists paths', () => {
    const t = buildTree(notes)
    expect(serializeTree(t)).toBe('- Work\n  - Notex\n    - Ideas\n- Home\n')
    expect(allPaths(t)).toEqual([['Work'], ['Work', 'Notex'], ['Work', 'Notex', 'Ideas'], ['Home']])
  })

  it('matches path prefixes by whole segments', () => {
    expect(pathStartsWith(['Work', 'Notex'], ['Work'])).toBe(true)
    expect(pathStartsWith(['Work'], ['Work', 'Notex'])).toBe(false)
    expect(pathStartsWith(['Workshop'], ['Work'])).toBe(false)
  })

  it('finds protected ancestors by segment, not string prefix', () => {
    const folders = [{ pathKey: 'Personal', salt: '', iterations: 1, checkCipher: '' }]
    expect(findProtectedAncestor(folders, ['Personal', 'Diary'])?.pathKey).toBe('Personal')
    expect(findProtectedAncestor(folders, ['Personality'])).toBeUndefined()
  })

  it('parses typed paths', () => {
    expect(parsePath(' Work / Notex/ /Ideas ')).toEqual(['Work', 'Notex', 'Ideas'])
  })
})
