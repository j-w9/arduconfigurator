import { describe, expect, it } from 'vitest'

import { isParamPck, parseParamPck } from './param-pck'

interface Entry {
  type: 1 | 2 | 3 | 4 // INT8 / INT16 / INT32 / FLOAT
  name: string
  value: number
  nonDefault: boolean
  def?: number
  pad?: number // zero pad bytes inserted before this entry
}

function pushTyped(out: number[], type: number, val: number): void {
  const dv = new DataView(new ArrayBuffer(4))
  let size = 1
  if (type === 1) {
    dv.setInt8(0, val)
    size = 1
  } else if (type === 2) {
    dv.setInt16(0, val, true)
    size = 2
  } else if (type === 3) {
    dv.setInt32(0, val, true)
    size = 4
  } else {
    dv.setFloat32(0, val, true)
    size = 4
  }
  for (let i = 0; i < size; i += 1) out.push(dv.getUint8(i))
}

// Mirrors the FC's encoding in AP_Filesystem_Param.cpp so we round-trip it.
function buildPck(magic: number, entries: Entry[]): Uint8Array {
  const out: number[] = [magic & 0xff, (magic >> 8) & 0xff, 0, 0, 0, 0]
  let last = ''
  for (const e of entries) {
    for (let i = 0; i < (e.pad ?? 0); i += 1) out.push(0)
    let common = 0
    while (common < last.length && common < e.name.length && last[common] === e.name[common]) common += 1
    const suffix = e.name.slice(common)
    const flags = e.nonDefault ? 1 : 0
    out.push(e.type | (flags << 4))
    out.push(common | ((suffix.length - 1) << 4))
    for (const ch of suffix) out.push(ch.charCodeAt(0))
    pushTyped(out, e.type, e.value)
    if (e.nonDefault) pushTyped(out, e.type, e.def ?? 0)
    last = e.name
  }
  return new Uint8Array(out)
}

describe('parseParamPck', () => {
  it('parses names (with prefix compression), values, and flags non-default via the flag', () => {
    const pck = buildPck(0x671c, [
      { type: 1, name: 'ATC_RAT_RLL_P', value: 5, nonDefault: true, def: 0 },
      // shares "ATC_RAT_RLL_" prefix with the previous name
      { type: 1, name: 'ATC_RAT_RLL_I', value: 3, nonDefault: false },
      { type: 4, name: 'INS_GYRO_FILTER', value: 42.5, nonDefault: true, def: 20 }
    ])

    const result = parseParamPck(pck)
    expect(result.withDefaults).toBe(true)
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'ATC_RAT_RLL_P',
      'ATC_RAT_RLL_I',
      'INS_GYRO_FILTER'
    ])
    expect(result.entries[0]).toMatchObject({ value: 5, nonDefault: true })
    expect(result.entries[1]).toMatchObject({ value: 3, nonDefault: false })
    expect(result.entries[2].nonDefault).toBe(true)
    expect(result.entries[2].value).toBeCloseTo(42.5, 3)
    // non-default set = only the flagged params
    expect([...result.nonDefaultParamIds].sort()).toEqual(['ATC_RAT_RLL_P', 'INS_GYRO_FILTER'])
  })

  it('handles INT16/INT32 values and negative numbers', () => {
    const pck = buildPck(0x671c, [
      { type: 2, name: 'SERIAL1_BAUD', value: -32000, nonDefault: true, def: 57 },
      { type: 3, name: 'BRD_SERIAL_NUM', value: 123456, nonDefault: false }
    ])
    const result = parseParamPck(pck)
    expect(result.entries[0].value).toBe(-32000)
    expect(result.entries[1].value).toBe(123456)
    expect([...result.nonDefaultParamIds]).toEqual(['SERIAL1_BAUD'])
  })

  it('skips zero-byte padding inserted before an entry', () => {
    const pck = buildPck(0x671c, [
      { type: 1, name: 'AAA', value: 1, nonDefault: true, def: 0 },
      { type: 4, name: 'BBB', value: 2, nonDefault: false, pad: 3 } // 3 pad bytes before it
    ])
    const result = parseParamPck(pck)
    expect(result.entries.map((entry) => entry.name)).toEqual(['AAA', 'BBB'])
    expect(result.entries[1].value).toBeCloseTo(2, 3)
  })

  it('reports no non-default flags for a plain (0x671b) pack', () => {
    const pck = buildPck(0x671b, [{ type: 1, name: 'XYZ', value: 9, nonDefault: false }])
    const result = parseParamPck(pck)
    expect(result.withDefaults).toBe(false)
    expect(result.nonDefaultParamIds.size).toBe(0)
  })

  // The FIRMWARE DEFAULT is what makes "show the default" possible at all. The
  // parser used to skip these bytes outright.
  it('reads the firmware default that follows a changed value', () => {
    const bytes = buildPck(0x671c, [
      { type: 4, name: 'ATC_RAT_RLL_P', value: 0.25, nonDefault: true, def: 0.135 }
    ])
    const [entry] = parseParamPck(bytes).entries
    expect(entry.value).not.toBe(entry.defaultValue)
    expect(entry.defaultValue).toBeCloseTo(0.135, 5)
  })

  it('treats an unflagged parameter as sitting AT its default', () => {
    // No default is transmitted when the flag is clear, because the value IS
    // the default — which is what lets every parameter report one, not just
    // the changed ones.
    const bytes = buildPck(0x671c, [
      { type: 2, name: 'SERIAL1_PROTOCOL', value: 23, nonDefault: false }
    ])
    const result = parseParamPck(bytes)
    expect(result.entries[0].defaultValue).toBe(23)
    expect(result.defaultsByParamId.get('SERIAL1_PROTOCOL')).toBe(23)
  })

  it('builds a default map covering changed and unchanged parameters alike', () => {
    const bytes = buildPck(0x671c, [
      { type: 3, name: 'BATT_CAPACITY', value: 5200, nonDefault: true, def: 3300 },
      { type: 3, name: 'BATT_MONITOR', value: 4, nonDefault: false }
    ])
    const { defaultsByParamId, nonDefaultParamIds } = parseParamPck(bytes)
    expect(defaultsByParamId.get('BATT_CAPACITY')).toBe(3300)
    expect(defaultsByParamId.get('BATT_MONITOR')).toBe(4)
    expect([...nonDefaultParamIds]).toEqual(['BATT_CAPACITY'])
  })

  it('reports no defaults at all for a pack fetched without ?withdefaults', () => {
    // A 0x671b pack carries no defaults; inventing them from values would
    // claim every parameter is at its default, which is worse than saying
    // nothing.
    const bytes = buildPck(0x671b, [{ type: 1, name: 'A', value: 7, nonDefault: false }])
    const result = parseParamPck(bytes)
    expect(result.defaultsByParamId.size).toBe(0)
    expect(result.entries[0].defaultValue).toBeUndefined()
  })

  it('rejects a blob with the wrong magic', () => {
    expect(isParamPck(new Uint8Array([0, 0, 0, 0, 0, 0]))).toBe(false)
    expect(() => parseParamPck(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/magic/)
  })
})
