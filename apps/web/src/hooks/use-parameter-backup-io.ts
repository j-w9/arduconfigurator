// Parameter backup import/export I/O. Owns the three "Export Backup"
// serializers (ArduConfigurator JSON / Mission Planner .parm /
// QGroundControl .params) and the "Import Backup" file handler that parses a
// backup, stages the differing values as drafts (honouring the opt-in import
// exclusions), and scrolls the diff into view.
//
// `handleOpenParameterBackup` (a one-line `.click()` on an App-owned <input>
// ref) lives in App.tsx: the ref is a DOM concern this hook has no need to
// know about, and none of the logic-bearing handlers touch it.

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
import type { ParameterDraftValues } from './use-parameter-drafts'
import type { ParameterFollowUp, ParameterNotice } from './use-parameter-feedback'

export interface UseParameterBackupIoParams {
  snapshot: ConfiguratorSnapshot
  parameterImportExclusions: Record<ParameterImportCategory, boolean>
  replaceDrafts: (drafts: ParameterDraftValues) => void
  setParameterNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  setParameterFollowUp: Dispatch<SetStateAction<ParameterFollowUp | undefined>>
}

export interface UseParameterBackupIoResult {
  handleExportParameterBackup: () => void
  handleExportParameterBackupAsParm: () => void
  handleExportParameterBackupAsParams: () => void
  handleImportParameterBackup: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}

export function useParameterBackupIo({
  snapshot,
  parameterImportExclusions,
  replaceDrafts,
  setParameterNotice,
  setParameterFollowUp
}: UseParameterBackupIoParams): UseParameterBackupIoResult {
  function buildBackupAppInfo(): { appVersion: string; appGitHash: string; appGitBranch: string } {
    return { appVersion: APP_VERSION, appGitHash: GIT_HASH, appGitBranch: GIT_BRANCH }
  }

  function handleExportParameterBackup(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'json'), serializeParameterBackup(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as ArduConfigurator JSON backup.`
    })
  }

  function handleExportParameterBackupAsParm(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'parm'), serializeParameterBackupAsParm(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as Mission Planner .parm.`
    })
  }

  function handleExportParameterBackupAsParams(): void {
    const backup = createParameterBackup(snapshot, buildBackupAppInfo())
    downloadTextFile(buildParameterBackupFilename(snapshot, 'params'), serializeParameterBackupAsParams(backup))
    setParameterNotice({
      tone: 'success',
      text: `Exported ${backup.parameterCount} parameters as QGroundControl .params.`
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
      replaceDrafts(restore.draftValues)
      setParameterFollowUp(undefined)
      const unknownNote =
        restore.unknownParameterIds.length > 0
          ? ` Ignored ${restore.unknownParameterIds.length} unknown parameter(s).`
          : ''
      const excludedNote =
        restore.excludedCount > 0 ? ` Skipped ${restore.excludedCount} excluded parameter(s).` : ''
      setParameterNotice({
        tone: restore.changedCount > 0 ? 'warning' : 'neutral',
        text:
          restore.changedCount > 0
            ? `Loaded ${restore.changedCount} differing parameter value(s) from backup — review the staged diff below, then click Apply All to write to the controller.${unknownNote}${excludedNote}`
            : `Backup matched the current synced values.${unknownNote}${excludedNote}`
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
    handleImportParameterBackup
  }
}
