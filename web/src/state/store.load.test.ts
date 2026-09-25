import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Note } from '../lib/types'
import { NotexStore } from './store'

vi.mock('../lib/api', async (orig) => {
  const mod = await orig<typeof import('../lib/api')>()
  return { ...mod, api: { ...mod.api, listNotes: vi.fn(), listProtectedFolders: vi.fn(), listShares: vi.fn() } }
})
const m = vi.mocked(api)

const note: Note = {
  id: 'n1', path: ['Yazılım'], encrypted: false, content: { text: 'x' }, cipher: null, isListItem: false,
  checked: false, reminderAt: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  m.listNotes.mockResolvedValue({ notes: [note], serverTime: '' })
  m.listProtectedFolders.mockResolvedValue({ folders: [] })
})

describe('load', () => {
  it('loads notes, folders and shares', async () => {
    m.listShares.mockResolvedValue({ mine: [], withMe: [], contacts: [] })
    const s = new NotexStore()
    await s.load('me')
    expect(s.getSnapshot().notes).toHaveLength(1)
    expect(s.getSnapshot().userId).toBe('me')
    expect(s.getSnapshot().syncError).toBe('')
  })

  // Sharing is an addition; it must never keep your own notes off the screen.
  it('still shows your notes when sharing cannot be loaded', async () => {
    m.listShares.mockRejectedValue(new Error('boom'))
    const s = new NotexStore()
    await s.load('me')
    const state = s.getSnapshot()
    expect(state.notes).toHaveLength(1)
    expect(state.loaded).toBe(true)
    expect(state.sharedWithMe).toEqual([])
    expect(state.syncError).toMatch(/Paylaşımlar/)
  })

  it('reports a real failure when the notes cannot be loaded', async () => {
    m.listShares.mockResolvedValue({ mine: [], withMe: [], contacts: [] })
    m.listNotes.mockRejectedValue(new Error('boom'))
    const s = new NotexStore()
    await s.load('me')
    expect(s.getSnapshot().notes).toEqual([])
    expect(s.getSnapshot().syncError).toMatch(/yüklenemedi/)
  })
})
