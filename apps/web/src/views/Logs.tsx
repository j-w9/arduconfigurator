import { Panel, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import {
  ScopedField,
  ScopedSelectField,
  type ScopedFieldDraftMap
} from './ScopedField'

export interface LogsField {
  parameter: ParameterState
  liveValue: number | undefined
}

export interface LogsBitmaskBit {
  bit: number
  label: string
  isChecked: boolean
}

export interface LogsBitmaskField {
  parameter: ParameterState
  bits: readonly LogsBitmaskBit[]
  captionText: string
  onToggleBit: (bit: number, on: boolean) => void
}

export interface OnboardLogListItem {
  id: number
  /** Real on-FC filename (MAVFTP source); absent for the LOG_* source. */
  nameLabel?: string
  sizeLabel: string
  dateLabel: string
}

export interface OnboardLogsPanel {
  /** True only when a vehicle is connected and identified. */
  available: boolean
  /** Which transport will be used — MAVFTP burst read (faster) or LOG_* stream. */
  source: 'mavftp' | 'mavlink'
  status: 'idle' | 'listing' | 'ready' | 'error'
  message?: string
  logs: readonly OnboardLogListItem[]
  activeDownloadId?: number
  activeDownloadPercent?: number
  onList: () => void
  onDownload: (id: number) => void
}

export interface LogsViewProps {
  backendField: LogsField | undefined
  bitmaskField: LogsBitmaskField | undefined
  retentionField: LogsField | undefined
  rotateField: LogsField | undefined
  replayField: LogsField | undefined
  disarmedField: LogsField | undefined
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  stagedCount: number
  invalidCount: number
  draftCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onRevert: () => void
  onboardLogs?: OnboardLogsPanel
}

function fieldStatusClass(draftStatusById: ScopedFieldDraftMap, paramId: string): string {
  return draftStatusById.get(paramId)?.status ?? 'unchanged'
}

export function LogsView(props: LogsViewProps) {
  const {
    backendField,
    bitmaskField,
    retentionField,
    rotateField,
    replayField,
    disarmedField,
    editedValues,
    onEditChange,
    draftStatusById,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert,
    onboardLogs
  } = props

  return (
    <div id="setup-panel-logs">
      <Panel
        title="Logs"
        subtitle="Onboard log backend, retention, and replay configuration. Edits stage as drafts until you save."
      >
        <div className="modes-stack">
          {/* The read-only "current value" summary cards (Log backend /
           *  Card retention / Replay logging) used to render here. They
           *  duplicated information already visible in the inline editor
           *  selects below, which the operator can change in-place — no
           *  reason to also show a non-editable mirror at the top. */}

          <article className="bf-gui-box">
            <div className="bf-gui-box__titlebar">
              <strong>Edit log configuration</strong>
            </div>
            <div className="bf-gui-box__body">
              <div className="bf-compact-field-grid">
                {backendField ? (
                  <ScopedSelectField
                    parameter={backendField.parameter}
                    liveValue={backendField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                  />
                ) : null}
                {retentionField ? (
                  <ScopedField
                    parameter={retentionField.parameter}
                    liveValue={retentionField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                  />
                ) : null}
                {rotateField ? (
                  <ScopedSelectField
                    parameter={rotateField.parameter}
                    liveValue={rotateField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                  />
                ) : null}
                {replayField ? (
                  <ScopedSelectField
                    parameter={replayField.parameter}
                    liveValue={replayField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                  />
                ) : null}
                {disarmedField ? (
                  <ScopedSelectField
                    parameter={disarmedField.parameter}
                    liveValue={disarmedField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                  />
                ) : null}
              </div>

              {bitmaskField ? (
                <div
                  className={`scoped-editor-field scoped-editor-field--${fieldStatusClass(draftStatusById, bitmaskField.parameter.id)}`}
                  data-testid="logs-bitmask-editor"
                  role="group"
                  aria-label={bitmaskField.parameter.definition?.label ?? bitmaskField.parameter.id}
                >
                  <span>{bitmaskField.parameter.definition?.label ?? bitmaskField.parameter.id}</span>
                  <div className="scoped-checkbox-list">
                    {bitmaskField.bits.map((bit) => (
                      <label
                        key={`${bitmaskField.parameter.id}:${bit.bit}`}
                        className="scoped-checkbox-option"
                        data-testid={`logs-bitmask-bit-${bit.bit}`}
                      >
                        <input
                          type="checkbox"
                          checked={bit.isChecked}
                          onChange={(event) => bitmaskField.onToggleBit(bit.bit, event.target.checked)}
                        />
                        <span>{bit.label}</span>
                      </label>
                    ))}
                  </div>
                  <small>{bitmaskField.captionText}</small>
                </div>
              ) : null}
            </div>
          </article>

          {/* Parameter breakout table removed — the same LOG_* params are
           *  edited inline above and the read-only mirror was duplicate
           *  noise that the operator never used. */}

          <div className="bf-toolbar">
            <div className="bf-toolbar__status">
              <span>{stagedCount} staged</span>
              <span>{invalidCount} invalid</span>
            </div>
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="logs-apply"
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            >
              {isApplying ? 'Applying…' : `Save Logs (${stagedCount})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="logs-revert"
              onClick={onRevert}
              disabled={isBusy || draftCount === 0}
            >
              Revert
            </button>
          </div>

          {onboardLogs ? (
            <article className="bf-gui-box" data-testid="logs-onboard">
              <div className="bf-gui-box__titlebar">
                <span>Onboard logs</span>
                <span data-testid="logs-onboard-source">
                  {onboardLogs.source === 'mavftp' ? 'MAVFTP' : 'MAVLink'}
                </span>
              </div>
              <div className="bf-gui-box__body">
                <div className="bf-toolbar">
                  <button
                    type="button"
                    style={buttonStyle()}
                    data-testid="logs-onboard-list"
                    onClick={onboardLogs.onList}
                    disabled={
                      !onboardLogs.available ||
                      onboardLogs.status === 'listing' ||
                      onboardLogs.activeDownloadId !== undefined
                    }
                  >
                    {onboardLogs.status === 'listing' ? 'Listing…' : 'List onboard logs'}
                  </button>
                  <span data-testid="logs-onboard-status">
                    {!onboardLogs.available
                      ? 'Connect to a vehicle to retrieve onboard logs.'
                      : onboardLogs.message ??
                        (onboardLogs.status === 'ready'
                          ? `${onboardLogs.logs.length} log(s) on the card.`
                          : 'No logs retrieved yet.')}
                  </span>
                </div>
                {onboardLogs.logs.length > 0 ? (
                  <ul className="logs-onboard-list">
                    {onboardLogs.logs.map((log) => {
                      const downloading = onboardLogs.activeDownloadId === log.id
                      return (
                        <li key={log.id} data-testid={`logs-onboard-row-${log.id}`}>
                          <span>{log.nameLabel ?? `Log ${log.id}`}</span>
                          <span>{log.sizeLabel}</span>
                          <span>{log.dateLabel}</span>
                          <button
                            type="button"
                            style={buttonStyle()}
                            data-testid={`logs-onboard-download-${log.id}`}
                            onClick={() => onboardLogs.onDownload(log.id)}
                            disabled={onboardLogs.activeDownloadId !== undefined}
                          >
                            {downloading
                              ? `Downloading ${onboardLogs.activeDownloadPercent ?? 0}%`
                              : 'Download .bin'}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
