// Parameter backup import/export I/O. Owns the three "Export Backup"
// serializers (ArduConfigurator JSON / Mission Planner .parm /
// QGroundControl .params) and the "Import Backup" file handler that parses a
// backup, holds the differing values as a PENDING import for the operator to
// stage (honouring the opt-in import
// exclusions), and scrolls the diff into view.
//
// `handleOpenParameterBackup` (a one-line `.click()` on an App-owned <input>
// ref) lives in App.tsx: the ref is a DOM concern this hook has no need to
// know about, and none of the logic-bearing handlers touch it.

import { useState } from 'react'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'

import {
  createParameterBackup,
  deriveDraftValuesFromParameterBackup,
  parseParameterBackup,
  serializeParameterBackup,
  serializeParameterBackupAsParm,
  serializeParameterBackupAsParams,
  type ConfiguratorSnapshot,
  type ParameterImportCategory
} from '@arduconfig/ardupilot-core'

import { APP_VERSION, GIT_HASH, GIT_BRANCH } from '../build-info'
import { downloadTextFile } from '../download-file'
import { buildParameterBackupFilename } from '../library-helpers'
import {
  describeSnapshotBoardMatch,
  describeSnapshotFirmwareMatch,
  describeSnapshotVehicleMatch
} from '../view-models/snapshot-identity'
import type { ParameterDraftValues } from './use-parameter-drafts'
import type { ParameterFollowUp, ParameterNotice } from './use-parameter-feedback'

export interface UseParameterBackupIoParams {
  snapshot: ConfiguratorSnapshot
  parameterImportExclusions: Record<ParameterImportCategory, boolean>
  /** Categories to leave OUT of exported backups (calibration/stream-rates/mission). */
  parameterExportExclusions: Record<ParameterImportCategory, boolean>
  /** When set, export only these param ids ("export only changed / non-default"). */
  exportIncludeParamIds?: ReadonlySet<string>
  replaceDrafts: (drafts: ParameterDraftValues) => void
  /** Merge without clearing existing drafts — used when staging PART of an
   *  import, which must not wipe drafts staged from elsewhere. */
  mergeDrafts: (drafts: ParameterDraftValues) => void
  setParameterNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  setParameterFollowUp: Dispatch<SetStateAction<ParameterFollowUp | undefined>>
}

/** An import that has been READ but not staged. */
export interface PendingParameterImport {
  /** Draft values the import would stage, keyed by param id. */
  draftValues: ParameterDraftValues
  /** How many of those differ from the currently synced value. */
  changedCount: number
  /** Where it came from, for the prompt copy. */
  fileName: string
}

export interface UseParameterBackupIoResult {
  handleExportParameterBackup: () => void
  handleExportParameterBackupAsParm: () => void
  handleExportParameterBackupAsParams: () => void
  handleImportParameterBackup: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  /** Set once a file is read; cleared by staging or dismissing it. */
  pendingParameterImport: PendingParameterImport | undefined
  /** Stage every value from the pending import. */
  stagePendingParameterImport: () => void
  /**
   * Stage SOME of the pending import — one row, or one category — leaving the
   * rest pending. Without this the import was all-or-nothing: the values were
   * held out of the draft set, so there was no per-row control anywhere to
   * reach them with.
   */
  stagePendingParameterImportSubset: (paramIds: readonly string[]) => void
  /** Drop rows from the pending import without staging them. */
  dropPendingParameterImportEntries: (paramIds: readonly string[]) => void
  /** Throw the pending import away without staging anything. */
  dismissPendingParameterImport: () => void
  /**
   * Values a staged draft ORIGINALLY came from an import with, keyed by param
   * id. The staged row's editor is free to be nudged afterwards, at which point
   * the imported number is gone from the screen entirely — including the case
   * where the operator sets it back to the live value and the row reads
   * "matches current", with no way to see what the file had asked for. Keeping
   * the origin lets the row show Current / Import / New side by side.
   */
  importedDraftOrigins: Record<string, string>
}

