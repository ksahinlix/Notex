// Which build of the app is running (baked in by vite.config.ts) and whether
// the server has since deployed a newer one.
//
// `name` is the number to read, from web/package.json: major.minor.patch,
// bumped with every deploy. `commit` identifies the build exactly and is what
// the comparison uses, so a forgotten bump can never hide a new deploy.

declare const __APP_VERSION__: { name: string; commit: string; builtAt: string }

export interface BuildInfo {
  name: string
  commit: string
  builtAt: string
}

export const VERSION: BuildInfo =
  typeof __APP_VERSION__ === 'undefined' ? { name: 'v0.0.0', commit: 'dev', builtAt: '' } : __APP_VERSION__

/** "v1.0.3 · a1b2c3d · 24 Eyl 15:40", for the tooltip. */
export function versionDetail(v: BuildInfo = VERSION): string {
  const when = v.builtAt ? new Date(v.builtAt) : null
  const time = when && !Number.isNaN(when.getTime()) ? when.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  return [v.name, v.commit, time].filter(Boolean).join(' · ')
}

/**
 * True when the server runs a different build than this page, i.e. something
 * was deployed while the tab was open. Unknown versions ("dev", empty) never
 * count, so local development doesn't nag.
 */
export function isOutdated(serverCommit: string | undefined, v: BuildInfo = VERSION): boolean {
  if (!serverCommit || serverCommit === 'dev' || v.commit === 'dev') return false
  return serverCommit !== v.commit
}
