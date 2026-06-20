import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import {
  listBoardFirmware,
  downloadFirmwareApj,
  resetFirmwareManifestCache
} from '../apps/desktop/dist/firmware-fetch.js'

const MANIFEST = JSON.stringify({
  'format-version': '1.0.0',
  firmware: [
    { vehicletype: 'Copter', board_id: 9, format: 'apj', 'mav-firmware-version-type': 'OFFICIAL', latest: 1,
      'mav-firmware-version': '4.6.0', url: 'https://firmware.ardupilot.org/Copter/stable/CubeOrange/arducopter.apj' },
    { vehicletype: 'Copter', board_id: 9, format: 'apj', 'mav-firmware-version-type': 'dev',
      url: 'https://firmware.ardupilot.org/Copter/latest/CubeOrange/arducopter.apj' },
    { vehicletype: 'Plane', board_id: 9, format: 'apj', 'mav-firmware-version-type': 'OFFICIAL',
      url: 'https://firmware.ardupilot.org/Plane/stable/CubeOrange/arduplane.apj' },
    { vehicletype: 'Copter', board_id: 50, format: 'apj', 'mav-firmware-version-type': 'OFFICIAL',
      url: 'https://firmware.ardupilot.org/Copter/stable/Other/arducopter.apj' }
  ]
})
// audit-29: the real firmware.ardupilot.org/manifest.json.gz serves a
// gzip-encoded JSON body as application/octet-stream (NOT Content-Encoding:
// gzip), so the fetcher hands the desktop bridge gzipped bytes and the
// bridge must gunzip itself. The fixture mirrors that exact shape.
const MANIFEST_GZ = gzipSync(Buffer.from(MANIFEST, 'utf-8'))

function fakeFetch(responses) {
  return async (url) => {
    if (url in responses) return responses[url]
    throw new Error('unexpected url ' + url)
  }
}
const okGzManifest = (gz) => ({
  ok: true,
  status: 200,
  text: async () => { throw new Error('text() should not be called — manifest is gzipped binary') },
  arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)
})
const okBytes = (b) => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => b.buffer })

test('listBoardFirmware fetches the gzipped manifest, gunzips, and filters by board + vehicle', async () => {
  resetFirmwareManifestCache()
  const fetchImpl = fakeFetch({
    'https://firmware.ardupilot.org/manifest.json.gz': okGzManifest(MANIFEST_GZ)
  })
  const res = await listBoardFirmware(9, 'Copter', fetchImpl)
  assert.equal(res.entries.length, 2, 'board 9 Copter -> 2 entries (stable + dev)')
  assert.ok(res.releaseTypes.includes('OFFICIAL'))
  assert.ok(res.entries.every((e) => e.boardId === 9 && e.vehicletype === 'Copter'))
})

test('downloadFirmwareApj refuses non-ardupilot hosts', async () => {
  await assert.rejects(() => downloadFirmwareApj('https://evil.example/x.apj', fakeFetch({})), /only https:\/\/firmware\.ardupilot\.org/)
  await assert.rejects(() => downloadFirmwareApj('http://firmware.ardupilot.org/x.apj', fakeFetch({})), /only https/)
})

test('downloadFirmwareApj fetches bytes from firmware.ardupilot.org', async () => {
  const url = 'https://firmware.ardupilot.org/Copter/stable/CubeOrange/arducopter.apj'
  const bytes = new Uint8Array([1, 2, 3, 4])
  const out = await downloadFirmwareApj(url, fakeFetch({ [url]: okBytes(bytes) }))
  assert.deepEqual([...out], [1, 2, 3, 4])
})
