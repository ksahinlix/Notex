// Light/dark theme. "system" follows the device; "light" and "dark" are the
// user's choice, remembered per browser. index.html applies the saved choice
// before the page draws (no white flash), so keep its inline script in sync
// with STORAGE_KEY and applyTheme.

export type Theme = 'system' | 'light' | 'dark'

export const THEMES: Theme[] = ['system', 'light', 'dark']
export const THEME_LABELS: Record<Theme, string> = { system: 'Sistem', light: 'Açık', dark: 'Koyu' }
const STORAGE_KEY = 'notex-theme'

/** The theme after this one, for the header's cycle button. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
}

export function parseTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'system' // no storage (private mode)
  }
}

export function saveTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

/** Sets data-theme on <html>; the CSS picks colors from it. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/** Whether the page is dark right now (the choice, or the device when "system"). */
export function isDark(theme: Theme = loadTheme()): boolean {
  if (theme !== 'system') return theme === 'dark'
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}
