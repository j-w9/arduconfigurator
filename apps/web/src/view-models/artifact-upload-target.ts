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

/** Singular form, used when one item out of a library is being uploaded. */
const KIND_ITEM_SUFFIX: Record<ArtifactUploadKind, string> = {
  parameters: 'params',
  presets: 'preset',
  snapshots: 'snapshot'
}

export interface ArtifactUploadTarget {
  folder: string
  fileName: string
}

/** What the operator filled in before pressing Upload. */
export interface ArtifactUploadAnswers {
  /** Already normalised by {@link resolveArtifactUploadFileName}. */
  fileName: string
  note: string
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
 *
 * `itemLabel` names one item out of a library (a single saved snapshot, say)
 * rather than the whole library, so the file is identifiable without opening it.
 */
export function buildArtifactUploadTarget(
  snapshot: ConfiguratorSnapshot,
  kind: ArtifactUploadKind,
  extension = 'json',
  todayIso = new Date().toISOString().slice(0, 10),
  itemLabel?: string
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

  const suffix =
    itemLabel === undefined
      ? KIND_SUFFIX[kind]
      : `${KIND_ITEM_SUFFIX[kind]}-${slug(itemLabel) || 'unnamed'}`

  return {
    folder,
    fileName: `${aircraft}_${todayIso}_${suffix}.${extension}`
  }
}

/**
 * The editable part of a derived name: everything before the extension.
 *
 * Shown prefilled in the upload form. The extension is deliberately not
 * editable — the server classifies on it, and an operator renaming a JSON
 * backup to ".txt" gets a file the server files as something else.
 */
export function artifactUploadNameFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/**
 * Longest name kept. Not a server limit — a limit on what stays readable in a
 * directory listing, and a hard stop on a paste of an entire log into the field.
 */
const MAX_NAME_LENGTH = 100

/**
 * Turn what the operator typed into the filename actually uploaded.
 *
 * Normalisation matches the derived names rather than {@link slug}: those
 * already contain underscores (`ark-fpv_2026-08-10_params.json`), so an
 * untouched prefilled default has to survive this untouched too — collapsing
 * `_` to `-` would silently rename the one-click common path. Everything else
 * outside `[a-z0-9._-]` collapses to a single dash, which also disposes of path
 * separators and `..`, so a typed name can never point outside its folder.
 *
 * An empty or all-punctuation answer falls back to the derived default: a blank
 * field means "whatever you were going to call it", not a nameless file.
 */
export function resolveArtifactUploadFileName(defaultFileName: string, typedName: string): string {
  const dot = defaultFileName.lastIndexOf('.')
  const extension = dot > 0 ? defaultFileName.slice(dot + 1) : ''

  let name = typedName.trim().toLowerCase()
  if (extension.length > 0 && name.endsWith(`.${extension.toLowerCase()}`)) {
    // Typing the extension back is the obvious thing to do; don't double it.
    name = name.slice(0, -(extension.length + 1))
  }
  name = name
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-._]+$/g, '')

  if (name.length === 0) {
    return defaultFileName
  }
  return extension.length > 0 ? `${name}.${extension}` : name
}
