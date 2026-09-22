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
import { findProtectedAncestor, pathKeyOf, pathStartsWith } from '../lib/tree'
import type { Note, NoteContent, ProtectedFolder } from '../lib/types'

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
  /** pathKey -> folder key, only while unlocked. Never persisted. */
  keys: Record<string, CryptoKey>
  /** noteId -> decrypted content of encrypted notes, only while unlocked. */
  plain: Record<string, NoteContent>
  syncError: string
  pwdRequest: PasswordRequest | null
}

const initial: State = { loaded: false, notes: [], folders: [], keys: {}, plain: {}, syncError: '', pwdRequest: null }

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
    this.set(initial)
  }

  /** Content to display, or undefined if the note is locked. */
  contentOf(note: Note): NoteContent | undefined {
    return note.encrypted ? this.state.plain[note.id] : (note.content ?? undefined)
  }

  // ---- loading & saving ----

  async load() {
    try {
      const [n, f] = await Promise.all([api.listNotes(), api.listProtectedFolders()])
      this.set({ notes: n.notes.sort(byNewest), folders: f.folders, loaded: true, syncError: '' })
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

  private async push(note: Note) {
    try {
      await api.saveNote(note)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.body as { current: Note }).current
        const key = this.keyIfUnlocked(current.path)
        this.upsertLocal(current, current.encrypted && key ? await open(current, key).catch(() => undefined) : undefined)
      } else {
        this.set({ syncError: 'Değişiklik sunucuya kaydedilemedi.' })
      }
    }
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

  async create(path: string[], content: NoteContent, meta: { isListItem?: boolean; reminderAt?: string | null }): Promise<boolean> {
    const { ok, key } = await this.keyForPath(path)
    if (!ok) return false
    const sealed = await seal(newNote(path, meta), content, key)
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

  setChecked(note: Note, checked: boolean) {
    const updated = { ...note, checked, updatedAt: nowIso() }
    this.upsertLocal(updated, this.contentOf(note))
    void this.push(updated)
  }

  async move(note: Note, newPath: string[]) {
    if (pathKeyOf(newPath) === pathKeyOf(note.path)) return
    const content = this.contentOf(note)
    if (!content) return // locked notes can't be moved
    const { ok, key } = await this.keyForPath(newPath)
    if (!ok) return
    const sealed = await seal({ ...note, path: newPath }, content, key)
    this.upsertLocal(sealed, content)
    void this.push(sealed)
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

export const store = new NotexStore()

export function useNotex(): State {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
