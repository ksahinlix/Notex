import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { createProtectedFolder, encryptJson } from '../lib/crypto'
import type { Note, ProtectedFolder } from '../lib/types'
import { NotexStore } from './store'

vi.mock('../lib/api', async (orig) => {
  const mod = await orig<typeof import('../lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listNotes: vi.fn(),
      listProtectedFolders: vi.fn(),
      listShares: vi.fn(async () => ({ mine: [], withMe: [], contacts: [] })),
      moveShares: vi.fn(async () => ({ moved: 0 })),
      saveNote: vi.fn(async (n: Note) => n),
      saveProtectedFolder: vi.fn(async (f: ProtectedFolder) => f),
      deleteProtectedFolder: vi.fn(async () => null),
    },
  }
})
const m = vi.mocked(api)

let id = 0
const plain = (path: string[], text = 'x'): Note => ({
  id: `p${++id}`, path, encrypted: false, content: { text }, cipher: null, isListItem: false, checked: false,
  reminderAt: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
})

async function storeWith(notes: Note[], folders: ProtectedFolder[] = []) {
  m.listNotes.mockResolvedValue({ notes, serverTime: '' })
  m.listProtectedFolders.mockResolvedValue({ folders })
  const s = new NotexStore()
  await s.load()
  return s
}
const pathsOf = (s: NotexStore) => Object.fromEntries(s.getSnapshot().notes.map((n) => [n.id, n.path.join('/')]))

/** Answers the next password prompt. */
async function answerPassword(s: NotexStore, pw: string) {
  await vi.waitFor(() => expect(s.getSnapshot().pwdRequest).not.toBeNull())
  expect(await s.submitPassword(pw)).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moveFolder', () => {
  it('moves a plain folder with its subfolders; other notes stay', async () => {
    const a = plain(['Sistem Tasarım', 'LSA'])
    const b = plain(['Sistem Tasarım', 'LSA', 'Makaleler'])
    const c = plain(['Sistem Tasarım', 'Diğer'])
    const s = await storeWith([a, b, c])
    const r = await s.moveFolder(['Sistem Tasarım', 'LSA'], ['Yazılım', 'LSA'])
    expect(r).toEqual({ moved: 2, merged: false })
    expect(pathsOf(s)).toEqual({ [a.id]: 'Yazılım/LSA', [b.id]: 'Yazılım/LSA/Makaleler', [c.id]: 'Sistem Tasarım/Diğer' })
    expect(m.saveNote).toHaveBeenCalledTimes(2)
  })

  it('reports a merge into an existing folder', async () => {
    const s = await storeWith([plain(['A', 'X']), plain(['B', 'X'])])
    expect(await s.moveFolder(['A', 'X'], ['B', 'X'])).toEqual({ moved: 1, merged: true })
  })

  it('refuses moving a folder into itself', async () => {
    const s = await storeWith([plain(['A'])])
    expect(await s.moveFolder(['A'], ['A', 'B', 'A'])).toEqual({ error: 'Bir klasör kendi içine taşınamaz.' })
  })

  it('a protected folder moves with its password; notes keep their cipher, no password asked', async () => {
    const { folder, key } = await createProtectedFolder('Kişisel/Günlük', 'pw')
    const secret: Note = { ...plain(['Kişisel', 'Günlük']), encrypted: true, content: null, cipher: await encryptJson(key, { text: 'gizli' }) }
    const s = await storeWith([secret], [folder])
    const r = await s.moveFolder(['Kişisel', 'Günlük'], ['Arşiv', 'Günlük'])
    expect(r).toEqual({ moved: 1, merged: false })
    const moved = s.getSnapshot().notes[0]
    expect(moved.path).toEqual(['Arşiv', 'Günlük'])
    expect(moved.cipher).toBe(secret.cipher) // not re-encrypted
    expect(s.getSnapshot().pwdRequest).toBeNull()
    expect(s.getSnapshot().folders.map((f) => f.pathKey)).toEqual(['Arşiv/Günlük'])
    expect(m.saveProtectedFolder).toHaveBeenCalledWith({ ...folder, pathKey: 'Arşiv/Günlük' })
    await vi.waitFor(() => expect(m.deleteProtectedFolder).toHaveBeenCalledWith('Kişisel/Günlük'))
    // the same password still opens it at the new place
    const promise = s.unlock('Arşiv/Günlük')
    await answerPassword(s, 'pw')
    expect(await promise).toBe(true)
    expect(s.contentOf(s.getSnapshot().notes[0])).toEqual({ text: 'gizli' })
  })

  it('notes moved into a protected folder are encrypted after asking its password', async () => {
    const { folder } = await createProtectedFolder('Gizli', 'pw')
    const n = plain(['Açık', 'Plan'], 'plan metni')
    const s = await storeWith([n], [folder])
    const promise = s.moveFolder(['Açık', 'Plan'], ['Gizli', 'Plan'])
    await answerPassword(s, 'pw')
    expect(await promise).toEqual({ moved: 1, merged: false })
    const moved = s.getSnapshot().notes[0]
    expect(moved.encrypted).toBe(true)
    expect(moved.content).toBeNull()
    expect(JSON.stringify(moved)).not.toContain('plan metni')
    expect(s.contentOf(moved)).toEqual({ text: 'plan metni' })
  })

  it('refuses nesting protected folders, and stops if a password is cancelled', async () => {
    const outer = (await createProtectedFolder('Gizli', 'pw')).folder
    const inner = (await createProtectedFolder('Kişisel/Kasa', 'pw2')).folder
    const s = await storeWith([plain(['Kişisel', 'Kasa'])], [outer, inner])
    expect(await s.moveFolder(['Kişisel', 'Kasa'], ['Gizli', 'Kasa'])).toEqual({ error: 'Şifreli klasörler iç içe olamaz.' })

    const s2 = await storeWith([plain(['Açık'])], [outer])
    const promise = s2.moveFolder(['Açık'], ['Gizli', 'Açık'])
    await vi.waitFor(() => expect(s2.getSnapshot().pwdRequest).not.toBeNull())
    s2.cancelPassword()
    expect(await promise).toEqual({ error: 'Şifre girilmeden taşınamaz.' })
    expect(s2.getSnapshot().notes[0].path).toEqual(['Açık']) // nothing changed
  })
})
