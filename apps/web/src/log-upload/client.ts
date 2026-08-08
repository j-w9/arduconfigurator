// Client for a self-hosted ArduLogs server (https://github.com/j-w9/ardulogs).
//
// Deliberately standalone: this talks to a server the OPERATOR runs, at an
// address they type in, with credentials they hold. It has nothing to do with
// any other network surface in this app and shares no code with one.
//
// Pure fetch calls, no React — so the request shapes, the URL normalisation and
// the error wording can be unit-tested without a DOM.

export interface LogServerSession {
  /** Normalised base URL, no trailing slash. */
  serverUrl: string
  username: string
  token: string
  /** Epoch ms. The UI warns rather than silently failing an upload. */
  expiresAtMs: number
}

/** What the configurator can fill in for the operator from the live vehicle. */
export interface LogUploadMetadata {
  fileName: string
  flightDate?: string
  note?: string
  vehicle?: string
  firmwareVersion?: string
  boardName?: string
  onboardLogId?: number
}

export class LogServerError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number
  ) {
    super(message)
    this.name = 'LogServerError'
  }
}

/**
 * Accept what an operator actually types.
 *
 * "192.168.1.50:8099", "logs.example.com", "https://logs.example.com/" are all
 * the same server to them. Bare hosts get https:// rather than http://, except
 * for plain private/loopback addresses where a self-hosted box on a LAN
 * genuinely may not have a certificate — guessing https there would fail with a
 * TLS error that reads as "the server is down".
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) {
    throw new LogServerError('Enter the address of your log server.', 0)
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  const host = trimmed.split('/')[0] ?? trimmed
  const isPrivate =
    /^localhost(:\d+)?$/i.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  return `${isPrivate ? 'http' : 'https'}://${trimmed}`
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.length > 0) {
      message = body.error
    }
  } catch {
    // Non-JSON body (a proxy error page, say) — the fallback is more useful
    // than whatever HTML came back.
  }
  throw new LogServerError(message, response.status)
}

/**
 * Turn a failed fetch into something an operator can act on.
 *
 * A cross-origin fetch that is blocked, refused or DNS-fails all surface as the
 * same opaque TypeError, so the message has to name the likely causes rather
 * than repeat "Failed to fetch".
 */
function asNetworkError(error: unknown, serverUrl: string): never {
  if (error instanceof LogServerError) {
    throw error
  }
  throw new LogServerError(
    `Could not reach ${serverUrl}. Check the address, that the server is running, and that it allows requests from this page.`,
    0
  )
}

export async function login(rawServerUrl: string, username: string, password: string): Promise<LogServerSession> {
  const serverUrl = normalizeServerUrl(rawServerUrl)
  let response: Response
  try {
    response = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password })
    })
  } catch (error) {
    asNetworkError(error, serverUrl)
  }
  if (!response.ok) {
    await readError(response, 'Sign-in failed.')
  }
  const body = (await response.json()) as { token?: string; username?: string; expiresInMs?: number }
  if (typeof body.token !== 'string' || typeof body.username !== 'string') {
    throw new LogServerError('That address answered, but not like a log server. Check the URL.', response.status)
  }
  return {
    serverUrl,
    username: body.username,
    token: body.token,
    expiresAtMs: Date.now() + (typeof body.expiresInMs === 'number' ? body.expiresInMs : 24 * 60 * 60 * 1000)
  }
}

export interface UploadProgress {
  phase: 'reading' | 'sending' | 'done'
  /** 0..1 where known. */
  ratio?: number
}

/**
 * Reserve the log with its metadata, then send the bytes.
 *
 * Two steps because it means the (potentially large) body is only ever accepted
 * against an id the server already authorised, and it keeps multipart encoding
 * out of both halves.
 */
export async function uploadLog(
  session: LogServerSession,
  metadata: LogUploadMetadata,
  content: Uint8Array
): Promise<{ id: string; sizeBytes: number }> {
  let created: Response
  try {
    created = await fetch(`${session.serverUrl}/api/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify(metadata)
    })
  } catch (error) {
    asNetworkError(error, session.serverUrl)
  }
  if (created.status === 401) {
    throw new LogServerError('Your session expired. Sign in to the log server again.', 401)
  }
  if (!created.ok) {
    await readError(created, 'The server refused the upload.')
  }
  const { id } = (await created.json()) as { id: string }

  let sent: Response
  try {
    // Copied into a fresh view: a subarray of a larger buffer would otherwise
    // serialize its whole backing store and send far more than the log.
    const body = new Uint8Array(content.byteLength)
    body.set(content)
    sent = await fetch(`${session.serverUrl}/api/logs/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${session.token}` },
      body
    })
  } catch (error) {
    asNetworkError(error, session.serverUrl)
  }
  if (!sent.ok) {
    await readError(sent, 'The log did not upload.')
  }
  const result = (await sent.json()) as { id: string; sizeBytes: number }
  return { id: result.id, sizeBytes: result.sizeBytes }
}
