import { useEffect, useRef, useState } from 'react'
import { clearAiCaches } from './ai/useAi'
import NotesPage from './components/NotesPage'
import { api, ApiError, UNAUTHORIZED_EVENT, type User } from './lib/api'
import { googleSignedOut, loadGoogleIdentity } from './lib/google'
import { isDark } from './lib/theme'
import { store } from './state/store'

type Status = { state: 'loading' } | { state: 'loggedOut' } | { state: 'loggedIn'; user: User }

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'loading' })

  useEffect(() => {
    api
      .me()
      .then((r) => setStatus(r.authenticated && r.user ? { state: 'loggedIn', user: r.user } : { state: 'loggedOut' }))
      .catch(() => setStatus({ state: 'loggedOut' }))
    const onExpired = () => {
      forgetEverything()
      setStatus({ state: 'loggedOut' })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired)
  }, [])

  async function logout() {
    await api.logout().catch(() => {})
    googleSignedOut()
    forgetEverything()
    setStatus({ state: 'loggedOut' })
  }

  if (status.state === 'loading') return <main className="center muted">Yükleniyor...</main>
  if (status.state === 'loggedOut') return <Login onSuccess={(user) => setStatus({ state: 'loggedIn', user })} />
  return <NotesPage user={status.user} onLogout={logout} />
}

/** Drops the previous user's notes, folder keys and AI answers from memory. */
function forgetEverything() {
  store.reset()
  clearAiCaches()
}

function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { googleClientId } = await api.authConfig()
        if (!googleClientId) return setError('Google ile giriş henüz ayarlanmadı (GOOGLE_CLIENT_ID).')
        const gis = await loadGoogleIdentity()
        if (cancelled || !buttonRef.current) return
        gis.initialize({
          client_id: googleClientId,
          use_fedcm_for_prompt: true,
          callback: async ({ credential }) => {
            setBusy(true)
            setError('')
            try {
              onSuccess((await api.loginGoogle(credential)).user)
            } catch (err) {
              setError(err instanceof ApiError && err.status === 429 ? 'Çok fazla deneme. Biraz bekle.' : 'Google ile giriş yapılamadı. Tekrar dene.')
            } finally {
              setBusy(false)
            }
          },
        })
        gis.renderButton(buttonRef.current, { theme: isDark() ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'tr', width: 260 })
      } catch {
        if (!cancelled) setError('Google girişi yüklenemedi. İnternet bağlantını kontrol et.')
      }
    })()
    return () => {
      cancelled = true
    }
    // Set up Google's button once; onSuccess only moves the app to the notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="center">
      <div className="card login">
        <h1>Notex</h1>
        <p className="muted login-text">Notlarını yaz; yapay zekâ onları klasörlere ayırsın.</p>
        <div ref={buttonRef} className="google-button" />
        {busy && <div className="muted">Giriş yapılıyor...</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </main>
  )
}
