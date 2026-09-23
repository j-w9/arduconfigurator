// The UI theme lives in @arduconfig/ui-kit; this binds it to ArduConfigurator's
// storage key, which is unchanged so a saved choice survives the move.

import { applyTheme as applyKitTheme, getStoredTheme as getKitStoredTheme, type Theme } from '@arduconfig/ui-kit'

export { isTheme, type Theme } from '@arduconfig/ui-kit'

export const THEME_STORAGE_KEY = 'arduconfig.theme'

/** The persisted theme, or 'dark' when unset/unavailable (brand default). */
export function getStoredTheme(): Theme {
  return getKitStoredTheme(THEME_STORAGE_KEY)
}

/** Reflect a theme onto <html data-theme> and the tab colour, and persist it. */
export function applyTheme(theme: Theme): void {
  applyKitTheme(theme, THEME_STORAGE_KEY)
}
