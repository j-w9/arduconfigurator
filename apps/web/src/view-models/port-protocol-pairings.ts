// When a serial port's Function (SERIALn_PROTOCOL) is set to a peripheral that
// needs a second parameter flipped to actually work, this computes the paired
// parameter drafts to stage alongside it — so picking "DisplayPort" also turns
// the OSD backend on, and picking a VTX-control protocol enables the VTX and
// allows that transport. The drafts are staged (visible, revertible, applied
// together), never written silently.
//
// Pairings (values verified against ArduPilot source):
//   SERIALn_PROTOCOL 42 (MSP DisplayPort) -> OSD_TYPE = 5 (OSD_MSP_DISPLAYPORT)
//   SERIALn_PROTOCOL 44 (IRC Tramp)       -> VTX_ENABLE = 1, VTX_TYPES |= bit 2 (Tramp)
//   SERIALn_PROTOCOL 37 (SmartAudio)      -> VTX_ENABLE = 1, VTX_TYPES |= bit 1 (SmartAudio)

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export interface PairedDraft {
  paramId: string
  value: number
}

// SERIALn_PROTOCOL enum values that carry a pairing.
export const SERIAL_PROTOCOL_DISPLAYPORT = 42
export const SERIAL_PROTOCOL_SMARTAUDIO = 37
export const SERIAL_PROTOCOL_TRAMP = 44

const OSD_TYPE_MSP_DISPLAYPORT = 5
// VTX_TYPES bit indices (AP_VideoTX): 0 CRSF, 1 SmartAudio, 2 Tramp, 3 MSP.
const VTX_TYPES_BIT_SMARTAUDIO = 1
const VTX_TYPES_BIT_TRAMP = 2

// Every parameter these pairings can touch — used to pull them into the Ports
// apply scope so a staged pairing commits together with the port change.
export const PORT_PAIRING_PARAM_IDS = ['OSD_TYPE', 'VTX_ENABLE', 'VTX_TYPES'] as const

function currentValue(snapshot: ConfiguratorSnapshot, paramId: string): number | undefined {
  const p = snapshot.parameters.find((param) => param.id === paramId)
  return p?.value
}

function has(snapshot: ConfiguratorSnapshot, paramId: string): boolean {
  return snapshot.parameters.some((param) => param.id === paramId)
}

/**
 * Paired drafts to stage when a port's protocol becomes `protocolValue`.
 * Returns only params that (a) the firmware actually reports (so we never stage
 * a write the FC can't honour) and (b) would genuinely change (already-correct
 * values are skipped, so re-selecting DisplayPort doesn't re-stage OSD_TYPE=5).
 */
export function pairedDraftsForSerialProtocol(
  protocolValue: number,
  snapshot: ConfiguratorSnapshot
): PairedDraft[] {
  const drafts: PairedDraft[] = []

  const stageIfChanged = (paramId: string, value: number) => {
    if (!has(snapshot, paramId)) {
      return
    }
    if (currentValue(snapshot, paramId) === value) {
      return
    }
    drafts.push({ paramId, value })
  }

  const enableVtxTransport = (bitIndex: number) => {
    stageIfChanged('VTX_ENABLE', 1)
    if (!has(snapshot, 'VTX_TYPES')) {
      return
    }
    const current = currentValue(snapshot, 'VTX_TYPES') ?? 0
    const next = current | (1 << bitIndex)
    if (next !== current) {
      drafts.push({ paramId: 'VTX_TYPES', value: next })
    }
  }

  switch (protocolValue) {
    case SERIAL_PROTOCOL_DISPLAYPORT:
      stageIfChanged('OSD_TYPE', OSD_TYPE_MSP_DISPLAYPORT)
      break
    case SERIAL_PROTOCOL_TRAMP:
      enableVtxTransport(VTX_TYPES_BIT_TRAMP)
      break
    case SERIAL_PROTOCOL_SMARTAUDIO:
      enableVtxTransport(VTX_TYPES_BIT_SMARTAUDIO)
      break
    default:
      break
  }

  return drafts
}

/** Short operator-facing note describing what a pairing will stage, or null. */
export function pairingNoteForSerialProtocol(protocolValue: number): string | null {
  switch (protocolValue) {
    case SERIAL_PROTOCOL_DISPLAYPORT:
      return 'Also sets the OSD backend to MSP DisplayPort (OSD_TYPE).'
    case SERIAL_PROTOCOL_TRAMP:
      return 'Also enables the VTX and allows Tramp control (VTX_ENABLE, VTX_TYPES).'
    case SERIAL_PROTOCOL_SMARTAUDIO:
      return 'Also enables the VTX and allows SmartAudio control (VTX_ENABLE, VTX_TYPES).'
    default:
      return null
  }
}
