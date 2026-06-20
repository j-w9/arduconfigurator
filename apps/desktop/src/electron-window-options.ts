import type { BrowserWindowConstructorOptions } from 'electron'

export function createDesktopWebPreferences(
  preloadPath: string
): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    preload: preloadPath
  }
}
