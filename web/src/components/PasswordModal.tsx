import { useState, type FormEvent } from 'react'
import { store, type PasswordRequest } from '../state/store'

export default function PasswordModal({ request }: { request: PasswordRequest | null }) {
  if (!request) return null
  // key: fresh form state for every request
  return <Form key={request.mode + request.pathKey} request={request} />
}

function Form({ request }: { request: PasswordRequest }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isSet = request.mode === 'set'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (isSet && password.length < 6) return setError('Şifre en az 6 karakter olmalı.')
    if (isSet && password !== repeat) return setError('Şifreler aynı değil.')
    setBusy(true)
    setError('')
    const err = await store.submitPassword(password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && store.cancelPassword()}>
      <form className="card modal" onSubmit={submit}>
        <div className="modal-title">{isSet ? 'Klasörü şifreyle koru' : 'Şifre gerekli'}</div>
        <div className="muted">{request.pathKey.split('/').join(' / ')}</div>
        <input type="password" autoFocus placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} />
        {isSet && <input type="password" placeholder="Şifre (tekrar)" value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        {isSet && (
          <div className="hint">
            Bu şifre hiçbir yerde saklanmaz. Unutursan bu klasördeki notlar <b>kurtarılamaz</b>.
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => store.cancelPassword()}>İptal</button>
          <button className="btn btn-primary" disabled={!password || busy}>{busy ? 'Bekle...' : isSet ? 'Koru' : 'Aç'}</button>
        </div>
      </form>
    </div>
  )
}
