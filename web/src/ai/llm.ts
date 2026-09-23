// On-device generative model that creates categories for new notes (D13).
//
// Gemma-2-2B via WebLLM (WebGPU). It answers "what is this note about?" and
// returns a folder path. It sees the existing folders so it reuses them.
// Tested prompt and model comparison: docs/PROJECT_LOG.md (D13).
// Without WebGPU the app falls back to embedding suggestions (D12).

import type { MLCEngineInterface } from '@mlc-ai/web-llm'

export const LLM_MODEL = 'gemma-2-2b-it-q4f16_1-MLC'
/** Same model for GPUs without 16-bit float support. */
const LLM_MODEL_F32 = 'gemma-2-2b-it-q4f32_1-MLC'
export const LLM_SIZE_GB = 1.5
/** At most this many existing folders are shown to the model (keeps the prompt short). */
const MAX_FOLDERS_IN_PROMPT = 80

export interface LlmStatus {
  state: 'off' | 'unsupported' | 'loading' | 'ready' | 'error'
  progress: number
  error: string
}

export const SYSTEM_PROMPT = `Sen bir not uygulamasında notları konularına göre klasörlere ayıran asistansın.
Notun NE HAKKINDA olduğunu belirle ve ona genel bir klasör yolu ver: "Ana kategori / Alt kategori".

Kurallar:
- Genelde 2 seviye. Her ad 1-2 kelime, Türkçe, baş harfi büyük.
- Adlar genel ve tekrar kullanılabilir olsun: aynı konudaki başka notlar da oraya gidebilmeli.
- Notun kendisini, kişi adlarını, tarihleri ya da saatleri klasör adı yapma.
- Sana MEVCUT KLASÖRLER listesi verilir. Notun konusu bunlardan biriyle AYNI konuysa o yolu aynen kullan. Sadece benzer kategoride ama farklı konuysa (ör. Market ile Temizlik, Randevu ile İlaçlar) yeni alt klasör aç. Hiçbiri uymuyorsa yeni yol oluştur.

Örnekler:
"Pazartesi 9'da haftalık ekip toplantısı" -> {"konu":"iş toplantısı","path":["İş","Toplantılar"]}
"Dune 2 izlenecek" -> {"konu":"izlenecek film","path":["Eğlence","İzlenecekler"]}
"Mercimek çorbası tarifi" -> {"konu":"yemek tarifi","path":["Yemek","Tarifler"]}
"Kira 12.000 TL ödendi" -> {"konu":"ev gideri","path":["Finans","Faturalar"]}
"Çamaşır makinesi su kaçırıyor" -> {"konu":"ev arızası","path":["Ev","Tamirat"]}
"Tansiyon ilacını akşam al" -> {"konu":"sağlık","path":["Sağlık","İlaçlar"]}
"Antalya uçak bileti 3 Temmuz" -> {"konu":"seyahat planı","path":["Seyahat","Planlar"]}
"React'te useMemo ne zaman kullanılır" -> {"konu":"yazılım bilgisi","path":["Yazılım","React"]}
"Kahve, şeker, çay alınacak" -> {"konu":"market alışverişi","path":["Alışveriş","Market"]}
"Sapiens kitabı okunacak" -> {"konu":"okunacak kitap","path":["Kitaplar","Okunacaklar"]}`

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { konu: { type: 'string' }, path: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 } },
  required: ['konu', 'path'],
})

export function userPrompt(text: string, folders: string[][]): string {
  const list = folders.slice(0, MAX_FOLDERS_IN_PROMPT).map((p) => '- ' + p.join(' / ')).join('\n') || '(yok)'
  return `MEVCUT KLASÖRLER:\n${list}\n\nNot: ${JSON.stringify(text.slice(0, 600))}`
}

/**
 * Cleans the model's path: trims, capitalizes, drops repeated segments
 * ("Kitaplar / Kitaplar") and reuses the exact spelling of an existing
 * folder when only the letter case differs.
 */
