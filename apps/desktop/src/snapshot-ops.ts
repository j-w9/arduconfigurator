import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  ArduPilotConfiguratorRuntime,
  createParameterSnapshotFromLiveSnapshot,
  createParameterSnapshotLibrary,
  deriveDraftValuesFromParameterBackup,
  deriveParameterDraftEntries,
  groupParameterDraftEntries,
  parseParameterSnapshotInput,
  resolveParameterSnapshotInput,
  serializeParameterBackup,
  serializeParameterSnapshotLibrary,
  type ConfiguratorSnapshot,
  type ParameterDraftEntry,
  type ParameterSnapshotLibraryFile,
} from '@arduconfig/ardupilot-core'

export interface SnapshotCommandOptions {
  captureSnapshot: boolean
  listSnapshotLibrary: boolean
  compareSnapshot: boolean
  restoreSnapshot: boolean
  executeSnapshotRestore: boolean
  snapshotInputFile?: string
  snapshotOutputFile?: string
  snapshotLibraryFile?: string
  snapshotLabel?: string
  snapshotNote?: string
  snapshotTags: string[]
  snapshotProtected: boolean
  snapshotSelectId?: string
  snapshotSelectLabel?: string
  parameterWriteVerifyTimeoutMs: number
}

export interface SnapshotRestoreDecision {
  allowed: boolean
  reasons: string[]
}

interface SnapshotComparison {
  changedEntries: ParameterDraftEntry[]
  invalidEntries: ParameterDraftEntry[]
  groupedChangedEntries: ReturnType<typeof groupParameterDraftEntries>
  unknownParameterIds: string[]
  changedCount: number
  unchangedCount: number
  rebootRequiredCount: number
}

export async function listSnapshotLibraryFile(path: string | undefined, logPrefix: string): Promise<void> {
  if (!path) {
    throw new Error('Pass --snapshot-library-file=/path/to/library.json to inspect a desktop snapshot library.')
  }

  const input = parseParameterSnapshotInput(await readTextFile(path))
  if (input.kind !== 'library') {
    throw new Error(`Snapshot input ${path} is a single backup file, not a snapshot library.`)
  }

  console.log(`${logPrefix} snapshot library: ${input.library.name}`)
  console.log(`${logPrefix} snapshot entries: ${input.library.snapshots.length}`)

  if (input.library.snapshots.length === 0) {
    console.log(`${logPrefix} snapshot library is empty.`)
    return
  }

  input.library.snapshots.forEach((snapshot, index) => {
    const metadata = [
      `${snapshot.backup.parameterCount} params`,
      snapshot.protected ? 'protected' : undefined,
      snapshot.tags.length > 0 ? `tags=${snapshot.tags.join(',')}` : undefined
    ]
      .filter((value): value is string => value !== undefined)
      .join(' | ')

    console.log(
      `${logPrefix} [${index}] id=${snapshot.id} label="${snapshot.label}" captured=${snapshot.capturedAt}${metadata ? ` :: ${metadata}` : ''}`
    )
    if (snapshot.note) {
      console.log(`${logPrefix}      note: ${snapshot.note}`)
    }
  })
}

export async function maybeRunSnapshotOperations(
  runtime: ArduPilotConfiguratorRuntime,
  snapshot: ConfiguratorSnapshot,
  options: SnapshotCommandOptions,
  context: {
    logPrefix: string
    evaluateRestore: (snapshot: ConfiguratorSnapshot) => SnapshotRestoreDecision
  }
): Promise<ConfiguratorSnapshot> {
  let latestSnapshot = snapshot

  if (options.captureSnapshot) {
    ensureSnapshotCaptureDestination(options)
    const savedSnapshot = createParameterSnapshotFromLiveSnapshot(latestSnapshot, options.snapshotLabel, {
      source: 'captured',
      note: options.snapshotNote,
      tags: options.snapshotTags,
      protected: options.snapshotProtected
    })

    if (options.snapshotOutputFile) {
      await writeFile(options.snapshotOutputFile, serializeParameterBackup(savedSnapshot.backup), 'utf8')
      console.log(
        `${context.logPrefix} snapshot capture: wrote "${savedSnapshot.label}" to backup file ${options.snapshotOutputFile}`
      )
    }

    if (options.snapshotLibraryFile) {
      const existingLibrary = await readSnapshotLibraryOrCreate(options.snapshotLibraryFile)
      const updatedLibrary = {
        ...existingLibrary,
        snapshots: [...existingLibrary.snapshots.filter((entry) => entry.id !== savedSnapshot.id), savedSnapshot]
      }
      await writeFile(
        options.snapshotLibraryFile,
        serializeParameterSnapshotLibrary(createParameterSnapshotLibrary(existingLibrary.name, updatedLibrary.snapshots)),
        'utf8'
      )
      console.log(
        `${context.logPrefix} snapshot capture: stored "${savedSnapshot.label}" in library ${options.snapshotLibraryFile}`
      )
    }
  }

  if (!options.compareSnapshot && !options.restoreSnapshot) {
    return latestSnapshot
  }

  const inputPath = options.snapshotInputFile ?? options.snapshotLibraryFile
  if (!inputPath) {
    throw new Error(
      'Pass --snapshot-input-file=/path/to/backup-or-library.json or --snapshot-library-file=/path/to/library.json before comparing or restoring snapshots.'
    )
  }

  const selectedSnapshot = resolveParameterSnapshotInput(parseParameterSnapshotInput(await readTextFile(inputPath)), {
    id: options.snapshotSelectId,
    label: options.snapshotSelectLabel
  })
  const comparison = buildSnapshotComparison(latestSnapshot, selectedSnapshot.backup)

  printSnapshotComparison(context.logPrefix, selectedSnapshot, comparison)

  if (!options.restoreSnapshot) {
    return latestSnapshot
  }

  if (!options.executeSnapshotRestore) {
    console.log(
      `${context.logPrefix} snapshot restore dry-run: no parameter write sent. Re-run with --execute-snapshot-restore to actually restore the diff.`
    )
    return latestSnapshot
  }

  const decision = context.evaluateRestore(latestSnapshot)
  decision.reasons.forEach((reason) => {
    console.log(`${context.logPrefix} snapshot restore note: ${reason}`)
  })

  if (!decision.allowed) {
    throw new Error('Snapshot restore is blocked by runtime safeguards.')
  }

  if (comparison.invalidEntries.length > 0) {
    throw new Error(`Snapshot restore is blocked because ${comparison.invalidEntries.length} restore value(s) are invalid.`)
  }

  if (comparison.changedEntries.length === 0) {
    console.log(`${context.logPrefix} snapshot restore note: selected snapshot already matches the live controller values.`)
    return latestSnapshot
  }

  const result = await runtime.setParameters(
    comparison.changedEntries.map((entry) => ({
      paramId: entry.id,
      paramValue: entry.nextValue as number
    })),
    {
      verifyTimeoutMs: options.parameterWriteVerifyTimeoutMs
    }
  )

  console.log(
    `${context.logPrefix} snapshot restore verified: applied=${result.applied.length} rolledBack=${result.rolledBack.length}`
  )

  latestSnapshot = runtime.getSnapshot()
  return latestSnapshot
}

