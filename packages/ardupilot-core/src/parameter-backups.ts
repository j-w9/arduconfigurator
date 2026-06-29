import type { ConfiguratorSnapshot, ParameterState } from './types.js'

const SNAPSHOT_EXCLUDED_PREFIXES = ['STAT_'] as const
const SNAPSHOT_COMPARE_TOLERANCE = 0.0001

/**
 * Optional, opt-in categories the operator can strip when importing a backup
 * from another airframe. These are values that are board/airframe specific and
 * usually should NOT carry over from a different vehicle's file:
 *
 * - `calibration` — sensor offsets/scales re-measured per airframe: compass
 *   offsets/diagonals/off-diagonals/motor-comp/scale, accel & gyro offsets and
 *   accel scale, and the AHRS board-level trims. Does NOT touch compass
 *   identity (COMPASS_DEV_ID, PRIO_ID, USE families) or orientation — those
 *   are configuration, not calibration.
 * - `stream-rates` — the SRn_* MAVLink telemetry stream-rate group.
 * - `mission` — the MIS_* mission parameters.
 */
export type ParameterImportCategory = 'calibration' | 'stream-rates' | 'mission'

const CALIBRATION_PATTERNS: readonly RegExp[] = [
  /^COMPASS_OFS\d?_[XYZ]$/, // COMPASS_OFS_X/Y/Z, COMPASS_OFS2_*, COMPASS_OFS3_*
  /^COMPASS_DIA\d?_[XYZ]$/,
  /^COMPASS_ODI\d?_[XYZ]$/,
  /^COMPASS_MOT\d?_[XYZ]$/,
  /^COMPASS_SCALE\d?$/,
  /^INS_ACC\d?OFFS_[XYZ]$/, // first instance has no digit (INS_ACCOFFS_*)
  /^INS_ACC\d?SCAL_[XYZ]$/,
  /^INS_GYR\d?OFFS_[XYZ]$/,
  /^AHRS_TRIM_[XYZ]$/
]
const STREAM_RATE_PATTERN = /^SR\d+_/
const MISSION_PATTERN = /^MIS_/

// Firmware-managed params (AP_PARAM_FLAG_INTERNAL_USE_ONLY) that a GCS can never
// meaningfully set: the firmware owns the value and re-derives it live, so a
// verified write never sees its written value echo back — the batch write just
// stalls waiting for a readback that never matches. The baro ground-pressure
// reference (BAROn_GND_PRESS, verified internal-use-only in AP_Baro.cpp) updates
// continuously, so importing it from a backup is futile and breaks the upload.
// These are dropped on import unconditionally, independent of the opt-in
// categories — they should never be part of a parameter restore.
const INTERNAL_USE_ONLY_PATTERNS: readonly RegExp[] = [/^BARO\d+_GND_PRESS$/]

export function isInternalUseOnlyParameter(id: string): boolean {
  return INTERNAL_USE_ONLY_PATTERNS.some((pattern) => pattern.test(id))
}

/**
 * Classify a parameter id into one of the opt-in import-exclusion categories,
 * or `undefined` if it belongs to none. Shared by the import path and exposed
 * so the UI can preview/label how many entries a toggle would drop.
 */
export function parameterImportExclusionCategory(id: string): ParameterImportCategory | undefined {
  if (STREAM_RATE_PATTERN.test(id)) {
    return 'stream-rates'
  }
  if (MISSION_PATTERN.test(id)) {
    return 'mission'
  }
  if (CALIBRATION_PATTERNS.some((pattern) => pattern.test(id))) {
    return 'calibration'
  }
  return undefined
}

export interface ParameterBackupEntry {
  id: string
  value: number
  category?: string
  label?: string
  unit?: string
}

