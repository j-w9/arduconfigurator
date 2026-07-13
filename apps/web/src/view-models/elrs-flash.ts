// Pure helpers for the ELRS receiver flasher. The FC exposes an ExpressLRS RX
// on a UART whose SERIALn_PROTOCOL is either RCIN (23, RC input — CRSF is the
// wire format) or CRSF (29, full CRSF incl. telemetry). We surface those ports
// as flash candidates; the operator confirms which one carries the RX before we
// bridge it with SERIAL_PASS. Protocol numbers verified against
// AP_SerialManager.h (SerialProtocol_RCIN = 23, SerialProtocol_CRSF = 29).

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export const ELRS_RCIN_PROTOCOL = 23
export const ELRS_CRSF_PROTOCOL = 29

/** Common ESP flashing baud rates ELRS uses over the passthru bridge. */
export const ELRS_FLASH_BAUD_RATES = [420000, 460800, 230400, 115200] as const
export const ELRS_DEFAULT_FLASH_BAUD = 420000

export interface ElrsPortCandidate {
  /** Serial port index N (the value to write to SERIAL_PASS2). */
  portNumber: number
  protocolValue: number
  protocolLabel: string
}

/**
 * Serial ports currently carrying an ELRS-capable RC link (RCIN or CRSF),
 * sorted by port number. Empty when none is configured — the flasher then tells
 * the operator to set a UART to RCIN/CRSF first.
 */
export function detectElrsSerialPorts(snapshot: ConfiguratorSnapshot): ElrsPortCandidate[] {
  const candidates: ElrsPortCandidate[] = []
  for (const parameter of snapshot.parameters) {
    const match = /^SERIAL(\d+)_PROTOCOL$/.exec(parameter.id)
    if (!match) {
      continue
    }
    const value = Math.round(parameter.value ?? Number.NaN)
    if (value === ELRS_RCIN_PROTOCOL || value === ELRS_CRSF_PROTOCOL) {
      candidates.push({
        portNumber: Number(match[1]),
        protocolValue: value,
        protocolLabel: value === ELRS_CRSF_PROTOCOL ? 'CRSF' : 'RC Input (CRSF/ELRS)'
      })
    }
  }
  return candidates.sort((left, right) => left.portNumber - right.portNumber)
}
