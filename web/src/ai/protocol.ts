// Messages between the app and the embedding worker.

export type WorkerRequest =
  | { type: 'load'; model: string }
  | { type: 'embed'; id: number; model: string; texts: string[] }

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'vectors'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id?: number; message: string }
