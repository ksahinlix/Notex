// Runs the embedding model in a Web Worker so the UI never freezes.
// The model files are downloaded once from Hugging Face and then cached by
// the browser (Cache API), so later visits load it from disk.

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse } from './protocol'

env.allowLocalModels = false

let extractor: Promise<FeatureExtractionPipeline> | null = null
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

function load(model: string) {
  // Sum progress over all model files (config, tokenizer, weights).
  const files = new Map<string, { loaded: number; total: number }>()
  extractor ??= pipeline('feature-extraction', model, {
    dtype: 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      post({ type: 'progress', loaded, total })
    },
  }) as Promise<FeatureExtractionPipeline>
  return extractor
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load(msg.model)
      post({ type: 'ready' })
    } else {
      const ext = await load(msg.model)
      const out = await ext(msg.texts, { pooling: 'mean', normalize: true })
      const dim = out.dims[1]
      const data = out.data as Float32Array
      const vectors = msg.texts.map((_, i) => data.slice(i * dim, (i + 1) * dim))
      post({ type: 'vectors', id: msg.id, vectors }, vectors.map((v) => v.buffer))
    }
  } catch (err) {
    extractor = null // allow a retry
    post({ type: 'error', id: msg.type === 'embed' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) })
  }
}
