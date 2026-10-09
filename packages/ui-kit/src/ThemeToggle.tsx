import type { ReactElement } from 'react'

import type { Theme } from './theme.js'

/** The square sun/moon button that flips the theme. Styled by
 *  `.app-header__theme-toggle` in this package's styles.css. */
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }): ReactElement {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button
      type="button"
      className="app-header__theme-toggle"
      data-testid="theme-toggle"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === 'light'}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  )
}
