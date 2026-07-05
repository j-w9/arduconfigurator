// UI theme (dark / light). The app is dark by default (its brand); light mode is
// an opt-in that reverses the surface ramp and flips the design tokens. The
// chosen theme is a `data-theme` attribute on <html> that the CSS keys on, and
// it's persisted so it survives reloads. Applied from main.tsx before React
// renders so there's no post-mount repaint.

export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'arduconfig.theme'

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

/** The persisted theme, or 'dark' when unset/unavailable (brand default). */
export function getStoredTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(saved) ? saved : 'dark'
  } catch {
    return 'dark'
  }
}

/** Reflect a theme onto <html data-theme> and the tab colour, and persist it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  // Native form controls / scrollbars follow this.
  root.style.colorScheme = theme
  // Keep the mobile browser chrome in step with the app background.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#eef1f5' : '#0b1014')
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private-mode / storage-disabled: theme still applies for this session.
  }
}
