import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { isOutdated, VERSION, versionDetail } from '../lib/version'
import { showToast } from '../state/toast'

/**
 * The version at the foot of the page. It also asks the server on load and
 * whenever the tab regains focus: if a deploy happened while the tab was
 * open, it offers to reload, because an old page keeps talking to the new
 * server otherwise.
 */
export default function VersionTag() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let told = false
    const check = async () => {
      if (document.hidden) return
      try {
        const h = await api.health()
        if (!isOutdated(h.version)) return
        setStale(true)
        if (told) return
        told = true
        showToast({ message: 'Yeni sürüm yayında.', actions: [{ label: 'Yenile', run: () => location.reload() }] })
      } catch {
        /* offline or waking up: ask again next time */
      }
    }
    void check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  return (
    <footer className="version-tag" title={versionDetail()}>
      Notex {VERSION.name}
      {stale && (
        <>
          {' · '}
          <button className="link" onClick={() => location.reload()}>yeni sürüm var, yenile</button>
        </>
      )}
    </footer>
  )
}
