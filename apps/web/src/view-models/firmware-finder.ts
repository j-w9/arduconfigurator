// The Flash tab's firmware finder: search ArduPilot's published builds, and
// pre-select the one for the connected board. Pure; the finder view and the
// index source (the private deploy's /fw/index.json) feed it.
//
// Board ids are shared by variants -- MatekH743 and MatekH743-bdshot are both
// 1013, CubeOrange shares with CubeOrange-bdshot -- and the flasher's board
// check (which compares ids) cannot tell them apart. The exact target comes
// from the boot banner instead: its first word is the hwdef directory name,
// which is the firmware server's target ("platform").

import { BOARD_NAMES_BY_ID } from '@arduconfig/firmware-flash'

export type FirmwareChannel = 'OFFICIAL' | 'BETA' | 'DEV'

export interface FirmwareIndexRow {
  platform: string
  boardId: number
  /** firmware.ardupilot.org vehicle folder: Copter, Plane, Rover, ... */
  vehicle: string
  /** MAVLink type: "HELICOPTER" marks a heli build in the Copter folder. */
  mavType: string
  channel: FirmwareChannel
  version: string
  brand: string
  manufacturer: string
  /** Path under https://firmware.ardupilot.org/ */
  path: string
  /** The build's commit (manifest git-sha); '' in an index from before it was listed. */
  gitSha: string
}

/** What the finder offers in its Vehicle picker. Heli is Copter's heli build. */
export const FINDER_VEHICLES = ['Copter', 'Heli', 'Plane', 'Rover', 'Sub', 'Blimp', 'AntennaTracker'] as const
export type FinderVehicle = (typeof FINDER_VEHICLES)[number]

export const FINDER_CHANNELS: readonly { id: FirmwareChannel; label: string }[] = [
  { id: 'OFFICIAL', label: 'Stable' },
  { id: 'BETA', label: 'Beta' },
  { id: 'DEV', label: 'Latest (dev)' }
]

/** The index file's rows, or an error saying why it is not one. */
export function parseFirmwareIndex(json: unknown): FirmwareIndexRow[] {
  const index = json as { format?: number; columns?: string[]; rows?: unknown[][] }
  if (!index || index.format !== 1 || !Array.isArray(index.rows) || !Array.isArray(index.columns)) {
    throw new Error('Not a firmware index.')
  }
  const at = (name: string) => index.columns!.indexOf(name)
  const columns = {
    platform: at('platform'),
    boardId: at('boardId'),
    vehicle: at('vehicle'),
    mavType: at('mavType'),
    channel: at('channel'),
    version: at('version'),
    brand: at('brand'),
    manufacturer: at('manufacturer'),
    path: at('path')
  }
  if (Object.values(columns).some((column) => column < 0)) throw new Error('The firmware index is missing columns.')
  // Optional: indexes built before it was added have no gitSha column.
  const gitShaColumn = at('gitSha')
  return index.rows
    .filter((row) => Array.isArray(row) && typeof row[columns.platform] === 'string' && typeof row[columns.path] === 'string')
    .map((row) => ({
      platform: String(row[columns.platform]),
      boardId: Number(row[columns.boardId]),
      vehicle: String(row[columns.vehicle]),
      mavType: String(row[columns.mavType] ?? ''),
      channel: String(row[columns.channel]) as FirmwareChannel,
      version: String(row[columns.version] ?? ''),
      brand: String(row[columns.brand] ?? ''),
      manufacturer: String(row[columns.manufacturer] ?? ''),
      path: String(row[columns.path]),
      gitSha: gitShaColumn >= 0 ? String(row[gitShaColumn] ?? '') : ''
    }))
}

export function finderVehicleOf(row: FirmwareIndexRow): string {
  return row.mavType === 'HELICOPTER' ? 'Heli' : row.vehicle
}

/** The Vehicle picker's default for a connected vehicle ("ArduPlane" -> Plane). */
export function defaultFinderVehicle(connectedVehicle: string | undefined, heli = false): FinderVehicle {
  switch (connectedVehicle) {
    case 'ArduPlane':
      return 'Plane'
    case 'ArduRover':
      return 'Rover'
    case 'ArduSub':
      return 'Sub'
    default:
      return heli ? 'Heli' : 'Copter'
  }
}

export interface FirmwareTarget {
  platform: string
  boardId: number
  brand: string
  manufacturer: string
  version: string
  path: string
  gitSha: string
  /** The build running on the connected board (its banner names this target). */
  running: boolean
  /** Shares the connected board's id: a variant that will pass the board check. */
  sameBoard: boolean
}

