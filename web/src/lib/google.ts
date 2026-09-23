// Loads Google Identity Services ("Sign in with Google") on demand (D16).
// Only the login screen uses it; the rest of the app never loads it.

interface GoogleId {
  initialize(config: {
    client_id: string
    callback: (response: { credential: string }) => void
    auto_select?: boolean
    use_fedcm_for_prompt?: boolean
  }): void
  renderButton(
    el: HTMLElement,
    options: { theme?: string; size?: string; text?: string; shape?: string; locale?: string; width?: number },
  ): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let loading: Promise<GoogleId> | null = null

export function loadGoogleIdentity(): Promise<GoogleId> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id)
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google script failed')))
    s.onerror = () => {
      loading = null // allow a retry
      reject(new Error('Google script failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** After logout: don't sign the same account in again automatically. */
export function googleSignedOut() {
  window.google?.accounts?.id?.disableAutoSelect()
}
