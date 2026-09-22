import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api'
import { NotexStore } from './store'

vi.mock('../lib/api', async (orig) => {
  const mod = await orig<typeof import('../lib/api')>()
  return { ...mod, api: { ...mod.api, saveNote: vi.fn(), deleteNote: vi.fn() } }
})
const saveNote = vi.mocked(api.saveNote)

describe('saving with retries', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    saveNote.mockReset()
  })

  it('retries a failed save, then clears the error', async () => {
    saveNote.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({} as never)
    const s = new NotexStore()
    await s.create(['A'], { text: 'hi' }, {})
    await vi.waitFor(() => expect(s.getSnapshot().syncError).toContain('sunucuya ulaşılamadı'))
    expect(s.hasPendingSaves()).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(saveNote).toHaveBeenCalledTimes(2)
    expect(s.hasPendingSaves()).toBe(false)
    expect(s.getSnapshot().syncError).toBe('')
  })

  it('retries only the newest version of an edited note', async () => {
    saveNote.mockRejectedValueOnce(new ApiError(503, { error: 'db down' })).mockRejectedValueOnce(new ApiError(503, null)).mockResolvedValue({} as never)
    const s = new NotexStore()
    await s.create(['A'], { text: 'v1' }, {})
    const note = s.getSnapshot().notes[0]
    await s.update(note, { text: 'v2' })
    await vi.waitFor(() => expect(s.getSnapshot().syncError).toContain('503'))

    saveNote.mockClear()
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveNote).toHaveBeenCalledTimes(1)
    expect(saveNote.mock.calls[0][0].content?.text).toBe('v2')
    expect(s.hasPendingSaves()).toBe(false)
  })
})
