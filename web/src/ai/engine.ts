// On-device embedding engine (D3): owns the worker, the on/off setting and a
// vector cache.
//
// Cache: vectors are kept in memory, and vectors of *plain* notes are also
// stored in IndexedDB (keyed by a hash of the text), so they aren't
// recomputed on every visit. Vectors of encrypted notes are never written to
// disk: they reveal what a note is about (D3 privacy note).

import { llm } from './llm'
import type { WorkerRequest, WorkerResponse } from './protocol'

export const MODEL_ID = 'Xenova/multilingual-e5-small'
/** Approximate one-time download, shown to the user before enabling. */
export const MODEL_SIZE_MB = 120
const SETTING_KEY = 'notex-ai-enabled'
const BATCH = 16

export interface AiStatus {
  state: 'off' | 'loading' | 'ready' | 'error'
  /** 0..1 while downloading. */
  progress: number
  error: string
}

type Pending = { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }

class AiEngine {
  private status: AiStatus = { state: 'off', progress: 0, error: '' }
  private listeners = new Set<() => void>()
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private memory = new Map<string, Float32Array>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.status

  private setStatus(patch: Partial<AiStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /** Turns AI on at startup if the user enabled it before. */
  init() {
    if (readSetting()) this.enable()
  }

  /** Turns on both models: embeddings (search, suggestions) and the category model (D13). */
  enable() {
    writeSetting(true)
    void llm.enable()
    if (this.status.state === 'loading' || this.status.state === 'ready') return
    this.setStatus({ state: 'loading', progress: 0, error: '' })
    this.worker ??= this.createWorker()
    this.send({ type: 'load', model: MODEL_ID })
  }

  disable() {
    writeSetting(false)
    llm.disable()
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new Error('AI kapatıldı'))
    this.pending.clear()
    this.setStatus({ state: 'off', progress: 0, error: '' })
  }

  /** Forget vectors held in memory (e.g. on logout). */
  clearMemory() {
    this.memory.clear()
  }

  private createWorker() {
    const w = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      if (m.type === 'progress') this.setStatus({ progress: m.total ? m.loaded / m.total : 0 })
      else if (m.type === 'ready') this.setStatus({ state: 'ready', progress: 1 })
      else if (m.type === 'vectors') {
        this.pending.get(m.id)?.resolve(m.vectors)
        this.pending.delete(m.id)
      } else if (m.type === 'error') {
        if (m.id !== undefined) {
          this.pending.get(m.id)?.reject(new Error(m.message))
          this.pending.delete(m.id)
        } else this.setStatus({ state: 'error', error: m.message })
      }
    }
    w.onerror = (e) => this.setStatus({ state: 'error', error: e.message || 'AI modeli yüklenemedi' })
    return w
  }

  private send(msg: WorkerRequest) {
    this.worker?.postMessage(msg)
  }

  private run(texts: string[]): Promise<Float32Array[]> {
    if (!this.worker) return Promise.reject(new Error('AI kapalı'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ type: 'embed', id, model: MODEL_ID, texts })
    })
  }

  /** Vector for a search query or a new note being classified (never stored). */
  async embedQuery(text: string): Promise<Float32Array> {
    const key = `query: ${text}`
    const hit = this.memory.get(key)
    if (hit) return hit
    const [v] = await this.run([key])
    this.memory.set(key, v)
    return v
  }

  /** Vectors for stored texts (notes, folder names). `persist[i]` allows disk caching. */
  async embedPassages(texts: string[], persist: boolean[]): Promise<Float32Array[]> {
    const keys = texts.map((t) => `passage: ${t}`)
    const out: (Float32Array | undefined)[] = keys.map((k) => this.memory.get(k))

    // 1) disk cache for persistable misses
    const diskIdx = out.flatMap((v, i) => (!v && persist[i] ? [i] : []))
    if (diskIdx.length) {
      const hashes = await Promise.all(diskIdx.map((i) => diskKey(keys[i])))
      const found = await idbGetMany(hashes)
      diskIdx.forEach((i, j) => {
        const v = found[j]
        if (v) {
          out[i] = v
          this.memory.set(keys[i], v)
        }
      })
    }

    // 2) compute the rest in batches
    const missing = out.flatMap((v, i) => (v ? [] : [i]))
    const toStore: [string, Float32Array][] = []
    for (let b = 0; b < missing.length; b += BATCH) {
      const idx = missing.slice(b, b + BATCH)
      const vecs = await this.run(idx.map((i) => keys[i]))
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j]
        out[i] = vecs[j]
        this.memory.set(keys[i], vecs[j])
        if (persist[i]) toStore.push([await diskKey(keys[i]), vecs[j]])
      }
    }
    if (toStore.length) void idbPutMany(toStore)
    return out as Float32Array[]
  }
}

export const ai = new AiEngine()

// ---- settings ----

function readSetting(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) === '1'
  } catch {
    return false
  }
}

function writeSetting(on: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, on ? '1' : '0')
  } catch {
    /* private mode: setting just isn't remembered */
  }
}

// ---- IndexedDB vector cache ----

async function diskKey(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${MODEL_ID}|${hex}`
}

let dbPromise: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open('notex-ai', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('vectors')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function idbGetMany(keys: string[]): Promise<(Float32Array | undefined)[]> {
  const d = await db()
  if (!d) return keys.map(() => undefined)
  return new Promise((resolve) => {
    const store = d.transaction('vectors').objectStore('vectors')
    const out: (Float32Array | undefined)[] = []
    let left = keys.length
    keys.forEach((k, i) => {
      const r = store.get(k)
      r.onsuccess = () => {
        out[i] = r.result instanceof Float32Array ? r.result : undefined
        if (--left === 0) resolve(out)
      }
      r.onerror = () => {
        if (--left === 0) resolve(out)
      }
    })
  })
}

async function idbPutMany(entries: [string, Float32Array][]) {
  const d = await db()
  if (!d) return
  const store = d.transaction('vectors', 'readwrite').objectStore('vectors')
  for (const [k, v] of entries) store.put(v, k)
}
