import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { applyTheme, loadTheme, nextTheme, saveTheme, THEME_LABELS, type Theme } from '../lib/theme'

const ICONS = { system: Monitor, light: Sun, dark: Moon }

/** Header button that cycles Sistem → Açık → Koyu. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const Icon = ICONS[theme]
  const next = nextTheme(theme)
  const label = `Tema: ${THEME_LABELS[theme]} (${THEME_LABELS[next]} için tıkla)`
  return (
    <button
      className="btn btn-ghost"
      title={label}
      aria-label={label}
      onClick={() => {
        applyTheme(next)
        saveTheme(next)
        setTheme(next)
      }}
    >
      <Icon size={14} />
    </button>
  )
}