export interface ParameterBackupFile {
  schemaVersion: 1
  application: 'ArduConfigurator'
  /** Configurator build that produced the export (from build-info.ts). */
  appVersion?: string
  /** Configurator git commit hash at build time. */
  appGitHash?: string
  /** Configurator git branch at build time. */
  appGitBranch?: string
  firmware: NonNullable<ConfiguratorSnapshot['vehicle']>['vehicle'] | 'Unknown'
  /** Flight-firmware version string (AUTOPILOT_VERSION), e.g. "4.5.3 (official)". */
  firmwareVersion?: string
  /** Flight-firmware build git hash, if reported. */
  firmwareGitHash?: string
  exportedAt: string
  parameterCount: number
  vehicle?: {
    firmware: NonNullable<ConfiguratorSnapshot['vehicle']>['firmware']
    vehicle: NonNullable<ConfiguratorSnapshot['vehicle']>['vehicle']
    systemId: number
    componentId: number
    flightMode: string
  }
  /** Autopilot board identity (vendor/product IDs, board type, hardware UID). */
  hardware?: {
    boardVersion?: number
    boardType?: number
    vendorId?: number
    productId?: number
    uid?: string
  }
  parameters: ParameterBackupEntry[]
}

/**
 * Configurator build metadata baked into every export. The web/desktop App
 * forwards APP_VERSION / GIT_HASH / GIT_BRANCH from build-info.ts; tests
 * usually skip this and accept the defaults.
 */
export interface ParameterBackupAppInfo {
  appVersion?: string
  appGitHash?: string
  appGitBranch?: string
}

export interface ParameterBackupImportResult {
  draftValues: Record<string, string>
  matchedCount: number
  changedCount: number
  unchangedCount: number
  unknownParameterIds: string[]
  /** Entries skipped because they matched an opt-in exclusion category. */
  excludedCount: number
}

export interface ParameterBackupImportOptions {
  /** Opt-in categories whose entries are skipped during import. */
  excludeCategories?: readonly ParameterImportCategory[]
}

