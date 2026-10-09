// The CAN tab's node firmware picker: every AP_Periph build in a dropdown,
// the node's own pre-selected when it can be told. Pure.
//
// Two ways to tell: AP_Periph names its node "org.ardupilot.<board>"
// (Tools/AP_Periph/AP_Periph.h, CAN_APP_NODE_NAME), and <board> is the
// firmware server's target ("platform"); and hardware_version carries the
// board id (major = id >> 8, minor = id & 0xff, Tools/AP_Periph/can.cpp).
// Vendor names ("io.mrobotics.m10070_loc1") or vendor firmware match neither,
// and the operator picks from the list.

export interface PeriphBuild {
  url: string
  platform: string
  boardId: number
  versionLabel: string
  /** "Stable" / "Beta" / "Dev". */
  releaseLabel: string
  gitSha?: string
}

export interface PeriphNodeIdentity {
  name?: string
  boardId?: number
}

export type PeriphMatch = 'name' | 'board' | undefined

/** The build target a node's name points at: "org.ardupilot.MatekL431-GPS(3)" -> "MatekL431-GPS". */
export function periphTargetFromName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const bare = name.replace(/\(\d+\)$/, '')
  return bare.startsWith('org.ardupilot.') ? bare.slice('org.ardupilot.'.length) : undefined
}

export function periphBuildMatch(build: PeriphBuild, node: PeriphNodeIdentity): PeriphMatch {
  const target = periphTargetFromName(node.name)
  if (target && build.platform.toLowerCase() === target.toLowerCase()) return 'name'
  if (node.boardId !== undefined && build.boardId === node.boardId) return 'board'
  return undefined
}

export interface PeriphPickerOption extends PeriphBuild {
  match: PeriphMatch
}

/**
 * The dropdown: one channel's builds, filtered by the search words (target
 * or board id), the node's own first -- a name match above a board-id one.
 */
export function periphPickerOptions(
  builds: readonly PeriphBuild[],
  options: { channel: string; query: string; node: PeriphNodeIdentity }
): PeriphPickerOption[] {
  const words = options.query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  const rank = (match: PeriphMatch) => (match === 'name' ? 0 : match === 'board' ? 1 : 2)
  return builds
    .filter((build) => build.releaseLabel === options.channel)
    .map((build) => ({ ...build, match: periphBuildMatch(build, options.node) }))
    .filter((build) => build.match !== undefined || words.every((word) => `${build.platform} ${build.boardId}`.toLowerCase().includes(word)))
    .sort((left, right) => rank(left.match) - rank(right.match) || left.platform.localeCompare(right.platform))
}

/** What to pre-select: a name match, else the only board-id match. */
export function periphPreselect(options: readonly PeriphPickerOption[]): PeriphPickerOption | undefined {
  const byName = options.find((option) => option.match === 'name')
  if (byName) return byName
  const byBoard = options.filter((option) => option.match === 'board')
  return byBoard.length === 1 ? byBoard[0] : undefined
}
