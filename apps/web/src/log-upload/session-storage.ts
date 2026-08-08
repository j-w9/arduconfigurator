// What the browser remembers about the operator's log server.
//
// The rule that shapes this module: THE PASSWORD IS NEVER PERSISTED. Not in
// localStorage, not in sessionStorage, not anywhere. It is used once to obtain
// a token and then dropped. The server address and username are remembered so
// signing back in is two fields and a click.
//
// The token itself goes in sessionStorage rather than localStorage: it survives
// a page refresh mid-upload, and dies when the tab closes. On a shared bench
// machine that is the difference between "signed out when you walked away" and
// "still signed in tomorrow".

import type { LogServerSession } from './client'

const SETTINGS_KEY = 'arduconfig:log-server'
const SESSION_KEY = 'arduconfig:log-server-session'

export interface LogServerSettings {
  serverUrl: string
  username: string
}

export function loadLogServerSettings(): LogServerSettings | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as Partial<LogServerSettings>
    if (typeof parsed.serverUrl !== 'string' || typeof parsed.username !== 'string') {
      return undefined
    }
    return { serverUrl: parsed.serverUrl, username: parsed.username }
  } catch {
    return undefined
  }
}

export function saveLogServerSettings(settings: LogServerSettings): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage disabled or full. Remembering the address is a convenience, so
    // failing to is not worth interrupting the operator over.
  }
}

export function loadLogServerSession(): LogServerSession | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as Partial<LogServerSession>
    if (
      typeof parsed.serverUrl !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.expiresAtMs !== 'number'
    ) {
      return undefined
    }
    // An expired token is worse than none: it would let the UI offer an upload
    // that is certain to fail with a 401.
    if (parsed.expiresAtMs <= Date.now()) {
      window.sessionStorage.removeItem(SESSION_KEY)
      return undefined
    }
    return parsed as LogServerSession
  } catch {
    return undefined
  }
}

export function saveLogServerSession(session: LogServerSession): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    saveLogServerSettings({ serverUrl: session.serverUrl, username: session.username })
  } catch {
    // Same reasoning as above — an in-memory session still works for this tab.
  }
}

export function clearLogServerSession(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing useful to do; the caller has already dropped its in-memory copy.
  }
}
