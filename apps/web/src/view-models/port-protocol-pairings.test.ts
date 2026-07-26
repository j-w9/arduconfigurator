import { describe, expect, it } from 'vitest'

import { pairedDraftsForSerialProtocol, pairingNoteForSerialProtocol } from './port-protocol-pairings'

// Minimal snapshot stub: only .parameters is read.
function snap(params: Record<string, number>) {
  return {
    parameters: Object.entries(params).map(([id, value]) => ({ id, value }))
  } as unknown as Parameters<typeof pairedDraftsForSerialProtocol>[1]
}

describe('pairedDraftsForSerialProtocol', () => {
  it('DisplayPort (42) stages OSD_TYPE = 5 (MSP DisplayPort)', () => {
    expect(pairedDraftsForSerialProtocol(42, snap({ OSD_TYPE: 1 }))).toEqual([{ paramId: 'OSD_TYPE', value: 5 }])
  })

  it('does not re-stage OSD_TYPE when it is already MSP DisplayPort', () => {
    expect(pairedDraftsForSerialProtocol(42, snap({ OSD_TYPE: 5 }))).toEqual([])
  })

  it('Tramp (44) enables the VTX and ORs in the Tramp bit (bit 2 = value 4)', () => {
    const drafts = pairedDraftsForSerialProtocol(44, snap({ VTX_ENABLE: 0, VTX_TYPES: 0 }))
    expect(drafts).toEqual([
      { paramId: 'VTX_ENABLE', value: 1 },
      { paramId: 'VTX_TYPES', value: 4 }
    ])
  })

  it('SmartAudio (37) ORs in the SmartAudio bit (bit 1 = value 2) without clearing others', () => {
    // VTX_TYPES already has Tramp (4); SmartAudio adds 2 -> 6.
    const drafts = pairedDraftsForSerialProtocol(37, snap({ VTX_ENABLE: 1, VTX_TYPES: 4 }))
    // VTX_ENABLE already 1 -> skipped; only the bitmask changes.
    expect(drafts).toEqual([{ paramId: 'VTX_TYPES', value: 6 }])
  })

  it('stages nothing when the transport bit is already set and VTX enabled', () => {
    expect(pairedDraftsForSerialProtocol(44, snap({ VTX_ENABLE: 1, VTX_TYPES: 4 }))).toEqual([])
  })

  it('never stages a param the firmware does not report', () => {
    // No OSD_TYPE in params -> DisplayPort stages nothing.
    expect(pairedDraftsForSerialProtocol(42, snap({ SERIAL1_PROTOCOL: 42 }))).toEqual([])
    // No VTX params -> Tramp stages nothing.
    expect(pairedDraftsForSerialProtocol(44, snap({ SERIAL1_PROTOCOL: 44 }))).toEqual([])
  })

  it('returns nothing for a protocol without a pairing', () => {
    expect(pairedDraftsForSerialProtocol(5, snap({ OSD_TYPE: 1, VTX_ENABLE: 0 }))).toEqual([])
  })

  it('describes each pairing (and nothing for unpaired protocols)', () => {
    expect(pairingNoteForSerialProtocol(42)).toMatch(/OSD backend/i)
    expect(pairingNoteForSerialProtocol(44)).toMatch(/Tramp/i)
    expect(pairingNoteForSerialProtocol(37)).toMatch(/SmartAudio/i)
    expect(pairingNoteForSerialProtocol(5)).toBeNull()
  })
})
