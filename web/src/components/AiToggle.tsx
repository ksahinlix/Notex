import { LoaderCircle, Sparkles } from 'lucide-react'
import { ai, MODEL_SIZE_MB, type AiStatus } from '../ai/engine'
import { LLM_SIZE_GB, type LlmStatus } from '../ai/llm'

// Header button: turns on-device AI on/off and shows download progress of
// both models: embeddings (search, similar folders) and the category model.
export default function AiToggle({ status, llm }: { status: AiStatus; llm: LlmStatus }) {
  const on = status.state !== 'off'
  const loading = status.state === 'loading' || llm.state === 'loading'
  const failed = status.state === 'error'
  // The category model is ~13x bigger, so it dominates the combined progress.
  const progress = (status.progress * MODEL_SIZE_MB + llm.progress * LLM_SIZE_GB * 1000) / (MODEL_SIZE_MB + LLM_SIZE_GB * 1000)

  function click() {
    if (on) return ai.disable()
    const ok = confirm(
      `AI özellikleri açılsın mı?\n\n` +
        `• Notlarına kendisi kategori oluşturur ve klasör önerir\n` +
        `• Anlamına göre arama yapar\n` +
        `• Modeller (~${LLM_SIZE_GB} GB + ${MODEL_SIZE_MB} MB) bir kez indirilir, sonra cihazında çalışır\n` +
        `• Notların hiçbir yere gönderilmez`,
    )
    if (ok) ai.enable()
  }

  const llmNote =
    llm.state === 'unsupported' ? ' · Kategori modeli bu cihazda çalışmıyor (WebGPU yok); benzer klasör önerileri açık.'
    : llm.state === 'error' ? ` · Kategori modeli yüklenemedi: ${llm.error}`
    : ''
  const title =
    failed ? `AI yüklenemedi: ${status.error} — tekrar denemek için tıkla`
    : loading ? `AI modelleri indiriliyor (%${Math.round(progress * 100)}) — iptal için tıkla${llmNote}`
    : on ? `AI açık — kapatmak için tıkla${llmNote}`
    : 'AI özelliklerini aç'

  return (
    <button className={`btn btn-ghost ai-toggle ${failed ? 'error' : loading ? 'loading' : on ? 'ready' : 'off'} ${llmNote ? 'partial' : ''}`} onClick={click} title={title}>
      {loading ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
      {loading ? `AI %${Math.round(progress * 100)}` : failed ? 'AI hata' : 'AI'}
    </button>
  )
}