async function readSnapshotLibraryOrCreate(path: string): Promise<ParameterSnapshotLibraryFile> {
  try {
    const input = parseParameterSnapshotInput(await readTextFile(path))
    if (input.kind !== 'library') {
      throw new Error(`Snapshot file ${path} is a single backup, not a snapshot library.`)
    }

    return input.library
  } catch (error) {
    if (isFileMissingError(error)) {
      return createParameterSnapshotLibrary(defaultLibraryName(path))
    }
    throw error
  }
}

function defaultLibraryName(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '') || 'ArduConfigurator Snapshot Library'
}

function ensureSnapshotCaptureDestination(options: SnapshotCommandOptions): void {
  if (options.snapshotOutputFile || options.snapshotLibraryFile) {
    return
  }

  throw new Error(
    'Pass --snapshot-output-file=/path/to/backup.json and/or --snapshot-library-file=/path/to/library.json before capturing a snapshot.'
  )
}

function buildSnapshotComparison(snapshot: ConfiguratorSnapshot, backup: ReturnType<typeof resolveParameterSnapshotInput>['backup']): SnapshotComparison {
  const restore = deriveDraftValuesFromParameterBackup(snapshot.parameters, backup)
  const draftEntries = deriveParameterDraftEntries(snapshot.parameters, restore.draftValues)
  const changedEntries = draftEntries.filter((entry) => entry.status === 'staged')
  const invalidEntries = draftEntries.filter((entry) => entry.status === 'invalid')

  return {
    changedEntries,
    invalidEntries,
    groupedChangedEntries: groupParameterDraftEntries(draftEntries, ['staged']),
    unknownParameterIds: restore.unknownParameterIds,
    changedCount: restore.changedCount,
    unchangedCount: restore.unchangedCount,
    rebootRequiredCount: changedEntries.filter((entry) => entry.definition?.rebootRequired).length
  }
}

function printSnapshotComparison(
  logPrefix: string,
  selectedSnapshot: ReturnType<typeof resolveParameterSnapshotInput>,
  comparison: SnapshotComparison
): void {
  console.log(
    `${logPrefix} snapshot selected: "${selectedSnapshot.label}" captured=${selectedSnapshot.capturedAt} source=${selectedSnapshot.source}`
  )

  const metadata = [
    `${selectedSnapshot.backup.parameterCount} params`,
    selectedSnapshot.protected ? 'protected' : undefined,
    selectedSnapshot.tags.length > 0 ? `tags=${selectedSnapshot.tags.join(',')}` : undefined
  ]
    .filter((value): value is string => value !== undefined)
    .join(' | ')

  if (metadata) {
    console.log(`${logPrefix} snapshot metadata: ${metadata}`)
  }

  if (selectedSnapshot.note) {
    console.log(`${logPrefix} snapshot note: ${selectedSnapshot.note}`)
  }

  console.log(
    `${logPrefix} snapshot diff: changed=${comparison.changedCount} unchanged=${comparison.unchangedCount} unknown=${comparison.unknownParameterIds.length} invalid=${comparison.invalidEntries.length} rebootSensitive=${comparison.rebootRequiredCount}`
  )

  comparison.groupedChangedEntries.forEach((group) => {
    console.log(`${logPrefix} snapshot diff group: ${group.category} -> ${group.entries.length} changed`)
  })

  comparison.changedEntries.slice(0, 12).forEach((entry) => {
    console.log(
      `${logPrefix} snapshot diff param: ${entry.id} ${formatDraftValue(entry.currentValue)} -> ${formatDraftValue(entry.nextValue)}`
    )
  })

  if (comparison.changedEntries.length > 12) {
    console.log(`${logPrefix} snapshot diff: plus ${comparison.changedEntries.length - 12} more changed parameter(s).`)
  }

  if (comparison.unknownParameterIds.length > 0) {
    console.log(
      `${logPrefix} snapshot diff note: ignored ${comparison.unknownParameterIds.length} unknown parameter(s): ${comparison.unknownParameterIds.slice(0, 8).join(', ')}${
        comparison.unknownParameterIds.length > 8 ? ', ...' : ''
      }`
    )
  }
}

function formatDraftValue(value: number | undefined): string {
  if (value === undefined) {
    return 'undefined'
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '')
}

async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

function isFileMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')
}