export function createParameterBackup(
  snapshot: ConfiguratorSnapshot,
  appInfo: ParameterBackupAppInfo = {}
): ParameterBackupFile {
  const exportableParameters = snapshot.parameters
    .filter((parameter) => !isSnapshotExcludedParameterState(parameter))
    .map((parameter) => ({
      id: parameter.id,
      value: parameter.value,
      category: parameter.definition?.category,
      label: parameter.definition?.label,
      unit: parameter.definition?.unit
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const board = snapshot.hardware?.board
  const hardware =
    board === undefined
      ? undefined
      : {
          boardVersion: board.boardVersion,
          boardType: board.boardType,
          vendorId: board.vendorId,
          productId: board.productId,
          uid: board.uid
        }

  return {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    appVersion: appInfo.appVersion,
    appGitHash: appInfo.appGitHash,
    appGitBranch: appInfo.appGitBranch,
    firmware: snapshot.vehicle?.vehicle ?? 'Unknown',
    firmwareVersion: board?.firmwareVersion,
    firmwareGitHash: board?.firmwareGitHash,
    exportedAt: new Date().toISOString(),
    parameterCount: exportableParameters.length,
    vehicle: snapshot.vehicle
      ? {
          firmware: snapshot.vehicle.firmware,
          vehicle: snapshot.vehicle.vehicle,
          systemId: snapshot.vehicle.systemId,
          componentId: snapshot.vehicle.componentId,
          flightMode: snapshot.vehicle.flightMode
        }
      : undefined,
    hardware,
    parameters: exportableParameters
  }
}

export function serializeParameterBackup(backup: ParameterBackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * Serialize a parameter backup in Mission Planner's `.parm` format:
 *
 *   # ArduConfigurator v0.3.0-alpha (a188961, main)
 *   # Exported: 2026-05-28T15:20:00.000Z
 *   # Firmware: ArduPlane 4.6.3 (custom-build-abc123)
 *   # Board: vendor=0x2dae product=0x1011 boardType=39 uid=0102...
 *   # Parameters: 1083
 *   ARMING_CHECK,1
 *   BATT_MONITOR,4
 *
 * Header is comment-only so MP and any other ArduPilot-aware tool can
 * still re-import the file without choking on it.
 */
export function serializeParameterBackupAsParm(backup: ParameterBackupFile): string {
  const lines: string[] = buildBackupHeaderComments(backup)
  for (const entry of backup.parameters) {
    lines.push(`${entry.id},${formatBackupValue(entry.value)}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Serialize a parameter backup in QGroundControl's `.params` format
 * (tab-separated, five columns):
 *
 *   # Onboard parameters for vehicle 1
 *   # ArduConfigurator v0.3.0-alpha (a188961, main)
 *   # ...
 *   # Vehicle-Id Component-Id Name Value Type
 *   1\t1\tARMING_CHECK\t1\t9
 *
 * MAV_PARAM_TYPE 9 (MAV_PARAM_TYPE_REAL32) is the catch-all ArduPilot
 * uses for nearly every param; QGC accepts that for re-import.
 */
export function serializeParameterBackupAsParams(backup: ParameterBackupFile): string {
  const systemId = backup.vehicle?.systemId ?? 1
  const componentId = backup.vehicle?.componentId ?? 1
  const lines: string[] = []
  lines.push(`# Onboard parameters for vehicle ${systemId}`)
  for (const comment of buildBackupHeaderComments(backup)) {
    // buildBackupHeaderComments returns "# ..." lines already.
    lines.push(comment)
  }
  lines.push('# Vehicle-Id Component-Id Name Value Type')
  for (const entry of backup.parameters) {
    lines.push(`${systemId}\t${componentId}\t${entry.id}\t${formatBackupValue(entry.value)}\t9`)
  }
  return lines.join('\n') + '\n'
}

function buildBackupHeaderComments(backup: ParameterBackupFile): string[] {
  const lines: string[] = []
  const appParts: string[] = [backup.application]
  if (backup.appVersion) appParts.push(`v${backup.appVersion}`)
  if (backup.appGitHash || backup.appGitBranch) {
    const fragments = [backup.appGitHash, backup.appGitBranch].filter((part): part is string => Boolean(part))
    appParts.push(`(${fragments.join(', ')})`)
  }
  lines.push(`# ${appParts.join(' ')}`)
  lines.push(`# Exported: ${backup.exportedAt}`)
  if (backup.firmware && backup.firmware !== 'Unknown') {
    const fwParts: string[] = [backup.firmware]
    if (backup.firmwareVersion) fwParts.push(backup.firmwareVersion)
    if (backup.firmwareGitHash) fwParts.push(`(${backup.firmwareGitHash})`)
    lines.push(`# Firmware: ${fwParts.join(' ')}`)
  }
  if (backup.vehicle) {
    lines.push(
      `# Vehicle: sysid=${backup.vehicle.systemId} compid=${backup.vehicle.componentId} mode=${backup.vehicle.flightMode}`
    )
  }
  if (backup.hardware) {
    const hw = backup.hardware
    // One attribute per "# Board:" line so each field stays on its own line.
    if (hw.vendorId !== undefined) lines.push(`# Board: vendor=0x${hw.vendorId.toString(16).padStart(4, '0')}`)
    if (hw.productId !== undefined) lines.push(`# Board: product=0x${hw.productId.toString(16).padStart(4, '0')}`)
    if (hw.boardType !== undefined) lines.push(`# Board: boardType=${hw.boardType}`)
    if (hw.boardVersion !== undefined) lines.push(`# Board: boardVersion=${hw.boardVersion}`)
    if (hw.uid) lines.push(`# Board: uid=${hw.uid}`)
  }
  lines.push(`# Parameters: ${backup.parameterCount}`)
  return lines
}

/** Format a parameter value for .parm / .params output. ArduPilot stores
 *  every param as IEEE-754 single precision (f32), so round to 7 sig figs
 *  (f32 decimal precision) and trim trailing zeros. */
function formatBackupValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toPrecision(7).replace(/(?:\.0+|(\.\d+?)0+)(e[+-]?\d+)?$/, '$1$2')
}

export function parseParameterBackup(input: string): ParameterBackupFile {
  // Try the ArduConfigurator JSON schema first (round-trip identical to
  // serializeParameterBackup). If that doesn't parse OR doesn't match the
  // schema, fall through to the Mission Planner / QGroundControl text
  // formats so a user can drop the canonical .parm / .params files those
  // tools export today.
  const trimmed = input.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch (error) {
      throw new Error(`Backup file is not valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error.'}`)
    }
    if (!isParameterBackupFile(parsed)) {
      throw new Error('Backup file does not match the expected ArduConfigurator parameter backup schema.')
    }
    return {
      ...parsed,
      parameters: [...parsed.parameters].sort((left, right) => left.id.localeCompare(right.id))
    }
  }

  return parseTextParameterBackup(input)
}

/**
 * Parse a Mission Planner .parm or QGroundControl .params text file.
 *
 * Mission Planner .parm:
 *   # arbitrary comment lines start with #
 *   PARAM_NAME,12.5
 *   PARAM_NAME 12.5   (whitespace-separated is also accepted in the wild)
 *
 * QGroundControl .params:
 *   # Onboard parameters ...
 *   # Vehicle-Id Component-Id Name Value Type
 *   1<TAB>1<TAB>PARAM_NAME<TAB>12.5<TAB>9
 *
 * Vehicle-id / component-id / type are not preserved — the configurator
 * resolves param defs from its own catalog and just needs id+value. Lines
 * are accepted if they end in "<NAME> <NUMBER>" after stripping comments
 * and splitting on whitespace/commas, which covers both formats and a few
 * scuffed variants in between.
 */
function parseTextParameterBackup(input: string): ParameterBackupFile {
  const entries: ParameterBackupEntry[] = []
  const seenIds = new Set<string>()
  let lineNumber = 0
  for (const rawLine of input.split(/\r?\n/)) {
    lineNumber += 1
    const line = rawLine.split('#', 1)[0]?.trim()
    if (!line) {
      continue
    }
    // Split on commas, tabs, and runs of whitespace. .parm uses comma or
    // single-space; QGC .params uses tabs; some MP exports use multiple
    // spaces.
    const tokens = line.split(/[\s,]+/).filter((token) => token.length > 0)
    if (tokens.length < 2) {
      continue
    }

    // Locate the ArduPilot identifier on the line: uppercase letter +
    // [A-Z0-9_]*. .parm puts it first; QGC .params puts it at index 2
    // (after vid + cid). The value is always the NEXT token, parsed as a
    // float — that ignores the QGC trailing "Type" column and any other
    // trailing metadata.
    const idIndex = tokens.findIndex((token) => /^[A-Z][A-Z0-9_]*$/.test(token))
    if (idIndex < 0 || idIndex >= tokens.length - 1) {
      continue
    }
    const idCandidate = tokens[idIndex]
    const value = Number(tokens[idIndex + 1])
    if (!Number.isFinite(value)) {
      continue
    }
    if (seenIds.has(idCandidate)) {
      throw new Error(`Backup file lists ${idCandidate} more than once (line ${lineNumber}).`)
    }
    seenIds.add(idCandidate)
    entries.push({ id: idCandidate, value })
  }

  if (entries.length === 0) {
    throw new Error('Backup file is empty or does not contain any NAME,VALUE entries.')
  }

  entries.sort((left, right) => left.id.localeCompare(right.id))

  return {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    firmware: 'Unknown',
    exportedAt: new Date().toISOString(),
    parameterCount: entries.length,
    parameters: entries
  }
}

export function deriveDraftValuesFromParameterBackup(
  parameters: ParameterState[],
  backup: ParameterBackupFile,
  options?: ParameterBackupImportOptions
): ParameterBackupImportResult {
  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]))
  const excludeCategories = new Set(options?.excludeCategories ?? [])
  const draftValues: Record<string, string> = {}
  const unknownParameterIds: string[] = []
  let matchedCount = 0
  let changedCount = 0
  let unchangedCount = 0
  let excludedCount = 0

  backup.parameters.forEach((entry) => {
    if (isSnapshotExcludedBackupEntry(entry)) {
      return
    }

    // Firmware-managed (internal-use-only) params can never be verify-written, so
    // always drop them on import — a mass restore must not stall on a value the
    // FC re-derives live (e.g. BAROn_GND_PRESS). Counts as excluded, never
    // staged, regardless of the opt-in categories.
    if (isInternalUseOnlyParameter(entry.id)) {
      excludedCount += 1
      return
    }

    // Opt-in category exclusion runs BEFORE the unknown/diff bookkeeping so a
    // stripped entry never counts toward matched/changed/unknown — it is
    // simply not part of this import.
    if (excludeCategories.size > 0) {
      const category = parameterImportExclusionCategory(entry.id)
      if (category !== undefined && excludeCategories.has(category)) {
        excludedCount += 1
        return
      }
    }

    const current = parameterById.get(entry.id)
    if (!current) {
      unknownParameterIds.push(entry.id)
      return
    }

    matchedCount += 1
    if (parameterValuesMatch(current.value, entry.value)) {
      unchangedCount += 1
      return
    }

    draftValues[entry.id] = String(entry.value)
    changedCount += 1
  })

  return {
    draftValues,
    matchedCount,
    changedCount,
    unchangedCount,
    unknownParameterIds: unknownParameterIds.sort((left, right) => left.localeCompare(right)),
    excludedCount
  }
}

/**
 * Synthesize a ParameterState[] from a backup file for use as the
 * "baseline" arg to `deriveDraftValuesFromParameterBackup`, so the
 * snapshot-vs-snapshot compare runs through the same diff machinery as
 * the snapshot-vs-live path.
 *
 * The `definition` slot is hydrated from `referenceDefinitions` where ids
 * match; ids with no live counterpart still emit with `definition`
 * undefined so they surface as raw id rows. Index / count are best-effort
 * (array order and post-filter length) — required by the ParameterState
 * shape but not relied on by the diff.
 */
export function buildParametersFromBackup(
  backup: ParameterBackupFile,
  referenceDefinitions: ReadonlyMap<string, ParameterState>
): ParameterState[] {
  const real = backup.parameters.filter((entry) => !isSnapshotExcludedBackupEntry(entry))
  return real.map((entry, index) => {
    const ref = referenceDefinitions.get(entry.id)
    return {
      id: entry.id,
      value: entry.value,
      index,
      count: real.length,
      definition: ref?.definition
    }
  })
}

function isParameterBackupFile(value: unknown): value is ParameterBackupFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<ParameterBackupFile>
  if (candidate.schemaVersion !== 1 || candidate.application !== 'ArduConfigurator' || !Array.isArray(candidate.parameters)) {
    return false
  }

  return candidate.parameters.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Partial<ParameterBackupEntry>).id === 'string' &&
      typeof (entry as Partial<ParameterBackupEntry>).value === 'number'
  )
}

function isSnapshotExcludedParameterState(parameter: ParameterState): boolean {
  // Skip alias-mirror entries: they duplicate a real arrival's value under a
  // renamed counterpart id, so serializing both double-writes on restore.
  if (parameter.aliasedFrom !== undefined) {
    return true
  }
  return parameter.definition?.snapshotExcluded === true || SNAPSHOT_EXCLUDED_PREFIXES.some((prefix) => parameter.id.startsWith(prefix))
}

function isSnapshotExcludedBackupEntry(entry: ParameterBackupEntry): boolean {
  return SNAPSHOT_EXCLUDED_PREFIXES.some((prefix) => entry.id.startsWith(prefix))
}

function parameterValuesMatch(left: number, right: number, tolerance = SNAPSHOT_COMPARE_TOLERANCE): boolean {
  return Object.is(left, right) || Math.abs(left - right) <= tolerance
}
