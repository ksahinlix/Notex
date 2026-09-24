import { useEffect, useState } from 'react'
import { Check, Users, X } from 'lucide-react'
import { inviteTokenFrom, pending } from '../lib/sharing'
import type { Share } from '../lib/types'
import { store } from '../state/store'
import { showToast } from '../state/toast'

/**
 * Invitations waiting for you (D18): the ones addressed to your e-mail, and
 * the one in an invite link you opened (/davet/<token>). Nothing is shared
 * until you accept here.
 */
export default function InviteBanner({ invites }: { invites: Share[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const waiting = pending(invites)

  // An invite link accepts as soon as the page is open and you are signed in.
  useEffect(() => {
    const token = inviteTokenFrom(location)
    if (!token) return
    history.replaceState(null, '', '/')
    void (async () => {
      const res = await store.acceptInvite({ token })
      if ('error' in res) setError(res.error)
      else showToast({ message: `“${res.share.path.join(' / ')}” klasörü artık sende.` })
    })()
  }, [])

  if (!waiting.length && !error) return null
  return (
    <>
      {error && (
        <div className="banner-error invite-banner">
          {error}
          <button className="icon-btn" onClick={() => setError('')} aria-label="Kapat"><X size={14} /></button>
        </div>
      )}
      {waiting.map((s) => (
        <section key={s.id} className="reminders invite-banner">
          <Users size={13} />
          <span className="ellipsis">
            <b>{s.owner?.name || s.owner?.email}</b> “{s.path.join(' / ')}” klasörünü seninle paylaştı.
          </span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const res = await store.acceptInvite({ id: s.id })
              setBusy(false)
              if ('error' in res) setError(res.error)
              else showToast({ message: 'Klasör eklendi.' })
            }}
          >
            <Check size={14} /> Kabul et
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void store.unshare(s.id)}>
            Yoksay
          </button>
        </section>
      ))}
    </>
  )
}
