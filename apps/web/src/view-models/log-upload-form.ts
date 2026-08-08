import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { formatBoardId } from '@arduconfig/firmware-flash'

import type { LogUploadMetadata } from '../log-upload/client'

/**
 * What the upload dialog shows: the two things only the operator knows, and the
 * things the configurator can answer for them.
 *
 * Autofill is the whole point of uploading from here rather than through the
 * server's web UI — the vehicle, firmware and board are already on screen, and
 * asking someone to retype them is how a log ends up filed under the wrong
 * aircraft.
 */
export interface LogUploadFormModel {
  /** Prefilled, still editable — the operator may be uploading an old flight. */
  flightDate: string
  /** Read-only facts, shown so the operator can see what is being attached. */
  autofilled: Array<{ label: string; value: string }>
  /** The metadata that will actually be sent, minus the operator's answers. */
  metadata: Omit<LogUploadMetadata, 'flightDate' | 'note'>
}

export interface LogUploadFormInputs {
  snapshot: ConfiguratorSnapshot
  log: { id: number; nameLabel?: string; dateLabel: string }
  /** Injected so the "today" fallback is testable. */
  todayIso?: string
}

/**
 * ArduPilot's log listing gives a date like "2026-08-08 14:22" or a dash when
 * the source is MAVFTP (which carries no timestamp). Take the date part when
 * there is one; otherwise today, because an operator uploading a log they just
 * pulled is far more often uploading today's flight than an unknown one.
 */
function deriveFlightDate(dateLabel: string, todayIso: string): string {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(dateLabel)
  return match?.[1] ?? todayIso
}

export function buildLogUploadFormModel({
  snapshot,
  log,
  todayIso = new Date().toISOString().slice(0, 10)
}: LogUploadFormInputs): LogUploadFormModel {
  const vehicle = snapshot.vehicle?.vehicle
  // Firmware and board identity come from AUTOPILOT_VERSION, which lives on
  // hardware.board — snapshot.vehicle carries the MAVLink identity, not the
  // build. formatBoardId turns the raw boardType into "59 (ARK_FPV)" where the
  // id is known, which is what an operator recognises months later.
  const firmwareVersion = snapshot.hardware?.board?.firmwareVersion
  const boardType = snapshot.hardware?.board?.boardType
  const boardName = boardType !== undefined ? formatBoardId(boardType) : undefined

  const autofilled: Array<{ label: string; value: string }> = []
  if (vehicle && vehicle !== 'Unknown') {
    autofilled.push({ label: 'Vehicle', value: vehicle })
  }
  if (firmwareVersion) {
    autofilled.push({ label: 'Firmware', value: firmwareVersion })
  }
  if (boardName) {
    autofilled.push({ label: 'Board', value: boardName })
  }
  autofilled.push({ label: 'Log', value: `#${log.id}${log.nameLabel ? ` (${log.nameLabel})` : ''}` })

  return {
    flightDate: deriveFlightDate(log.dateLabel, todayIso),
    autofilled,
    metadata: {
      // The on-FC name where there is one; the log number is a poor filename on
      // a server holding several aircraft, so it gets a descriptive fallback.
      fileName: log.nameLabel ?? `log-${log.id}.bin`,
      vehicle: vehicle && vehicle !== 'Unknown' ? vehicle : undefined,
      firmwareVersion,
      boardName,
      onboardLogId: log.id
    }
  }
}