export function cleanPath(raw: unknown, folders: string[][]): string[] | null {
  if (!Array.isArray(raw)) return null
  const low = (s: string) => s.toLocaleLowerCase('tr')
  const segs: string[] = []
  for (const r of raw) {
    let s = String(r).replace(/[/\\"“”]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!s || s.length > 40) continue
    s = s.charAt(0).toLocaleUpperCase('tr') + s.slice(1)
    if (segs.length && low(segs[segs.length - 1]) === low(s)) continue
    segs.push(s)
  }
  if (!segs.length) return null
  // Match existing spelling prefix by prefix.
  for (let i = 0; i < segs.length; i++) {
    const prefix = segs.slice(0, i).map(low).join('/')
    for (const f of folders) {
      if (f.length > i && f.slice(0, i).map(low).join('/') === prefix && low(f[i]) === low(segs[i])) {
        segs[i] = f[i]
        break
      }
    }
  }
  return segs
}

async function gpuSupport(): Promise<'f16' | 'f32' | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
  if (!gpu) return null
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return null
    return adapter.features.has('shader-f16') ? 'f16' : 'f32'
  } catch {
    return null
  }
}

type Job = { text: string; folders: string[][]; resolve: (p: string[] | null) => void }

class Llm {
  private status: LlmStatus = { state: 'off', progress: 0, error: '' }
  private listeners = new Set<() => void>()
  private engine: MLCEngineInterface | null = null
  private worker: Worker | null = null
  private running = false
  private next: Job | null = null

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.status

  private set(patch: Partial<LlmStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  async enable() {
    if (this.status.state === 'loading' || this.status.state === 'ready') return
    const support = await gpuSupport()
    if (!support) return this.set({ state: 'unsupported', error: 'Bu tarayıcı/cihaz WebGPU desteklemiyor' })
    this.set({ state: 'loading', progress: 0, error: '' })
    try {
      // Loaded only when AI is turned on, so the main bundle stays small.
      const webllm = await import('@mlc-ai/web-llm')
      this.worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
      this.engine = await webllm.CreateWebWorkerMLCEngine(this.worker, support === 'f16' ? LLM_MODEL : LLM_MODEL_F32, {
        // IndexedDB avoids a Cache API race in WebLLM ("Entry already exists").
        appConfig: { ...webllm.prebuiltAppConfig, cacheBackend: 'indexeddb' },
        initProgressCallback: (p) => this.set({ progress: p.progress }),
      })
      // AI may have been turned off while the model was loading.
      const current = this.status.state as LlmStatus['state']
      if (current === 'loading') this.set({ state: 'ready', progress: 1 })
      else this.cleanup()
    } catch (e) {
      this.cleanup()
      this.set({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  disable() {
    this.cleanup()
    this.next?.resolve(null)
    this.next = null
    this.set({ state: 'off', progress: 0, error: '' })
  }

  private cleanup() {
    void this.engine?.unload().catch(() => {})
    this.worker?.terminate()
    this.engine = null
    this.worker = null
  }

  /**
   * Suggests a folder path for `text`. If a newer request arrives while one is
   * running, only the newest is processed (older ones resolve to null).
   */
  classify(text: string, folders: string[][]): Promise<string[] | null> {
    return new Promise((resolve) => {
      this.next?.resolve(null)
      this.next = { text, folders, resolve }
      void this.pump()
    })
  }

  private async pump() {
    if (this.running || !this.next) return
    const job = this.next
    this.next = null
    this.running = true
    try {
      if (!this.engine || this.status.state !== 'ready') return job.resolve(null)
      const r = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(job.text, job.folders) },
        ],
        temperature: 0,
        max_tokens: 80,
        response_format: { type: 'json_object', schema: SCHEMA },
      })
      const raw = (r.choices[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      job.resolve(cleanPath(JSON.parse(raw).path, job.folders))
    } catch {
      job.resolve(null)
    } finally {
      this.running = false
      void this.pump()
    }
  }
}

export const llm = new Llm()
