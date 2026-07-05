import { useCallback, useState } from 'react'

import { applyTheme, getStoredTheme, type Theme } from '../theme'

export interface UseThemeResult {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

/** React state around the persisted UI theme. main.tsx applies the initial
 *  theme before render; this keeps React in step and drives the toggle. */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  return { theme, toggleTheme, setTheme }
}
