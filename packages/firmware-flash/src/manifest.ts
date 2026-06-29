// ArduPilot firmware-index (firmware.ardupilot.org/manifest.json) client.
//
// Pure parsing + selection. The actual fetch is injected (DI) so this
// package stays dependency-free and isomorphic and the app decides the
// transport (direct fetch where CORS allows, else a desktop bridge
// proxy). Schema is verbatim from ArduPilot Tools/scripts/
// generate_manifest.py: top-level { "format-version", "firmware":[...] }.

export type VehicleType =
  | 'Copter'
  | 'Plane'
  | 'Rover'
  | 'Sub'
  | 'AntennaTracker'
  | 'AP_Periph'
  | 'Blimp'

// generate_manifest.py releasetype_map(): "stable" -> "OFFICIAL", others
// uppercased. "DEV" is the dev tip; "DIRTY" a tree with local changes;
// archived stable releases are typed "STABLE-x.y.z". The template literal
// keeps archived stables selectable rather than dropped at parse time.
// "LATEST" is kept for parse tolerance only.
export type ReleaseType = 'OFFICIAL' | 'BETA' | 'LATEST' | 'DEV' | 'DIRTY' | `STABLE-${string}`

export interface FirmwareEntry {
  vehicletype: VehicleType
  platform: string
  boardId: number
  url: string
  releaseType: ReleaseType
  versionStr: string
  /** generate_manifest.py emits latest as 0/1; surfaced as boolean. */
  latest: boolean
  format: string
  brandName?: string
  manufacturer?: string
  imageSize?: number
  gitSha?: string
}

export interface FirmwareManifest {
  formatVersion: string
  entries: FirmwareEntry[]
}

const VEHICLE_TYPES: ReadonlySet<string> = new Set([
  'Copter',
  'Plane',
  'Rover',
  'Sub',
  'AntennaTracker',
  'AP_Periph',
  'Blimp'
])

const STABLE_VERSIONED_RELEASE = /^STABLE-\d+\.\d+(?:\.\d+)?$/

function toReleaseType(raw: unknown): ReleaseType | undefined {
  if (typeof raw !== 'string') return undefined
  const v = raw.toUpperCase()
  if (v === 'OFFICIAL' || v === 'BETA' || v === 'LATEST' || v === 'DEV' || v === 'DIRTY') {
    return v as ReleaseType
  }
  // Archived stable releases: "STABLE-4.6.3" etc. Anything else stays
  // undefined (entry skipped).
  if (STABLE_VERSIONED_RELEASE.test(v)) {
    return v as ReleaseType
  }
  return undefined
}

/** Descending semver compare for "STABLE-x.y.z" suffixes (newest first). */
function compareStableVersionsDesc(left: string, right: string): number {
  const parse = (value: string) => value.slice('STABLE-'.length).split('.').map((part) => Number(part))
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < 3; i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function isHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}

function toBoardId(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw)
  return undefined
}

/**
 * Parse a manifest. Malformed/foreign entries (missing board id, non-apj
 * format, unknown vehicle/release) are skipped rather than throwing — the
 * real manifest has thousands of entries and a few odd ones must not
 * block selecting a valid firmware for the user's board.
 */
export function parseManifest(text: string): FirmwareManifest {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Invalid manifest: not valid JSON')
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid manifest: expected a JSON object')
  }
  const root = json as Record<string, unknown>
  const list = root.firmware
  if (!Array.isArray(list)) {
    throw new Error('Invalid manifest: missing "firmware" array')
  }
  const entries: FirmwareEntry[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Record<string, unknown>
    const boardId = toBoardId(e.board_id)
    const releaseType = toReleaseType(e['mav-firmware-version-type'])
    const vehicletype = e.vehicletype
    if (
      boardId === undefined ||
      releaseType === undefined ||
      // url is fetched (direct or via the CORS proxy); only allow https
      // so a hostile manifest can't point the client at javascript:/
      // data:/http: or an attacker origin.
      !isHttpsUrl(e.url) ||
      typeof vehicletype !== 'string' ||
      !VEHICLE_TYPES.has(vehicletype)
    ) {
      continue
    }
    entries.push({
      vehicletype: vehicletype as VehicleType,
      platform: typeof e.platform === 'string' ? e.platform : '',
      boardId,
      url: e.url,
      releaseType,
      versionStr: typeof e['mav-firmware-version-str'] === 'string' ? (e['mav-firmware-version-str'] as string) : '',
      latest: e.latest === 1 || e.latest === true,
      format: typeof e.format === 'string' ? e.format : 'apj',
      brandName: typeof e.brand_name === 'string' ? e.brand_name : undefined,
      manufacturer: typeof e.manufacturer === 'string' ? e.manufacturer : undefined,
      imageSize: typeof e.image_size === 'number' ? e.image_size : undefined,
      gitSha: typeof e['git-sha'] === 'string' ? (e['git-sha'] as string) : undefined
    })
  }
  return {
    formatVersion: typeof root['format-version'] === 'string' ? (root['format-version'] as string) : '',
    entries
  }
}

export interface FirmwareQuery {
  /** Board id read from the bootloader's identify() — the precise match. */
  boardId: number
  vehicletype?: VehicleType
  /** Defaults to OFFICIAL (stable releases). */
  releaseType?: ReleaseType
}

