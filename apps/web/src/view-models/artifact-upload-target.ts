import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

// Where a configuration export lands on the operator's log server, and what it
// is called when it gets there.
//
// The whole point of uploading config beside flights is being able to ask "the
// tune changed and the next flight oscillated" — which only works if both halves
// file under the same aircraft. So the folder is derived from vehicle identity
// the same way a log's is, not from whatever tab the operator happened to be on.
//
// Names are built to sort and to be recognisable a year later in a directory
// listing, without opening anything: aircraft, then date, then what it is.

/** Same normalisation the server applies, done here so the caller can preview it. */
function slug(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type ArtifactUploadKind = 'parameters' | 'presets' | 'snapshots'

const KIND_SUFFIX: Record<ArtifactUploadKind, string> = {
  parameters: 'params',
  presets: 'presets',
  snapshots: 'snapshots'
}

export interface ArtifactUploadTarget {
  folder: string
  fileName: string
}

/**
 * Build the folder and filename for one upload.
 *
 * The aircraft key prefers the board's own name from its boot banner, falling
 * back to the APJ board id and finally the vehicle type. That order matters: the
 * banner name is the firmware's own answer and survives a board this app has
 * never catalogued, where the id alone would file two different aircraft under
 * the same bare number.
 *
 * `todayIso` is injected so the naming is testable without freezing the clock.
 */
export function buildArtifactUploadTarget(
  snapshot: ConfiguratorSnapshot,
  kind: ArtifactUploadKind,
  extension = 'json',
  todayIso = new Date().toISOString().slice(0, 10)
): ArtifactUploadTarget {
  const board = snapshot.hardware?.board
  const aircraft =
    slug(board?.reportedBoardName) ||
    (board?.boardType !== undefined && board.boardType > 0 ? `board-${board.boardType}` : '') ||
    slug(snapshot.vehicle?.vehicle) ||
    'unknown-aircraft'

  // Month-level grouping: a busy aircraft accumulates dozens of these, and a
  // flat per-aircraft folder stops being readable quickly. Matches the shape
  // suggested for logs ("Hexacopter A/2026-08").
  const folder = `${aircraft}/${todayIso.slice(0, 7)}`

  return {
    folder,
    fileName: `${aircraft}_${todayIso}_${KIND_SUFFIX[kind]}.${extension}`
  }
}
