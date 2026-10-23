import { useCallback, useState } from 'react'

// UI theme (dark / light). Apps are dark by default (the brand); light mode is
// an opt-in that reverses the surface ramp and flips the design tokens in
// styles.css. The chosen theme is a `data-theme` attribute on <html> that the
// CSS keys on, and it's persisted so it survives reloads. Apply it before React
// renders so there's no post-mount repaint.
//
// The storage key is the caller's, so two apps on one origin (ArduConfigurator
// and another product built on this kit) keep their own choice.

export type Theme = 'dark' | 'light'

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

/** The persisted theme, or 'dark' when unset/unavailable (brand default). */
export function getStoredTheme(storageKey: string): Theme {
  try {
    const saved = window.localStorage.getItem(storageKey)
    return isTheme(saved) ? saved : 'dark'
  } catch {
    return 'dark'
  }
}

/** Reflect a theme onto <html data-theme> and the tab colour, and persist it. */
export function applyTheme(theme: Theme, storageKey: string): void {
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
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Private-mode / storage-disabled: theme still applies for this session.
  }
}

export interface UseThemeResult {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

/** React state around the persisted UI theme. The app applies the initial
 *  theme before render; this keeps React in step and drives the toggle. */
export function useTheme(storageKey: string): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme(storageKey))

  const setTheme = useCallback(
    (next: Theme) => {
      applyTheme(next, storageKey)
      setThemeState(next)
    },
    [storageKey]
  )

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      applyTheme(next, storageKey)
      return next
    })
  }, [storageKey])

  return { theme, toggleTheme, setTheme }
}
