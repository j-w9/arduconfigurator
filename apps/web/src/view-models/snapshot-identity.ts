// Pure helpers for comparing a saved snapshot's captured identity (STM32 UID +
// vehicle type) against the currently-connected flight controller, so the
// restore/import flow can flag when a snapshot came from a DIFFERENT physical
// board or a different vehicle. The snapshot already stores hardware.uid
// (AUTOPILOT_VERSION.uid) and vehicle.vehicle at capture time; these just
// compare that against the live snapshot.

export type SnapshotMatchStatus = 'same' | 'different' | 'unknown'

export interface SnapshotMatch {
  status: SnapshotMatchStatus
  label: string
  /** Maps to ui-kit StatusBadge tones. */
  tone: 'success' | 'warning' | 'neutral'
}

/**
 * AUTOPILOT_VERSION.uid frequently arrives all-zero from controllers that do
 * not expose an STM32 UID, so a uid counts as meaningful only when it contains
 * at least one non-zero hex digit.
 */
export function isMeaningfulHardwareUid(uid: string | undefined): boolean {
  if (!uid) return false
  return /[1-9a-f]/i.test(uid)
}

function normalizeUid(uid: string | undefined): string | undefined {
  if (!isMeaningfulHardwareUid(uid)) return undefined
  return uid!.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
}

/**
 * Compare a snapshot's captured STM32 UID against the live board's UID.
 * `unknown` when either side lacks a meaningful UID (so we never claim a match
 * or mismatch we can't substantiate).
 */
export function describeSnapshotBoardMatch(
  snapshotUid: string | undefined,
  liveUid: string | undefined
): SnapshotMatch {
  const snap = normalizeUid(snapshotUid)
  const live = normalizeUid(liveUid)
  if (snap === undefined || live === undefined) {
    return { status: 'unknown', label: 'Board UID unknown', tone: 'neutral' }
  }
  return snap === live
    ? { status: 'same', label: 'Same board', tone: 'success' }
    : { status: 'different', label: 'Different board', tone: 'warning' }
}

function parseSemverParts(
  version: string | undefined
): { major: number; minor: number; patch: number } | undefined {
  if (!version) return undefined
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0
  }
}

/**
 * Compare a backup's captured flight-firmware version (a string like
 * "4.6.0 (official)") against the connected FC's parsed version. Only the
 * major.minor series is compared — that is where ArduPilot renames / adds /
 * removes parameters between releases (4.6 vs 4.7), which is what makes a
 * cross-version restore stage values the firmware no longer knows. A patch bump
 * (4.7.0 → 4.7.1) effectively never changes the parameter set, so it counts as
 * the same. `unknown` when either side lacks a parseable version.
 */
export function describeSnapshotFirmwareMatch(
  backupVersion: string | undefined,
  liveVersionParts: { major: number; minor: number; patch: number } | undefined
): SnapshotMatch {
  const backup = parseSemverParts(backupVersion)
  if (!backup || !liveVersionParts) {
    return { status: 'unknown', label: 'Firmware version unknown', tone: 'neutral' }
  }
  const backupLabel = `${backup.major}.${backup.minor}.${backup.patch}`
  const liveLabel = `${liveVersionParts.major}.${liveVersionParts.minor}.${liveVersionParts.patch}`
  const sameSeries = backup.major === liveVersionParts.major && backup.minor === liveVersionParts.minor
  return sameSeries
    ? { status: 'same', label: `Same firmware (${liveLabel})`, tone: 'success' }
    : { status: 'different', label: `${backupLabel} → ${liveLabel}`, tone: 'warning' }
}

/** Compare a snapshot's captured vehicle type against the live vehicle. */
export function describeSnapshotVehicleMatch(
  snapshotVehicle: string | undefined,
  liveVehicle: string | undefined
): SnapshotMatch {
  if (
    !snapshotVehicle ||
    !liveVehicle ||
    snapshotVehicle === 'Unknown' ||
    liveVehicle === 'Unknown'
  ) {
    return { status: 'unknown', label: 'Vehicle unknown', tone: 'neutral' }
  }
  return snapshotVehicle === liveVehicle
    ? { status: 'same', label: 'Same vehicle', tone: 'success' }
    : { status: 'different', label: `${snapshotVehicle} → ${liveVehicle}`, tone: 'warning' }
}
