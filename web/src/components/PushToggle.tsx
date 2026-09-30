import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, Loader2, Send } from 'lucide-react'
import { api } from '../lib/api'
import { currentState, disable, enable, pushLabel, type PushState } from '../lib/push'
import { showToast } from '../state/toast'

/**
 * Turns reminder notifications on for this browser (D21). Each device decides
 * for itself, so the button reads the state from the browser rather than the
 * account.
 */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    // Never leave the button missing because a check failed.
    void currentState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState('off'))
    return () => {
      alive = false
    }
  }, [])

  if (!state || state === 'unsupported') return null
  const { text, hint, can } = pushLabel(state)
  const on = state === 'on'

  return (
    <div className="push-tools">
    <button
      className={`btn btn-ghost push-toggle ${on ? 'on' : ''}`}
      title={hint}
      aria-pressed={on}
      disabled={busy || !can}
      onClick={async () => {
        setBusy(true)
        try {
          const next = on ? await disable() : await enable()
          setState(next)
          if (next === 'on') showToast({ message: 'Bu cihaza hatırlatma bildirimi gelecek.' })
          else if (next === 'denied') showToast({ message: pushLabel(next).hint, error: true })
          else if (!on && next === 'off') showToast({ message: 'Bildirim izni verilmedi.' })
        } catch {
          showToast({ message: 'Bildirimler açılamadı. Tekrar dene.', error: true })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 size={16} className="spin" /> : on ? <BellRing size={16} /> : can ? <Bell size={16} /> : <BellOff size={16} />}
      {text}
    </button>
    {on && (
      // Sent from the server, exactly like a reminder: if this never appears,
      // the notification was delivered and the system is hiding it.
      <button
        className="btn btn-ghost"
        title="Bu cihaza şimdi bir deneme bildirimi gönderir."
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const { sent } = await api.pushTest()
            showToast({
              message: sent
                ? `${sent} cihaza gönderildi. Birkaç saniye içinde görünmezse bildirim ayarlarını kontrol et.`
                : 'Kayıtlı cihaz bulunamadı. Bildirimleri kapatıp yeniden aç.',
              error: !sent,
            })
          } catch {
            showToast({ message: 'Deneme bildirimi gönderilemedi.', error: true })
          } finally {
            setBusy(false)
          }
        }}
      >
        <Send size={15} /> Deneme gönder
      </button>
    )}
    </div>
  )
}
