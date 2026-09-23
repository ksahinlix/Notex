import { describe, expect, it } from 'vitest'
import { folderInto, folderMoveError, folderRenamed, noteMoveTarget, pathAfterFolderMove } from './move'

describe('moving a note keeps its folder name (rule 1)', () => {
  it.each([
    [['Sistem Tasarım', 'LSA'], ['Yazılım'], ['Yazılım', 'LSA']],
    [['Sistem Tasarım', 'LSA'], ['Yazılım', 'LSA'], ['Yazılım', 'LSA']], // no LSA / LSA
    [['Sistem Tasarım', 'LSA'], ['Yazılım', 'lsa'], ['Yazılım', 'lsa']], // case-insensitive
    [['Sistem Tasarım', 'LSA', 'Makaleler'], ['Yazılım'], ['Yazılım', 'Makaleler']], // only the last folder
    [['Genel'], ['Yazılım'], ['Yazılım']], // one level: the category itself
  ])('%j dropped on %j -> %j', (note, target, want) => {
    expect(noteMoveTarget(note, target)).toEqual(want)
  })
})

describe('moving a folder (rule 2)', () => {
  it('moves the whole branch and keeps its structure', () => {
    const folder = ['Sistem Tasarım', 'LSA']
    const to = folderInto(folder, ['Yazılım'])
    expect(to).toEqual(['Yazılım', 'LSA'])
    expect(pathAfterFolderMove(['Sistem Tasarım', 'LSA'], folder, to)).toEqual(['Yazılım', 'LSA'])
    expect(pathAfterFolderMove(['Sistem Tasarım', 'LSA', 'Makaleler'], folder, to)).toEqual(['Yazılım', 'LSA', 'Makaleler'])
    expect(pathAfterFolderMove(['Sistem Tasarım', 'Diğer'], folder, to)).toBeNull()
    expect(pathAfterFolderMove(['Sistem Tasarım', 'LSA2'], folder, to)).toBeNull() // whole segments only
  })

  it('moves to the top level and renames', () => {
    expect(folderInto(['Sistem Tasarım', 'LSA'], null)).toEqual(['LSA'])
    expect(folderRenamed(['Sistem Tasarım', 'LSA'], '  LSA Notları ')).toEqual(['Sistem Tasarım', 'LSA Notları'])
  })

  it('refuses impossible moves', () => {
    expect(folderMoveError(['A'], ['A', 'B', 'A'])).toMatch(/kendi içine/)
    expect(folderMoveError(['A', 'B'], ['A', 'B'])).toMatch(/zaten/)
    expect(folderMoveError(['A'], ['X', ''])).toMatch(/Geçersiz/)
    expect(folderMoveError(['A'], ['X', 'a/b'])).toMatch(/Geçersiz/)
    expect(folderMoveError(['A', 'B'], ['C', 'B'])).toBeNull()
  })
})
