// App state: notes, protected folders, unlocked keys and decrypted content.
//
// A tiny external store (used through useSyncExternalStore) instead of React
// state, so async actions always see the latest data. Every change is applied
// locally first (instant UI), then sent to the server. If the server has a
// newer version (409), its version wins (D9).

import { useSyncExternalStore } from 'react'
import { api, ApiError } from '../lib/api'
import { createProtectedFolder, unlockFolder } from '../lib/crypto'
import { newNote, nowIso, open, seal } from '../lib/notes'
import { folderMoveError, pathAfterFolderMove } from '../lib/move'
import { findProtectedAncestor, pathKeyOf, pathStartsWith } from '../lib/tree'
import type { Note, NoteContent, ProtectedFolder, Share } from '../lib/types'

export interface PasswordRequest {
  mode: 'set' | 'unlock'
  pathKey: string
  /** Returns an error message, or null when the password was accepted. */
  validate: (password: string) => Promise<string | null>
  resolve: (ok: boolean) => void
}

export interface State {
  loaded: boolean
  notes: Note[]
  folders: ProtectedFolder[]
  /** Folders you share with someone (D18). */
  shares: Share[]
  /** Folders others share with you, accepted or still waiting. */
  sharedWithMe: Share[]
  /** The signed-in user, so foreign notes can be told apart. */
  userId: string | null
  /** pathKey -> folder key, only while unlocked. Never persisted. */
  keys: Record<string, CryptoKey>
  /** noteId -> decrypted content of encrypted notes, only while unlocked. */
  plain: Record<string, NoteContent>
  syncError: string
  pwdRequest: PasswordRequest | null
}

const initial: State = { loaded: false, notes: [], folders: [], shares: [], sharedWithMe: [], userId: null, keys: {}, plain: {}, syncError: '', pwdRequest: null }

const byNewest = (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt)

export class NotexStore {
  private state: State = initial
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.state

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  reset() {
    this.pending.clear()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.set(initial)
  }

  /** Content to display, or undefined if the note is locked. */
  contentOf(note: Note): NoteContent | undefined {
    return note.encrypted ? this.state.plain[note.id] : (note.content ?? undefined)
  }

  // ---- loading & saving ----

  async load(userId?: string) {
    try {
      const [n, f, s] = await Promise.all([api.listNotes(), api.listProtectedFolders(), api.listShares()])
      this.set({ notes: n.notes.sort(byNewest), folders: f.folders, shares: s.mine, sharedWithMe: s.withMe, userId: userId ?? this.state.userId, loaded: true, syncError: '' })
    } catch {
      this.set({ loaded: true, syncError: 'Notlar yüklenemedi. Sayfayı yenilemeyi dene.' })
    }
  }

  private upsertLocal(note: Note, content?: NoteContent) {
    const exists = this.state.notes.some((n) => n.id === note.id)
    const notes = exists ? this.state.notes.map((n) => (n.id === note.id ? note : n)) : [note, ...this.state.notes]
    const plain = { ...this.state.plain }
    if (note.encrypted && content) plain[note.id] = content
    if (!note.encrypted) delete plain[note.id]
    this.set({ notes: notes.sort(byNewest), plain })
  }

  // Saves that haven't reached the server yet: noteId -> newest version.
  // Failed saves are retried with growing delays (network drop, Render or Neon
  // waking up). A newer edit of the same note replaces the queued version.
  private pending = new Map<string, Note>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 0

  hasPendingSaves() {
    return this.pending.size > 0
  }

  private push(note: Note) {
    this.pending.set(note.id, note)
    void this.pushOne(note)
  }