/** All `.apj` entries for a board (optionally a vehicle), newest-first-ish. */
export function firmwaresForBoard(
  manifest: FirmwareManifest,
  boardId: number,
  vehicletype?: VehicleType
): FirmwareEntry[] {
  return manifest.entries.filter(
    (e) =>
      e.boardId === boardId &&
      e.format === 'apj' &&
      (vehicletype === undefined || e.vehicletype === vehicletype)
  )
}

/** Release types actually available for a board (for a UI selector). */
export function availableReleaseTypes(
  manifest: FirmwareManifest,
  boardId: number,
  vehicletype?: VehicleType
): ReleaseType[] {
  const seen = new Set<ReleaseType>()
  for (const e of firmwaresForBoard(manifest, boardId, vehicletype)) seen.add(e.releaseType)
  // Fixed channels first (current stable -> beta -> dev tip), then the
  // archived STABLE-x.y.z versions newest-first.
  const order: ReleaseType[] = ['OFFICIAL', 'BETA', 'LATEST', 'DEV', 'DIRTY']
  const fixed = order.filter((r) => seen.has(r))
  const archived = [...seen]
    .filter((r) => r.startsWith('STABLE-'))
    .sort(compareStableVersionsDesc)
  return [...fixed, ...archived]
}

/**
 * Pick the single best firmware to offer by default: the requested
 * release type for the board/vehicle, preferring entries flagged
 * `latest`. Returns undefined if nothing matches.
 */
export function selectFirmware(
  manifest: FirmwareManifest,
  query: FirmwareQuery
): FirmwareEntry | undefined {
  const releaseType = query.releaseType ?? 'OFFICIAL'
  const candidates = firmwaresForBoard(manifest, query.boardId, query.vehicletype).filter(
    (e) => e.releaseType === releaseType
  )
  if (candidates.length === 0) return undefined
  const flagged = candidates.find((e) => e.latest)
  return flagged ?? candidates[0]
}

// --- DroneCAN peripheral (AP_Periph) node firmware matching --------------
//
// A DroneCAN node reports its identity over uavcan.protocol.GetNodeInfo:
// `name` (e.g. "org.ardupilot.<board>") and a `hardware_version` whose major
// and minor bytes are the high and low bytes of the board's APJ_BOARD_ID:
//
//   Tools/AP_Periph/can.cpp:
//     pkt.hardware_version.major = APJ_BOARD_ID >> 8;
//     pkt.hardware_version.minor = APJ_BOARD_ID & 0xFF;
//
// That reconstructed APJ_BOARD_ID is the SAME integer the firmware manifest
// carries as `board_id` for vehicletype "AP_Periph", so it is the precise
// match key — exactly like the FC flasher matches its board id. The node name
// ("org.ardupilot." + CHIBIOS_BOARD_NAME) is a human-facing label only (board
// ids can be shared across brand variants); it is not the match key.

/** Reconstruct a DroneCAN node's APJ board id from the major/minor bytes of its
 *  GetNodeInfo hardware_version (board_id = major<<8 | minor). Returns undefined
 *  when the node hasn't reported a hardware version yet. */
export function dronecanNodeBoardId(
  hwVersion: { major: number; minor: number } | undefined
): number | undefined {
  if (!hwVersion) {
    return undefined
  }
  const { major, minor } = hwVersion
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return undefined
  }
  return ((major & 0xff) << 8) | (minor & 0xff)
}

export interface DronecanNodeFirmwareQuery {
  /** APJ board id the node reported, reconstructed via dronecanNodeBoardId from
   *  GetNodeInfo hardware_version. The match key. Undefined when the node hasn't
   *  answered GetNodeInfo yet. */
  boardId?: number
  /** DroneCAN node name, surfaced to the operator; not used to filter. */
  name?: string
  /** Optional release-channel filter. Omit to return every release. */
  releaseType?: ReleaseType
}

/**
 * AP_Periph firmware candidates for a detected DroneCAN node, in the same
 * channel order as firmwaresForBoard. Matches strictly on board id against
 * vehicletype "AP_Periph" `.apj` entries; returns [] when the node's board id
 * is unknown (no GetNodeInfo yet) so the UI can prompt for identity rather than
 * offer an unmatched image. An optional releaseType narrows to one channel.
 */
export function firmwaresForDronecanNode(
  manifest: FirmwareManifest,
  query: DronecanNodeFirmwareQuery
): FirmwareEntry[] {
  if (query.boardId === undefined || !Number.isFinite(query.boardId)) {
    return []
  }
  const candidates = firmwaresForBoard(manifest, query.boardId, 'AP_Periph')
  if (query.releaseType === undefined) {
    return candidates
  }
  return candidates.filter((entry) => entry.releaseType === query.releaseType)
}

/** Release channels available for a node's board (for a UI selector). Empty
 *  when the board id is unknown or no AP_Periph firmware matches. */
export function dronecanNodeReleaseTypes(
  manifest: FirmwareManifest,
  boardId: number | undefined
): ReleaseType[] {
  if (boardId === undefined || !Number.isFinite(boardId)) {
    return []
  }
  return availableReleaseTypes(manifest, boardId, 'AP_Periph')
}

export type ManifestFetcher = () => Promise<string>

/** Fetch + parse via an injected fetcher (app supplies direct/proxied fetch). */
export async function fetchManifest(fetcher: ManifestFetcher): Promise<FirmwareManifest> {
  return parseManifest(await fetcher())
}
