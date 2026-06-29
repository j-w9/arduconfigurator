import assert from 'node:assert/strict'
import test from 'node:test'

import { LogDownloadService, buildOnboardLogFilename } from '../packages/ardupilot-core/dist/index.js'

test('buildOnboardLogFilename tags with a labelled uid + date + log number', () => {
  // timeUtc 1717286400 = 2024-06-02 00:00:00 UTC
  const name = buildOnboardLogFilename({ id: 7, sizeBytes: 1024, timeUtc: 1717286400 }, { uid: '230043000E51323531363232' })
  assert.equal(name, 'uid_230043000E51323531363232_date_20240602-000000_log7.bin')
})

test('buildOnboardLogFilename falls back to a fw_ git-hash tag when uid is missing or all-zero', () => {
  const zero = buildOnboardLogFilename({ id: 3, sizeBytes: 1, timeUtc: 0 }, { uid: '0000000000000000', firmwareGitHash: '3fc7011a' })
  assert.equal(zero, 'fw_3fc7011a_log3.bin')
  const none = buildOnboardLogFilename({ id: 3, sizeBytes: 1, timeUtc: 0 }, { firmwareGitHash: '3fc7011a' })
  assert.equal(none, 'fw_3fc7011a_log3.bin')
})

test('buildOnboardLogFilename uses a generic tag with no identity and omits a zero timestamp', () => {
  assert.equal(buildOnboardLogFilename({ id: 12, sizeBytes: 1, timeUtc: 0 }), 'ardupilot_log12.bin')
})

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }

function createService(overrides = {}) {
  const sent = []
  const service = new LogDownloadService({
    session: {
      send: async (message) => {
        sent.push(message)
      }
    },
    getVehicle: () => VEHICLE,
    requestTimeoutMs: 200,
    ...overrides
  })
  return { service, sent }
}

function logEntry(fields) {
  return { type: 'LOG_ENTRY', timeUtc: 0, size: 0, id: 0, numLogs: 0, lastLogNum: 0, ...fields }
}

function logData(id, ofs, bytes) {
  const data = new Uint8Array(90)
  data.set(bytes, 0)
  return { type: 'LOG_DATA', id, ofs, count: bytes.length, data }
}

test('listLogs requests the list and resolves sorted entries, then ends the session', async () => {
  const { service, sent } = createService()
  const promise = service.listLogs()

  service.handleLogEntry(logEntry({ id: 2, size: 4096, numLogs: 2, timeUtc: 1_700_000_000 }))
  service.handleLogEntry(logEntry({ id: 1, size: 2048, numLogs: 2, timeUtc: 1_699_000_000 }))

  const logs = await promise
  assert.deepEqual(
    logs.map((l) => l.id),
    [1, 2]
  )
  assert.equal(logs[1].sizeBytes, 4096)
  assert.equal(sent[0].type, 'LOG_REQUEST_LIST')
  assert.equal(sent.at(-1).type, 'LOG_REQUEST_END')
})

test('listLogs resolves [] when the FC reports no logs', async () => {
  const { service } = createService()
  const promise = service.listLogs()
  service.handleLogEntry(logEntry({ id: 0, numLogs: 0 }))
  assert.deepEqual(await promise, [])
})

test('downloadLog assembles chunks in order, reports progress, and ends the session', async () => {
  const { service, sent } = createService()
  const progress = []
  const promise = service.downloadLog(7, 135, (p) => progress.push(p.bytesReceived))

  const first = new Uint8Array(90)
  for (let i = 0; i < 90; i += 1) first[i] = i & 0xff
  service.handleLogData({ type: 'LOG_DATA', id: 7, ofs: 0, count: 90, data: first })
  // Short final chunk (count < 90) marks end-of-log.
  service.handleLogData(logData(7, 90, [200, 201, 202]))

  const bytes = await promise
  assert.equal(bytes.length, 135)
  assert.equal(bytes[0], 0)
  assert.equal(bytes[89], 89)
  assert.equal(bytes[90], 200)
  assert.equal(bytes[92], 202)
  assert.deepEqual(progress, [90, 93])
  assert.equal(sent[0].type, 'LOG_REQUEST_DATA')
  assert.equal(sent[0].id, 7)
  assert.equal(sent.at(-1).type, 'LOG_REQUEST_END')
})

test('downloadLog ignores LOG_DATA for a different log id', async () => {
  const { service } = createService()
  const promise = service.downloadLog(3, 4, undefined)
  service.handleLogData(logData(9, 0, [1, 2, 3, 4])) // wrong id — ignored
  service.handleLogData(logData(3, 0, [10, 20, 30, 40]))
  const bytes = await promise
  assert.deepEqual(Array.from(bytes), [10, 20, 30, 40])
})

test('a zero-byte log resolves immediately', async () => {
  const { service } = createService()
  assert.deepEqual(Array.from(await service.downloadLog(1, 0)), [])
})

test('a second operation while one is in flight is rejected', async () => {
  const { service } = createService()
  const first = service.listLogs()
  await assert.rejects(() => service.listLogs(), /already in progress/)
  service.handleLogEntry(logEntry({ id: 0, numLogs: 0 }))
  await first
})

test('cancelAll rejects the active operation', async () => {
  const { service } = createService()
  const promise = service.downloadLog(1, 100)
  service.cancelAll(new Error('link lost'))
  await assert.rejects(() => promise, /link lost/)
})

test('listLogs rejects when no vehicle is identified', async () => {
  const { service } = createService({ getVehicle: () => undefined })
  await assert.rejects(() => service.listLogs(), /requires an identified vehicle/)
})

const window90 = (value) => new Uint8Array(90).fill(value)

