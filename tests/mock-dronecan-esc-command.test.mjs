import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dronecanCatalogue } from '@arduconfig/dronecan-dsdl'
import { decodeInt14Array } from '@arduconfig/protocol-mavlink/dist/mock-dronecan.js'

test('the demo ESC node reads RawCommand the way the DSDL encodes it', () => {
  const catalogue = dronecanCatalogue()
  for (const cmd of [[0], [819, 0, 410, 0], [8191, 4096, 1, 8191], [-8192, -1, 8191]]) {
    const payload = catalogue.encode('uavcan.equipment.esc.RawCommand', 'msg', { cmd })
    assert.deepEqual(decodeInt14Array(payload).slice(0, cmd.length), cmd)
  }
})
