import { afterEach, describe, expect, it, vi } from 'vitest'

import { LogServerError, login, normalizeServerUrl, uploadLog } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SESSION = {
  serverUrl: 'https://logs.example.com',
  username: 'jordan',
  token: 'token-abc',
  expiresAtMs: Date.now() + 60_000
}

describe('normalizeServerUrl', () => {
  it('accepts what an operator actually types', () => {
    expect(normalizeServerUrl('https://logs.example.com/')).toBe('https://logs.example.com')
    expect(normalizeServerUrl('  https://logs.example.com  ')).toBe('https://logs.example.com')
    expect(normalizeServerUrl('http://logs.example.com')).toBe('http://logs.example.com')
  })

  it('assumes https for a bare public host', () => {
    expect(normalizeServerUrl('logs.example.com')).toBe('https://logs.example.com')
  })

  it('assumes http for a private address, where a self-hosted box may have no certificate', () => {
    // Guessing https on a LAN box fails with a TLS error that reads as "the
    // server is down", which sends the operator debugging the wrong thing.
    expect(normalizeServerUrl('192.168.1.50:8099')).toBe('http://192.168.1.50:8099')
    expect(normalizeServerUrl('10.0.0.4:8099')).toBe('http://10.0.0.4:8099')
    expect(normalizeServerUrl('172.16.5.5')).toBe('http://172.16.5.5')
    expect(normalizeServerUrl('localhost:8099')).toBe('http://localhost:8099')
    expect(normalizeServerUrl('127.0.0.1:8099')).toBe('http://127.0.0.1:8099')
  })

  it('does not mistake a public host that merely starts with a private-looking number', () => {
    expect(normalizeServerUrl('172.32.0.1')).toBe('https://172.32.0.1')
    expect(normalizeServerUrl('100.64.0.1')).toBe('https://100.64.0.1')
  })

  it('refuses an empty address with something actionable', () => {
    expect(() => normalizeServerUrl('   ')).toThrow(/Enter the address/)
  })
})

describe('login', () => {
  it('sends a normalised username and returns a session', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 't', username: 'jordan', expiresInMs: 1000 }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const session = await login('logs.example.com', '  Jordan  ', 'pw')
    expect(session.serverUrl).toBe('https://logs.example.com')
    expect(session.username).toBe('jordan')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://logs.example.com/api/login')
    // Trimmed and lowercased before it goes out, so "Jordan " and "jordan" are
    // the same account rather than a confusing "incorrect password".
    expect(JSON.parse(init.body as string)).toEqual({ username: 'jordan', password: 'pw' })
  })

  it("surfaces the server's own message on a rejected sign-in", async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'Incorrect username or password.' }), { status: 401 })
    )
    await expect(login('logs.example.com', 'jordan', 'nope')).rejects.toThrow(/Incorrect username or password/)
  })

  it('turns an unreachable server into advice, not "Failed to fetch"', async () => {
    // A blocked, refused or DNS-failed cross-origin fetch all arrive as the same
    // opaque TypeError, so the message has to name the likely causes itself.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(login('logs.example.com', 'jordan', 'pw')).rejects.toThrow(/Check the address/)
  })

  it('rejects a 200 from something that is not a log server', async () => {
    // Pointing this at a random site would otherwise "succeed" and then fail
    // mysteriously at upload time.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }))
    await expect(login('example.com', 'jordan', 'pw')).rejects.toThrow(/not like a log server/)
  })
})

describe('uploadLog', () => {
  it('reserves with metadata, then sends the bytes to the returned id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (url.endsWith('/api/logs')) {
          return new Response(JSON.stringify({ id: 'log-1' }), { status: 201 })
        }
        return new Response(JSON.stringify({ id: 'log-1', sizeBytes: 4 }), { status: 200 })
      })
    )

    const result = await uploadLog(
      SESSION,
      { fileName: '00000023.BIN', flightDate: '2026-08-08', note: 'windy', vehicle: 'ArduCopter', onboardLogId: 23 },
      Uint8Array.from([1, 2, 3, 4])
    )

    expect(result).toEqual({ id: 'log-1', sizeBytes: 4 })
    expect(calls[0].url).toBe('https://logs.example.com/api/logs')
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ fileName: '00000023.BIN', onboardLogId: 23 })
    expect(calls[1].url).toBe('https://logs.example.com/api/logs/log-1/content')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer token-abc')
  })

  it('sends only the log, not the whole backing buffer behind a subarray', async () => {
    // Log bytes routinely arrive as a view into a larger read buffer. Sending
    // the view directly would upload the entire buffer.
    let sentLength = -1
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/logs')) {
        return new Response(JSON.stringify({ id: 'log-1' }), { status: 201 })
      }
      sentLength = (init.body as Uint8Array).byteLength
      return new Response(JSON.stringify({ id: 'log-1', sizeBytes: sentLength }), { status: 200 })
    })

    const backing = new Uint8Array(1024)
    const slice = backing.subarray(0, 8)
    await uploadLog(SESSION, { fileName: 'a.BIN' }, slice)
    expect(sentLength).toBe(8)
  })

  it('names an expired session rather than reporting a generic refusal', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 }))
    await expect(uploadLog(SESSION, { fileName: 'a.BIN' }, new Uint8Array(1))).rejects.toThrow(/session expired/i)
  })

  it('reports the server message when the content upload is refused', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/api/logs')
        ? new Response(JSON.stringify({ id: 'log-1' }), { status: 201 })
        : new Response(JSON.stringify({ error: 'Log exceeds the 512 MB limit.' }), { status: 400 })
    )
    await expect(uploadLog(SESSION, { fileName: 'a.BIN' }, new Uint8Array(1))).rejects.toThrow(/512 MB/)
  })

  it('carries the HTTP status on the error, so callers can branch on 401', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 }))
    await expect(uploadLog(SESSION, { fileName: 'a.BIN' }, new Uint8Array(1))).rejects.toMatchObject({
      name: 'LogServerError',
      status: 401
    })
    expect(new LogServerError('x', 0).status).toBe(0)
  })
})
