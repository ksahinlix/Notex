// Which build of the app is running (set in vite.config.ts at build time) and
// whether the server has since deployed a newer one.

declare const __APP_VERSION__: { commit: string; builtAt: string }

export const VERSION: { commit: string; builtAt: string } =
  typeof __APP_VERSION__ === 'undefined' ? { commit: 'dev', builtAt: '' } : __APP_VERSION__

/** "a1b2c3d · 24 Eyl 15:40" — short, for the corner of the page. */
export function versionLabel(v = VERSION): string {
  if (!v.builtAt) return v.commit
  const d = new Date(v.builtAt)
  if (Number.isNaN(d.getTime())) return v.commit
  return `${v.commit} · ${d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

/**
 * True when the server runs a different build than this page, i.e. something
 * was deployed while the tab was open. Unknown versions ("dev", empty) never
 * count, so local development doesn't nag.
 */
export function isOutdated(serverCommit: string | undefined, v = VERSION): boolean {
  if (!serverCommit || serverCommit === 'dev' || v.commit === 'dev') return false
  return serverCommit !== v.commit
}
