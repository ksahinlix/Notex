import { LoaderCircle, Sparkles } from 'lucide-react'
import { ai, MODEL_SIZE_MB, type AiStatus } from '../ai/engine'

// Header button: turns on-device AI on/off and shows download progress.
export default function AiToggle({ status }: { status: AiStatus }) {
  const { state, progress, error } = status

  function click() {
    if (state === 'ready' || state === 'loading') return ai.disable()
    const ok = confirm(
      `AI özellikleri açılsın mı?\n\n` +
        `• Anlamına göre arama ve not yazarken klasör önerisi\n` +
        `• Model (~${MODEL_SIZE_MB} MB) bir kez indirilir, sonra cihazında çalışır\n` +
        `• Notların hiçbir yere gönderilmez`,
    )
    if (ok) ai.enable()
  }

  const title =
    state === 'ready' ? 'AI açık — kapatmak için tıkla'
    : state === 'loading' ? 'AI modeli indiriliyor — iptal etmek için tıkla'
    : state === 'error' ? `AI yüklenemedi: ${error} — tekrar denemek için tıkla`
    : 'AI özelliklerini aç'

  return (
    <button className={`btn btn-ghost ai-toggle ${state}`} onClick={click} title={title}>
      {state === 'loading' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
      {state === 'loading' ? `AI %${Math.round(progress * 100)}` : state === 'error' ? 'AI hata' : 'AI'}
    </button>
  )
}
