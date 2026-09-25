import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
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
  const [show, setShow] = useState(false)
  const isSet = request.mode === 'set'
  const parts = request.pathKey.split('/')

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
    <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && store.cancelPassword()}>
      <form className="card modal" onSubmit={submit} aria-labelledby="pw-title">
        <div className="pw-head">
          <span className="pw-icon"><Lock size={22} /></span>
          <div style={{ minWidth: 0 }}>
            {parts.length > 1 && <div className="pw-crumb">{parts.slice(0, -1).join(' › ')} ›</div>}
            <h2 className="pw-title" id="pw-title">{parts[parts.length - 1]}</h2>
          </div>
        </div>
        <div className="hint">
          {isSet ? (
            <>Bu klasördeki notlar şifrelenecek. Şifre hiçbir yerde saklanmaz; unutursan notlar <b>kurtarılamaz</b>.</>
          ) : (
            <>Bu klasör kilitli. Şifre bu cihazdan çıkmaz.</>
          )}
        </div>
        <label className="pw-label" htmlFor="pw-input">{isSet ? 'Yeni şifre' : 'Klasör şifresi'}</label>
        <div className="pw-field">
          <input id="pw-input" type={show ? 'text' : 'password'} autoFocus autoComplete={isSet ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="icon-btn pw-show" aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'} onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {isSet && (
          <>
            <label className="pw-label" htmlFor="pw-repeat">Şifre (tekrar)</label>
            <input id="pw-repeat" type={show ? 'text' : 'password'} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => store.cancelPassword()}>Vazgeç</button>
          <button className="btn btn-primary" disabled={!password || busy}>{busy ? 'Bekle...' : isSet ? 'Şifrele' : 'Kilidi aç'}</button>
        </div>
      </form>
    </div>
  )
}
