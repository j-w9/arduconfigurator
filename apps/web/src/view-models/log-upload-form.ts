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
 * The earliest year a real ArduPilot flight log can carry.
 *
 * A board whose RTC was never set — no GPS lock before the log was opened, no
 * GCS time push — stamps its files with the FAT epoch, 1980-01-01. That is a
 * well-formed date, so it passes a shape check and files the flight 46 years in
 * the past. Anything this old is a missing clock, not a vintage flight.
 */
const EARLIEST_PLAUSIBLE_FLIGHT_YEAR = 2010

/**
 * ArduPilot's log listing gives a date like "2026-08-08 14:22", a dash when the
 * source is MAVFTP (which carries no timestamp), or the FAT epoch when the board
 * had no clock. Take the date part when it is plausible; otherwise today,
 * because an operator uploading a log they just pulled is far more often
 * uploading today's flight than one from before ArduPilot existed.
 */
function deriveFlightDate(dateLabel: string, todayIso: string): string {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(dateLabel)
  if (!match) {
    return todayIso
  }
  const year = Number.parseInt(match[1].slice(0, 4), 10)
  return year >= EARLIEST_PLAUSIBLE_FLIGHT_YEAR ? match[1] : todayIso
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