export interface ConnectedBoard {
  boardId?: number
  /** The banner's board name: the running target, up to 23 characters. */
  boardName?: string
}

/** Does a target name match the banner's (which ArduPilot cuts at 23 characters)? */
export function isRunningTarget(platform: string, boardName: string | undefined): boolean {
  if (!boardName) return false
  const a = platform.toLowerCase()
  const b = boardName.toLowerCase()
  return a === b || (b.length === 23 && a.startsWith(b))
}

/**
 * The targets to offer, for the Board dropdown: every target of the vehicle
 * and release, or (with a query) those whose name, brand, manufacturer, board
 * id or board-type name holds all of its words. The connected board's own
 * builds come first, the one it is running at the top.
 */
export function findFirmwareTargets(
  rows: readonly FirmwareIndexRow[],
  options: { vehicle: FinderVehicle; channel: FirmwareChannel; query: string; board?: ConnectedBoard }
): FirmwareTarget[] {
  const { vehicle, channel, board } = options
  const words = options.query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  const seen = new Set<string>()
  const targets: FirmwareTarget[] = []
  for (const row of rows) {
    if (row.channel !== channel || finderVehicleOf(row) !== vehicle || seen.has(row.platform)) continue
    const sameBoard = board?.boardId !== undefined && row.boardId === board.boardId
    if (words.length > 0) {
      const haystack = `${row.platform} ${row.brand} ${row.manufacturer} ${row.boardId} ${BOARD_NAMES_BY_ID[row.boardId] ?? ''}`.toLowerCase()
      if (!words.every((word) => haystack.includes(word))) continue
    }
    seen.add(row.platform)
    targets.push({
      platform: row.platform,
      boardId: row.boardId,
      brand: row.brand,
      manufacturer: row.manufacturer,
      version: row.version,
      path: row.path,
      gitSha: row.gitSha,
      running: isRunningTarget(row.platform, board?.boardName),
      sameBoard
    })
  }
  const first = words[0] ?? ''
  const rank = (target: FirmwareTarget) =>
    (target.running ? 0 : 4) + (target.sameBoard ? 0 : 2) + (first && target.platform.toLowerCase().startsWith(first) ? 0 : 1)
  return targets.sort((left, right) => rank(left) - rank(right) || left.platform.localeCompare(right.platform))
}

/** The target to pre-select: the running build, else the board's only variant. */
export function autoSelectTarget(targets: readonly FirmwareTarget[]): FirmwareTarget | undefined {
  const running = targets.find((target) => target.running)
  if (running) return running
  const sameBoard = targets.filter((target) => target.sameBoard)
  return sameBoard.length === 1 ? sameBoard[0] : undefined
}

/** What to say before loading a target onto the connected board, if anything. */
export function targetWarning(target: FirmwareTarget, board: ConnectedBoard | undefined): string | undefined {
  if (!board) return undefined
  if (board.boardId !== undefined && target.boardId !== board.boardId) {
    return `Built for board id ${target.boardId}; the connected board is ${board.boardId}. The flasher will refuse it.`
  }
  if (board.boardName && !target.running && target.sameBoard) {
    return `A different variant from the one running (${board.boardName}). It fits this board, but its outputs or features may differ (bdshot, for one).`
  }
  return undefined
}

/**
 * Is this downloaded .apj the build the index listed? Its git_identity (the
 * short commit ArduPilot stamps in the file) must start the listed git-sha.
 * Undefined when it is (or when either side does not say); otherwise why not.
 */
export function apjBuildMismatch(apjText: string, expectedGitSha: string): string | undefined {
  if (!expectedGitSha) return undefined
  let identity: unknown
  try {
    identity = (JSON.parse(apjText) as { git_identity?: unknown }).git_identity
  } catch {
    return 'The download is not an .apj file.'
  }
  if (typeof identity !== 'string' || identity === '') return undefined
  if (expectedGitSha.toLowerCase().startsWith(identity.toLowerCase())) return undefined
  return `The server sent build ${identity}, not the listed ${expectedGitSha.slice(0, 8)}. A new release may still be reaching it; try again in a few minutes.`
}

/** Identifies one build of one target: what "Downloaded" refers to. */
export function firmwareBuildKey(target: Pick<FirmwareTarget, 'path' | 'gitSha'>): string {
  return `${target.path}@${target.gitSha}`
}