test('a dropped middle LOG_DATA window does not silently complete; the retry recovers it', async () => {
  // Regression: LOG_DATA is streamed sequentially and unacked, so a real
  // link can drop a middle window. Tracking `received` as a high-water
  // mark used to let a LATER window jump it to the total and resolve a
  // zero-filled, corrupt log as a SUCCESSFUL download. The contiguous
  // frontier must hold at the gap so the inactivity retry recovers it.
  const { service, sent } = createService() // requestTimeoutMs 200
  let resolved = false
  const promise = service.downloadLog(7, 270).then((b) => {
    resolved = true
    return b
  })

  service.handleLogData(logData(7, 0, window90(1))) // window 0 → frontier 90
  // window @90 dropped on the link
  service.handleLogData(logData(7, 180, window90(3))) // window 2 arrives out of order

  await new Promise((r) => setTimeout(r, 60))
  assert.equal(resolved, false, 'a high-water jump must not falsely complete across the hole')

  // The inactivity timer (200ms) fires: exactly one retry, re-requesting
  // from the contiguous gap (90), not past it.
  await new Promise((r) => setTimeout(r, 230))
  const dataReqs = sent.filter((m) => m.type === 'LOG_REQUEST_DATA')
  assert.equal(dataReqs.length, 2)
  assert.equal(dataReqs[1].ofs, 90, 'retry re-requests from the gap, not the high-water mark')

  // The FC re-streams from the gap.
  service.handleLogData(logData(7, 90, window90(2)))
  service.handleLogData(logData(7, 180, window90(3)))

  const bytes = await promise
  assert.equal(resolved, true)
  assert.equal(bytes.length, 270)
  assert.ok(
    bytes.every((b, i) => b === (i < 90 ? 1 : i < 180 ? 2 : 3)),
    'recovered log has no zero-filled hole'
  )
})

test('a short end-of-log chunk that arrives with an earlier hole does not falsely complete', async () => {
  // The other silent-corruption entry point: a short chunk (ArduPilot's
  // end-of-log marker) used to complete UNCONDITIONALLY. If a window
  // before it was dropped, that resolved a holed, zero-filled log as
  // success. It must only complete when contiguous up to the end.
  const { service } = createService()
  let settled = false
  const promise = service.downloadLog(7, 210)
  promise.then(
    () => {
      settled = 'resolved'
    },
    () => {
      settled = 'rejected'
    }
  )

  service.handleLogData(logData(7, 0, window90(1))) // window 0 → frontier 90
  // window @90 dropped; the FC then sends its short end-of-log chunk at
  // ofs 180 (count 30 < 90) — past the still-open hole.
  service.handleLogData(logData(7, 180, new Uint8Array(30).fill(3)))

  await new Promise((r) => setTimeout(r, 60))
  assert.equal(settled, false, 'short chunk past a hole must not complete with a zero-filled gap')

  service.cancelAll(new Error('test cleanup'))
  await promise.catch(() => {})
})

test('downloadLog rejects an out-of-range device-reported size before allocating', async () => {
  const { service } = createService()
  // LOG_ENTRY.size is a device-controlled uint32; a hostile/garbage value
  // near 4 GB must be refused, not handed to new Uint8Array (OOM).
  await assert.rejects(() => service.downloadLog(1, 4_000_000_000), /out of range/i)
  await assert.rejects(() => service.downloadLog(1, Number.NaN), /out of range/i)
  await assert.rejects(() => service.downloadLog(1, -1), /out of range/i)
})

test('downloadLog accepts a realistic in-range size', async () => {
  const { service } = createService()
  // A 4 KB log is well under the cap; the promise stays pending (awaiting
  // LOG_DATA) rather than rejecting on the size guard.
  let settled = false
  const promise = service.downloadLog(2, 4096)
  promise.then(() => { settled = 'resolved' }, () => { settled = 'rejected' })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(settled, false, '4 KB is in range and must not be rejected by the size guard')
  service.cancelAll(new Error('test cleanup'))
  await promise.catch(() => {})
})

test('a 0% stall retries: LOG_REQUEST_END (clear stuck FC transfer state) then a fresh data request', async () => {
  // Field failure: ArduPilot silently drops LOG_REQUEST_DATA while it
  // still considers a log transfer active on some link (it holds
  // _log_sending_link from the LIST until a LOG_REQUEST_END arrives).
  // A download then sits at 0% — and the old retry only fired when
  // received > 0, so 0% hard-failed with no recovery attempt.
  const { service, sent } = createService()
  const promise = service.downloadLog(1, 90)
  promise.catch(() => {})

  // Let the first inactivity window elapse with NO data at all.
  await new Promise((resolve) => setTimeout(resolve, 260))

  const ends = sent.filter((m) => m.type === 'LOG_REQUEST_END')
  const datas = sent.filter((m) => m.type === 'LOG_REQUEST_DATA')
  assert.ok(ends.length >= 1, 'a 0% stall must send LOG_REQUEST_END to clear stuck FC state')
  assert.ok(datas.length >= 2, 'a 0% stall must re-request the data')
  assert.equal(datas[datas.length - 1].ofs, 0, 're-request starts from offset 0')

  // Recovery: data arrives after the retry → download completes.
  service.handleLogData({ type: 'LOG_DATA', id: 1, ofs: 0, count: 90, data: new Uint8Array(90).fill(7) })
  const bytes = await promise
  assert.equal(bytes.length, 90)
  assert.equal(bytes[0], 7)
})

test('a download that never produces data fails with the stuck-transfer diagnosis after all retries', async () => {
  const { service } = createService()
  await assert.rejects(
    () => service.downloadLog(2, 90),
    (error) => /No log data arrived/.test(error.message) && /another log transfer/.test(error.message)
  )
})