  private async pushOne(note: Note) {
    try {
      await api.saveNote(note)
      if (this.pending.get(note.id) === note) this.pending.delete(note.id)
      if (!this.pending.size) {
        this.retryDelay = 0
        if (this.state.syncError.startsWith('Değişiklik')) this.set({ syncError: '' })
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The server has a newer version; it wins (D9).
        if (this.pending.get(note.id) === note) this.pending.delete(note.id)
        const current = (e.body as { current: Note }).current
        const key = this.keyIfUnlocked(current.path)
        this.upsertLocal(current, current.encrypted && key ? await open(current, key).catch(() => undefined) : undefined)
        return
      }
      this.set({ syncError: `Değişiklik sunucuya kaydedilemedi (${describeError(e)}). Tekrar deneniyor...` })
      if (e instanceof ApiError && e.status === 401) {
        this.set({ syncError: 'Oturum sona erdi. Değişikliklerin kaybolmaması için sayfayı yenilemeden önce tekrar giriş yap.' })
        return
      }
      this.scheduleRetry()
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return
    this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : 2000, 30_000)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      for (const n of this.pending.values()) void this.pushOne(n)
    }, this.retryDelay)
  }

  dismissError() {
    this.set({ syncError: '' })
  }

  // ---- passwords & keys ----

  private requestPassword(mode: PasswordRequest['mode'], pathKey: string, validate: PasswordRequest['validate']) {
    return new Promise<boolean>((resolve) => this.set({ pwdRequest: { mode, pathKey, validate, resolve } }))
  }

  /** Called by the password modal. Returns an error to show, or null on success. */
  async submitPassword(password: string): Promise<string | null> {
    const req = this.state.pwdRequest
    if (!req) return null
    const error = await req.validate(password)
    if (error) return error
    this.set({ pwdRequest: null })
    req.resolve(true)
    return null
  }

  cancelPassword() {
    this.state.pwdRequest?.resolve(false)
    this.set({ pwdRequest: null })
  }

  private keyIfUnlocked(path: string[]): CryptoKey | null {
    const folder = findProtectedAncestor(this.state.folders, path)
    return folder ? (this.state.keys[folder.pathKey] ?? null) : null
  }

  /** Key for saving into `path`: null for unprotected paths; asks for the password if locked. */
  private async keyForPath(path: string[]): Promise<{ ok: boolean; key: CryptoKey | null }> {
    const folder = findProtectedAncestor(this.state.folders, path)
    if (!folder) return { ok: true, key: null }
    const ok = await this.unlock(folder.pathKey)
    return { ok, key: this.state.keys[folder.pathKey] ?? null }
  }

  private async applyKey(pathKey: string, key: CryptoKey) {
    const prefix = pathKey.split('/')
    const plain = { ...this.state.plain }
    for (const n of this.state.notes) {
      if (n.encrypted && pathStartsWith(n.path, prefix)) {
        try {
          plain[n.id] = await open(n, key)
        } catch {
          /* written with another key; leave locked */
        }
      }
    }
    this.set({ keys: { ...this.state.keys, [pathKey]: key }, plain })
  }

  async unlock(pathKey: string): Promise<boolean> {
    if (this.state.keys[pathKey]) return true
    const folder = this.state.folders.find((f) => f.pathKey === pathKey)
    if (!folder) return false
    return this.requestPassword('unlock', pathKey, async (pw) => {
      const key = await unlockFolder(folder, pw)
      if (!key) return 'Şifre yanlış.'
      await this.applyKey(pathKey, key)
      return null
    })
  }

  lock(pathKey: string) {
    const prefix = pathKey.split('/')
    const keys = { ...this.state.keys }
    delete keys[pathKey]
    const plain = { ...this.state.plain }
    for (const n of this.state.notes) if (pathStartsWith(n.path, prefix)) delete plain[n.id]
    this.set({ keys, plain })
  }

  /** Protects a folder with a new password and encrypts the notes already in it. */
  async protect(path: string[]): Promise<string | null> {
    const pathKey = pathKeyOf(path)
    const clash = this.state.folders.find((f) => {
      const fp = f.pathKey.split('/')
      return pathStartsWith(path, fp) || pathStartsWith(fp, path)
    })
    if (clash) return 'Bu klasör zaten şifreli bir klasörün içinde ya da şifreli bir klasör içeriyor.'
    await this.requestPassword('set', pathKey, async (pw) => {
      const { folder, key } = await createProtectedFolder(pathKey, pw)
      try {
        await api.saveProtectedFolder(folder)
      } catch {
        return 'Sunucuya kaydedilemedi.'
      }
      this.set({ folders: [...this.state.folders, folder], keys: { ...this.state.keys, [pathKey]: key } })
      const toEncrypt = this.state.notes.filter((n) => !n.encrypted && pathStartsWith(n.path, path))
      for (const n of toEncrypt) {
        const content = n.content ?? { text: '' }
        const sealed = await seal(n, content, key)
        this.upsertLocal(sealed, content)
        void this.push(sealed)
      }
      return null
    })
    return null
  }

  // ---- note actions ----

  async create(
    path: string[],
    content: NoteContent,
    meta: { isListItem?: boolean; reminderAt?: string | null; isReminder?: boolean; repeat?: Note['repeat'] },
    /** Set when writing into a folder someone shared with you: it becomes theirs. */
    ownerId?: string,
  ): Promise<boolean> {
    const { ok, key } = await this.keyForPath(path)
    if (!ok) return false
    const sealed = await seal({ ...newNote(path, meta), ownerId: ownerId ?? this.state.userId ?? undefined }, content, key)
    this.upsertLocal(sealed, content)
    void this.push(sealed)
    return true
  }

  async update(note: Note, content: NoteContent) {
    const { ok, key } = await this.keyForPath(note.path)
    if (!ok) return
    const sealed = await seal(note, content, key)
    this.upsertLocal(sealed, content)
    void this.push(sealed)
  }

  /** Changes plaintext metadata only (reminder time, repeat, done), no re-encryption needed. */
  updateMeta(note: Note, patch: Partial<Pick<Note, 'reminderAt' | 'isReminder' | 'repeat' | 'reminderDoneUntil' | 'checked'>>) {
    const updated = { ...note, ...patch, updatedAt: nowIso() }
    this.upsertLocal(updated, this.contentOf(note))
    void this.push(updated)
  }

  /** ✓ on a reminder: a one-time reminder is done; a repeating one skips this occurrence. */
  completeReminder(note: Note, occurrence: Date | null) {
    if (note.repeat && occurrence) this.updateMeta(note, { reminderDoneUntil: occurrence.toISOString() })
    else this.updateMeta(note, { checked: true })
  }

  setChecked(note: Note, checked: boolean) {
    const updated = { ...note, checked, updatedAt: nowIso() }
    this.upsertLocal(updated, this.contentOf(note))
    void this.push(updated)
  }

  /**
   * Moves (or renames) a folder with everything in it (rule 2, lib/move.ts).
   * - Protected folders inside it move along with their password: the key is
   *   derived from password + salt, not from the path, so their notes keep
   *   their cipher and need no unlocking.
   * - Notes that enter or leave a protected folder are re-sealed, which asks
   *   for the passwords involved.
   * Returns { error } or { moved, merged } (merged: the destination already
   * had notes, so an undo would not be clean).
   */
  async moveFolder(folder: string[], newFolder: string[]): Promise<{ error: string } | { moved: number; merged: boolean }> {
    const error = folderMoveError(folder, newFolder)
    if (error) return { error }
    const { folders, notes } = this.state
    const inBranch = (p: string[]) => pathStartsWith(p, folder)

    // Protected folders inside the branch get new path keys.
    const renamed = folders
      .filter((f) => inBranch(f.pathKey.split('/')))
      .map((f) => ({ old: f, next: { ...f, pathKey: pathKeyOf(pathAfterFolderMove(f.pathKey.split('/'), folder, newFolder)!) } }))
    const others = folders.filter((f) => !renamed.some((r) => r.old === f))
    for (const r of renamed) {
      const rp = r.next.pathKey.split('/')
      if (others.some((o) => pathStartsWith(rp, o.pathKey.split('/')) || pathStartsWith(o.pathKey.split('/'), rp)))
        return { error: 'Şifreli klasörler iç içe olamaz.' }
    }
    const newFolders = [...others, ...renamed.map((r) => r.next)]
    const merged = notes.some((n) => pathStartsWith(n.path, newFolder))

    // Plan every note in the branch.
    const plans = notes
      .filter((n) => inBranch(n.path))
      .map((n) => {
        const newPath = pathAfterFolderMove(n.path, folder, newFolder)!
        const oldProt = findProtectedAncestor(folders, n.path)
        const newProt = findProtectedAncestor(newFolders, newPath)
        const movedAlong = !!oldProt && renamed.some((r) => r.old === oldProt && r.next === newProt)
        return { n, newPath, oldProt, newProt, reseal: !movedAlong && (oldProt || newProt) }
      })

    // Unlock what re-sealing needs (asks for passwords).
    for (const p of plans.filter((x) => x.reseal)) {
      for (const f of [p.oldProt, p.newProt]) {
        if (f && !this.state.keys[f.pathKey] && !(await this.unlock(f.pathKey))) return { error: 'Şifre girilmeden taşınamaz.' }
      }
    }

    // Save protected folders under their new keys first (the old ones are removed at the end).
    try {
      for (const r of renamed) await api.saveProtectedFolder(r.next)
    } catch {
      return { error: 'Şifreli klasör sunucuya kaydedilemedi.' }
    }
    const keys = { ...this.state.keys }
    for (const r of renamed) {
      if (keys[r.old.pathKey]) {
        keys[r.next.pathKey] = keys[r.old.pathKey]
        delete keys[r.old.pathKey]
      }
    }
    this.set({ folders: newFolders, keys })

    for (const p of plans) {
      if (!p.reseal) {
        const updated = { ...p.n, path: p.newPath, updatedAt: nowIso() }
        this.upsertLocal(updated, this.contentOf(p.n))
        void this.push(updated)
        continue
      }
      const oldKey = p.oldProt ? this.state.keys[p.oldProt.pathKey] : null
      const content = await open(p.n, oldKey)
      const sealed = await seal({ ...p.n, path: p.newPath }, content, p.newProt ? this.state.keys[p.newProt.pathKey] : null)
      this.upsertLocal(sealed, content)
      void this.push(sealed)
    }

    for (const r of renamed) void api.deleteProtectedFolder(r.old.pathKey).catch(() => {})
    // Shares point at a folder path, so they have to follow it (D18).
    if (this.state.shares.some((sh) => pathStartsWith(sh.path, folder))) {
      try {
        await api.moveShares(folder, newFolder)
        await this.refreshShares()
      } catch {
        this.set({ syncError: 'Paylaşım yeni klasör adına taşınamadı.' })
      }
    }
    return { moved: plans.length, merged }
  }

  // ---- sharing (D18) ----

  private async refreshShares() {
    const s = await api.listShares()
    this.set({ shares: s.mine, sharedWithMe: s.withMe })
  }

  /** Invites someone to a folder. Returns the invite (with its link token) or an error. */
  async share(path: string[], email: string): Promise<{ share: Share } | { error: string }> {
    try {
      const share = await api.createShare(path, email)
      await this.refreshShares()
      return { share }
    } catch (err) {
      const msg = err instanceof ApiError ? String((err.body as { error?: string })?.error ?? '') : ''
      if (msg.includes('locked')) return { error: 'Şifreli klasörler paylaşılamaz.' }
      if (msg.includes('that is you')) return { error: 'Bu senin adresin.' }
      if (msg.includes('email')) return { error: 'Geçerli bir e-posta adresi yaz.' }
      return { error: 'Paylaşım oluşturulamadı. Tekrar dene.' }
    }
  }

  /** The owner withdraws a share, or you leave one you were given. */
  async unshare(id: string): Promise<boolean> {
    try {
      await api.removeShare(id)
      await this.refreshShares()
      this.set({ notes: this.state.notes.filter((n) => !n.ownerId || n.ownerId === this.state.userId || this.canSee(n)) })
      return true
    } catch {
      return false
    }
  }

  private canSee(note: Note) {
    return this.state.sharedWithMe.some((s) => s.status === 'accepted' && s.owner?.id === note.ownerId && pathStartsWith(note.path, s.path))
  }

  /** Accepts an invite, by link token or from the banner, and loads what it opens. */
  async acceptInvite(by: { token: string } | { id: string }): Promise<{ share: Share } | { error: string }> {
    try {
      const share = await api.acceptShare(by)
      await this.load()
      return { share }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      return { error: status === 404 ? 'Bu davet bu hesap için değil. Davet edilen e-posta ile giriş yap.' : 'Davet kabul edilemedi.' }
    }
  }

  /** Moves one note. Returns false if nothing moved (same place, locked, or password cancelled). */
  async move(note: Note, newPath: string[]): Promise<boolean> {
    if (pathKeyOf(newPath) === pathKeyOf(note.path)) return false
    const content = this.contentOf(note)
    if (!content) return false // locked notes can't be moved
    const { ok, key } = await this.keyForPath(newPath)
    if (!ok) return false
    const sealed = await seal({ ...note, path: newPath }, content, key)
    this.upsertLocal(sealed, content)
    void this.push(sealed)
    return true
  }

  remove(note: Note) {
    const plain = { ...this.state.plain }
    delete plain[note.id]
    this.set({ notes: this.state.notes.filter((n) => n.id !== note.id), plain })
    api.deleteNote(note.id).catch((e) => {
      if (!(e instanceof ApiError && e.status === 404)) this.set({ syncError: 'Not sunucudan silinemedi.' })
    })
  }
}

/** Short reason for an error, shown to the user so problems can be diagnosed. */
function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const msg = (e.body as { error?: string } | null)?.error
    return msg ? `${e.status}: ${msg}` : `HTTP ${e.status}`
  }
  return e instanceof TypeError ? 'sunucuya ulaşılamadı' : String(e)
}

export const store = new NotexStore()

// Warn before closing the tab while a change is still waiting to be saved.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (store.hasPendingSaves()) e.preventDefault()
  })
}

export function useNotex(): State {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
