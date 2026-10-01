import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VTX_POWER_SLOT_PIT,
  VTX_POWER_SLOT_UNUSED,
  VTX_POWER_TABLE_ENABLE_PARAM,
  VTX_POWER_TABLE_SLOTS,
  VTX_POWER_TABLE_SLOT_PARAMS,
  classifyVtxPowerSlot,
  readVtxPowerTable,
  vtxPowerTableWrites
} from '../packages/ardupilot-core/dist/index.js'

const reader = (values) => (paramId) => values[paramId]

test('the power table is six parameters plus an enable', () => {
  assert.equal(VTX_POWER_TABLE_SLOTS, 6)
  assert.deepEqual(VTX_POWER_TABLE_SLOT_PARAMS, [
    'VTX_PWRTBL1',
    'VTX_PWRTBL2',
    'VTX_PWRTBL3',
    'VTX_PWRTBL4',
    'VTX_PWRTBL5',
    'VTX_PWRTBL6'
  ])
  assert.equal(VTX_POWER_TABLE_ENABLE_PARAM, 'VTX_PWRTBL_EN')
})

// -1 unused, 0 pit mode, otherwise milliwatts. Getting 0 wrong would turn
// "pit mode at this switch position" into "0 mW", which is not the same thing.
test('slot values classify as unused / pit / power', () => {
  assert.equal(classifyVtxPowerSlot(-1), 'unused')
  assert.equal(classifyVtxPowerSlot(undefined), 'unused')
  assert.equal(classifyVtxPowerSlot(0), 'pit')
  assert.equal(classifyVtxPowerSlot(25), 'power')
  assert.equal(classifyVtxPowerSlot(1600), 'power')
})

test('reads the table out of parameters', () => {
  const table = readVtxPowerTable(
    reader({
      VTX_PWRTBL_EN: 1,
      VTX_PWRTBL1: 0,
      VTX_PWRTBL2: 25,
      VTX_PWRTBL3: 400,
      VTX_PWRTBL4: 1600,
      VTX_PWRTBL5: -1,
      VTX_PWRTBL6: -1
    })
  )
  assert.equal(table.supported, true)
  assert.equal(table.enabled, true)
  assert.deepEqual(
    table.slots.map((slot) => slot.kind),
    ['pit', 'power', 'power', 'power', 'unused', 'unused']
  )
  assert.deepEqual(
    table.slots.map((slot) => slot.milliwatts),
    [undefined, 25, 400, 1600, undefined, undefined]
  )
})

test('firmware without the parameters reports unsupported, not disabled', () => {
  const table = readVtxPowerTable(reader({}))
  assert.equal(table.supported, false)
  assert.equal(table.enabled, false)
})

test('VTX_PWRTBL_EN = 0 is supported but off', () => {
  const table = readVtxPowerTable(reader({ VTX_PWRTBL_EN: 0 }))
  assert.equal(table.supported, true)
  assert.equal(table.enabled, false)
})

// A shorter list must CLEAR the slots it does not mention: a stale slot 5 left
// from a previous table is a power level the pilot never chose.
test('writes clear the slots the new table does not use', () => {
  const writes = vtxPowerTableWrites([25, 400])
  assert.deepEqual(writes, [
    { paramId: 'VTX_PWRTBL1', value: 25 },
    { paramId: 'VTX_PWRTBL2', value: 400 },
    { paramId: 'VTX_PWRTBL3', value: VTX_POWER_SLOT_UNUSED },
    { paramId: 'VTX_PWRTBL4', value: VTX_POWER_SLOT_UNUSED },
    { paramId: 'VTX_PWRTBL5', value: VTX_POWER_SLOT_UNUSED },
    { paramId: 'VTX_PWRTBL6', value: VTX_POWER_SLOT_UNUSED }
  ])
})

test('pit mode writes 0 and the enable rides along when asked', () => {
  const writes = vtxPowerTableWrites(['pit', 25], { enable: true })
  assert.deepEqual(writes[0], { paramId: 'VTX_PWRTBL_EN', value: 1 })
  assert.deepEqual(writes[1], { paramId: 'VTX_PWRTBL1', value: VTX_POWER_SLOT_PIT })
  assert.deepEqual(writes[2], { paramId: 'VTX_PWRTBL2', value: 25 })
  assert.equal(writes.length, 7)
})

test('a value beyond the six slots is dropped rather than silently shifting one out', () => {
  const writes = vtxPowerTableWrites([1, 2, 3, 4, 5, 6, 7])
  assert.equal(writes.length, 6)
  assert.deepEqual(
    writes.map((write) => write.value),
    [1, 2, 3, 4, 5, 6]
  )
})
