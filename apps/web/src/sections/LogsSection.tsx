// LogsSection — App.tsx's `activeViewId === 'logs'` block, lifted into its
// own component. Owns its row derivation (the six LogsViewRow entries
// describing the bitmask + tunable params), its scoped-fields wrap, and the
// LogsView render. App.tsx hands in the draft pool, edit helpers, and the
// onboard-logs state machine.

import { ARDUCOPTER_LOG_BITMASK_LABELS } from '@arduconfig/param-metadata'
import type { ConfiguratorSnapshot, ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { useMemo } from 'react'

import { formatByteCount } from '../library-helpers'
import type { OnboardLogs } from '../hooks/use-onboard-logs'
import type { UseLogUploadResult } from '../hooks/use-log-upload'
import { LogServerPanel, LogUploadDialog } from '../views/LogServerPanel'
import { LOGS_PARAM_IDS } from '../param-groups'
import { isLogsReviewParamId } from '../param-review'
import { normalizeBitmaskValue } from '../parameter-format'
import { selectViewCatalog } from '../selectors/view-catalog'
import { selectViewDrafts } from '../selectors/view-drafts'
import { readRoundedParameter } from '../selectors/parameter-read'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { selectOnboardLogSource } from '../view-models/onboard-log-source'
import { LogsView } from '../views/Logs'

export interface LogsSectionProps {
  snapshot: ConfiguratorSnapshot
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
  updateDrafts: (mutator: (existing: Record<string, string>) => Record<string, string>) => void
  parameterDraftEntries: readonly ParameterDraftEntry[]
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  onApplyScopedDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  onDiscardScopedDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  onboardLogs: OnboardLogs
  /** Upload-to-your-own-server surface. Optional so the Logs tab still renders
   *  in contexts that do not wire it (tests, the disconnected landing). */
  logUpload?: UseLogUploadResult
}

export function LogsSection(props: LogsSectionProps) {
  const {
    snapshot,
    editedValues,
    setDraft,
    updateDrafts,
    parameterDraftEntries,
    parameterDraftById,
    canApplyDraftParameters,
    busyAction,
    onApplyScopedDrafts,
    onDiscardScopedDrafts,
    onboardLogs,
    logUpload
  } = props

  // Param scalars + parameter objects for the Logs surface, recomputed on
  // each snapshot identity change (cheap — six O(1) Map gets).
  const { byId: logsParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, LOGS_PARAM_IDS),
    [snapshot.parameters]
  )
  const logBackendParameter = logsParameterById.get('LOG_BACKEND_TYPE')
  const logBitmaskParameter = logsParameterById.get('LOG_BITMASK')
  const logFileRotateParameter = logsParameterById.get('LOG_FILE_DSRMROT')
  const logFileMbFreeParameter = logsParameterById.get('LOG_FILE_MB_FREE')
  const logReplayParameter = logsParameterById.get('LOG_REPLAY')
  const logDisarmedParameter = logsParameterById.get('LOG_DISARMED')

  const logBackendType = readRoundedParameter(snapshot, 'LOG_BACKEND_TYPE')
  const logBitmask = readRoundedParameter(snapshot, 'LOG_BITMASK')
  const logFileRotateOnDisarm = readRoundedParameter(snapshot, 'LOG_FILE_DSRMROT')
  const logFileMbFree = readRoundedParameter(snapshot, 'LOG_FILE_MB_FREE')
  const logReplayEnabled = readRoundedParameter(snapshot, 'LOG_REPLAY')
  const logDisarmedEnabled = readRoundedParameter(snapshot, 'LOG_DISARMED')
  const editedLogBitmask = normalizeBitmaskValue(editedValues.LOG_BITMASK, logBitmask)

  const { entries: logsDraftEntries, staged: logsStagedDrafts, invalid: logsInvalidDrafts } = useMemo(
    () => selectViewDrafts(parameterDraftEntries, isLogsReviewParamId),
    [parameterDraftEntries]
  )

  return (
    <section className="grid one-up">
      <LogsView
        backendField={logBackendParameter ? { parameter: logBackendParameter, liveValue: logBackendType } : undefined}
        retentionField={logFileMbFreeParameter ? { parameter: logFileMbFreeParameter, liveValue: logFileMbFree } : undefined}
        rotateField={logFileRotateParameter ? { parameter: logFileRotateParameter, liveValue: logFileRotateOnDisarm } : undefined}
        replayField={logReplayParameter ? { parameter: logReplayParameter, liveValue: logReplayEnabled } : undefined}
        disarmedField={logDisarmedParameter ? { parameter: logDisarmedParameter, liveValue: logDisarmedEnabled } : undefined}
        bitmaskField={logBitmaskParameter ? {
          parameter: logBitmaskParameter,
          bits: Object.entries(ARDUCOPTER_LOG_BITMASK_LABELS).map(([bitString, label]) => {
            const bit = Number(bitString)
            return { bit, label, isChecked: hasBitmaskFlag(editedLogBitmask, bit) }
          }),
          captionText: (() => {
            const draft = parameterDraftById.get(logBitmaskParameter.id)
            if (draft?.status === 'staged') {
              return `Staged ${describeBitmaskSelections(draft.nextValue, ARDUCOPTER_LOG_BITMASK_LABELS, 'No categories')}`
            }
            return draft?.reason ?? `Current ${describeBitmaskSelections(logBitmask, ARDUCOPTER_LOG_BITMASK_LABELS, 'No categories')}`
          })(),
          onToggleBit: (bit, on) => {
            updateDrafts((existing) => {
              const currentValue = normalizeBitmaskValue(existing[logBitmaskParameter.id], logBitmask)
              const nextValue = toggleBitmaskFlag(currentValue, bit, on)
              return { ...existing, [logBitmaskParameter.id]: String(nextValue) }
            })
          }
        } : undefined}
        editedValues={editedValues}
        onEditChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        stagedCount={logsStagedDrafts.length}
        invalidCount={logsInvalidDrafts.length}
        draftCount={logsDraftEntries.length}
        canApply={canApplyDraftParameters}
        isApplying={busyAction === 'logs:apply'}
        isBusy={busyAction !== undefined}
        onApply={() => void onApplyScopedDrafts(logsDraftEntries, 'logs:apply', 'Logs')}
        onRevert={() => onDiscardScopedDrafts(logsDraftEntries.map((entry) => entry.id), 'Logs')}
        onboardLogs={{
          available: snapshot.connection.kind === 'connected' && Boolean(snapshot.vehicle),
          // The badge reflects the capability-derived source (what a list will
          // use), so it's accurate before the first list — the hook applies
          // the same selection at list time.
          source: selectOnboardLogSource(snapshot),
          status: onboardLogs.status,
          message: onboardLogs.message,
          logs: onboardLogs.logs.map((log) => ({
            id: log.id,
            nameLabel: onboardLogs.logNamesById.get(log.id),
            sizeLabel: formatByteCount(log.sizeBytes),
            dateLabel:
              log.timeUtc > 0
                ? new Date(log.timeUtc * 1000).toISOString().replace('T', ' ').slice(0, 19)
                : 'Unknown date'
          })),
          activeDownloadId: onboardLogs.activeDownloadId,
          activeDownloadPercent: onboardLogs.activeDownloadPercent,
          activeDownloadReceivedBytes: onboardLogs.activeDownloadReceivedBytes,
          activeDownloadTotalBytes: onboardLogs.activeDownloadTotalBytes,
          onList: onboardLogs.list,
          onErase: onboardLogs.erase,
          onDownload: onboardLogs.download,
          // Only offered while signed in — a button that always exists but
          // sometimes does nothing is worse than one that appears when it works.
          onUpload: logUpload?.session
            ? (id) => {
                const log = onboardLogs.logs.find((candidate) => candidate.id === id)
                if (!log) {
                  return
                }
                logUpload.openUpload({
                  id,
                  nameLabel: onboardLogs.logNamesById.get(id),
                  dateLabel:
                    log.timeUtc > 0
                      ? new Date(log.timeUtc * 1000).toISOString().replace('T', ' ').slice(0, 19)
                      : 'Unknown date',
                  sizeBytes: log.sizeBytes,
                  mavftpPath: onboardLogs.mavftpPathsById?.get(id)
                })
              }
            : undefined,
          uploadBusy: logUpload?.phase === 'reading' || logUpload?.phase === 'sending'
        }}
        logServerSlot={
          logUpload ? (
            <LogServerPanel
              signedInAs={
                logUpload.session
                  ? { serverUrl: logUpload.session.serverUrl, username: logUpload.session.username }
                  : undefined
              }
              rememberedServerUrl={logUpload.rememberedServerUrl}
              rememberedUsername={logUpload.rememberedUsername}
              signingIn={logUpload.signingIn}
              signInError={logUpload.signInError}
              onSignIn={(serverUrl, username, password) => void logUpload.signIn(serverUrl, username, password)}
              onSignOut={logUpload.signOut}
            />
          ) : undefined
        }
        logUploadDialogSlot={
          logUpload?.pending ? (
            <LogUploadDialog
              form={logUpload.pending.form}
              busy={logUpload.phase === 'reading' || logUpload.phase === 'sending'}
              phase={logUpload.phase}
              progressRatio={logUpload.progressRatio}
              onCancel={logUpload.cancelUpload}
              onSubmit={(answers) => void logUpload.submit(answers)}
            />
          ) : undefined
        }
        logUploadMessage={logUpload?.message}
      />
    </section>
  )
}
