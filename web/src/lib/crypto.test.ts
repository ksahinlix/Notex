import { describe, expect, it } from 'vitest'
import { createProtectedFolder, decryptJson, encryptJson, unlockFolder } from './crypto'

describe('folder encryption', () => {
  it('unlocks only with the right password', async () => {
    const { folder, key } = await createProtectedFolder('Personal/Diary', 'hunter2')
    expect(folder.pathKey).toBe('Personal/Diary')
    expect(JSON.stringify(folder)).not.toContain('hunter2')

    expect(await unlockFolder(folder, 'wrong')).toBeNull()
    const unlocked = await unlockFolder(folder, 'hunter2')
    expect(unlocked).not.toBeNull()

    const cipher = await encryptJson(key, { text: 'secret note' })
    expect(await decryptJson(unlocked!, cipher)).toEqual({ text: 'secret note' })
  })

  it('uses a fresh IV every time', async () => {
    const { key } = await createProtectedFolder('X', 'pw')
    expect(await encryptJson(key, 'same')).not.toBe(await encryptJson(key, 'same'))
  })
})