export function useParameterBackupIo({
  snapshot,
  parameterImportExclusions,
  parameterExportExclusions,
  exportIncludeParamIds,
  replaceDrafts,
  mergeDrafts,
  setParameterNotice,
  setParameterFollowUp
}: UseParameterBackupIoParams): UseParameterBackupIoResult {
  // An import used to stage every differing value the instant the file was
  // read, which turns "let me look at this backup" into a pending write of
  // hundreds of parameters. Hold it here instead and let the operator decide.
  const [pendingParameterImport, setPendingParameterImport] = useState<PendingParameterImport>()
  const [importedDraftOrigins, setImportedDraftOrigins] = useState<Record<string, string>>({})
  function buildBackupAppInfo(): { appVersion: string; appGitHash: string; appGitBranch: string } {
    return { appVersion: APP_VERSION, appGitHash: GIT_HASH, appGitBranch: GIT_BRANCH }
  }

  function exportExcludeCategories(): ParameterImportCategory[] {
    return (Object.keys(parameterExportExclusions) as ParameterImportCategory[]).filter(
      (category) => parameterExportExclusions[category]
    )
  }

  function exportOptions(): { excludeCategories: ParameterImportCategory[]; includeParamIds?: ReadonlySet<string> } {
    return { excludeCategories: exportExcludeCategories(), includeParamIds: exportIncludeParamIds }
  }

  function exportSkipNote(): string {
    const skipped = exportExcludeCategories()
    const parts: string[] = []
    if (exportIncludeParamIds !== undefined) parts.push('changed only')
    if (skipped.length > 0) parts.push(`skipped ${skipped.join(', ')}`)
    return parts.length > 0 ? ` (${parts.join('; ')})` : ''
  }

  function handleExportParameterBackup(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo(), exportOptions())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'json'), serializeParameterBackup(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as ArduConfigurator JSON backup${exportSkipNote()}.`
    })
  }

  function handleExportParameterBackupAsParm(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo(), exportOptions())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'parm'), serializeParameterBackupAsParm(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as Mission Planner .parm${exportSkipNote()}.`
    })
  }

  function handleExportParameterBackupAsParams(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo(), exportOptions())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'params'), serializeParameterBackupAsParams(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as QGroundControl .params${exportSkipNote()}.`
    })
  }

  async function handleImportParameterBackup(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const backup = parseParameterBackup(await file.text())
      const excludeCategories = (
        Object.keys(parameterImportExclusions) as ParameterImportCategory[]
      ).filter((category) => parameterImportExclusions[category])
      const restore = deriveDraftValuesFromParameterBackup(snapshot.parameters, backup, {
        excludeCategories
      })
      // NOT staged yet — see pendingParameterImport.
      setPendingParameterImport({
        draftValues: restore.draftValues,
        changedCount: restore.changedCount,
        fileName: file.name
      })
      setParameterFollowUp(undefined)
      const unknownNote =
        restore.unknownParameterIds.length > 0
          ? ` Ignored ${restore.unknownParameterIds.length} unknown parameter(s).`
          : ''
      const excludedNote =
        restore.excludedCount > 0 ? ` Skipped ${restore.excludedCount} excluded parameter(s).` : ''
      // Cross-vehicle / cross-board migration callout: compare the backup's
      // captured identity (STM32 UID + vehicle) against the connected FC so an
      // import from a DIFFERENT board/vehicle is flagged, not silent.
      const boardMatch = describeSnapshotBoardMatch(backup.hardware?.uid, snapshot.hardware.board?.uid)
      const vehicleMatch = describeSnapshotVehicleMatch(
        backup.vehicle?.vehicle ?? backup.firmware,
        snapshot.vehicle?.vehicle
      )
      const migrationSources: string[] = []
      if (vehicleMatch.status === 'different') {
        migrationSources.push(`a different vehicle (${backup.vehicle?.vehicle ?? backup.firmware})`)
      }
      if (boardMatch.status === 'different') {
        migrationSources.push('a different board')
      }
      const migrationNote =
        migrationSources.length > 0
          ? ` Cross-vehicle migration: this backup was captured on ${migrationSources.join(' and ')}; only parameters that exist on the connected FC are applied.`
          : ''
      // Firmware-version mismatch (e.g. a 4.6 backup onto 4.7 firmware): params
      // are renamed/added/removed between releases, so a cross-version restore
      // stages values the running firmware may no longer know. Compares the
      // backup's captured firmware version against the connected FC's.
      const firmwareMatch = describeSnapshotFirmwareMatch(
        backup.firmwareVersion,
        snapshot.hardware.board?.firmwareVersionParts
      )
      const firmwareMismatchNote =
        firmwareMatch.status === 'different'
          ? ` Firmware version mismatch (${firmwareMatch.label}): parameters are renamed, added, or removed between ArduPilot releases, so some values in this backup may not exist on the connected firmware. Review the staged diff before applying.`
          : ''
      const isMigration = migrationSources.length > 0 || firmwareMatch.status === 'different'
      setParameterNotice({
        tone: isMigration || restore.changedCount > 0 ? 'warning' : 'neutral',
        text:
          restore.changedCount > 0
            ? `Read ${restore.changedCount} differing parameter value(s) from backup. Nothing is staged yet — stage all of them, or pick individual ones from the list.${unknownNote}${excludedNote}${migrationNote}${firmwareMismatchNote}`
            : `Backup matched the current synced values.${unknownNote}${excludedNote}${migrationNote}${firmwareMismatchNote}`
      })
      // Auto-scroll the staged diff into view so the operator sees the
      // current→new list immediately on a multi-change import. Without
      // it, the only feedback is the small notice banner at the top and
      // a staged change can be missed. The diff is the confirm step:
      // nothing writes to the FC until they click Apply.
      if (restore.changedCount > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document
              .getElementById('parameter-diff-grid')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        })
      }
    } catch (error) {
      setParameterNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to import parameter backup.'
      })
    } finally {
      event.target.value = ''
    }
  }

  return {
    handleExportParameterBackup,
    handleExportParameterBackupAsParm,
    handleExportParameterBackupAsParams,
    handleImportParameterBackup,
    pendingParameterImport,
    stagePendingParameterImportSubset: (paramIds) => {
      if (!pendingParameterImport || paramIds.length === 0) {
        return
      }
      const taking: Record<string, string> = {}
      const remaining: Record<string, string> = { ...pendingParameterImport.draftValues }
      for (const paramId of paramIds) {
        const value = remaining[paramId]
        if (value === undefined) {
          continue
        }
        taking[paramId] = value
        delete remaining[paramId]
      }
      const takenCount = Object.keys(taking).length
      if (takenCount === 0) {
        return
      }
      // mergeDrafts, not replaceDrafts: staging part of an import must not wipe
      // drafts the operator staged from anywhere else.
      mergeDrafts(taking)
      setImportedDraftOrigins((current) => ({ ...current, ...taking }))
      const remainingCount = Object.keys(remaining).length
      setPendingParameterImport(
        remainingCount === 0 ? undefined : { ...pendingParameterImport, draftValues: remaining, changedCount: remainingCount }
      )
      setParameterNotice({
        tone: 'warning',
        text: `Staged ${takenCount} value(s) from ${pendingParameterImport.fileName}.${
          remainingCount > 0 ? ` ${remainingCount} still pending.` : ''
        } Review the diff, then Apply All to write them.`
      })
    },
    dropPendingParameterImportEntries: (paramIds) => {
      if (!pendingParameterImport || paramIds.length === 0) {
        return
      }
      const remaining: Record<string, string> = { ...pendingParameterImport.draftValues }
      let dropped = 0
      for (const paramId of paramIds) {
        if (remaining[paramId] !== undefined) {
          delete remaining[paramId]
          dropped += 1
        }
      }
      if (dropped === 0) {
        return
      }
      const remainingCount = Object.keys(remaining).length
      setPendingParameterImport(
        remainingCount === 0 ? undefined : { ...pendingParameterImport, draftValues: remaining, changedCount: remainingCount }
      )
      setParameterNotice({
        tone: 'neutral',
        text: `Dropped ${dropped} value(s) from the import.${remainingCount > 0 ? ` ${remainingCount} still pending.` : ''}`
      })
    },
    stagePendingParameterImport: () => {
      if (!pendingParameterImport) {
        return
      }
      // Whole-import staging still REPLACES: it is the "load this backup"
      // action, and the operator asked for that file's set.
      replaceDrafts(pendingParameterImport.draftValues)
      // replaceDrafts clears the draft set, so the origin map is replaced too
      // rather than merged — a stale origin would label an unrelated draft.
      setImportedDraftOrigins({ ...pendingParameterImport.draftValues })
      setPendingParameterImport(undefined)
      setParameterNotice({
        tone: 'warning',
        text: `Staged ${pendingParameterImport.changedCount} value(s) from ${pendingParameterImport.fileName}. Review the diff, then Apply All to write them.`
      })
    },
    importedDraftOrigins,
    dismissPendingParameterImport: () => {
      setPendingParameterImport(undefined)
      setParameterNotice(undefined)
    }
  }
}
