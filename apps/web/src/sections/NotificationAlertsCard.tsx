// LED & buzzer alerts — the notification hardware card.
//
// Lifted verbatim out of OutputsSection when the surface moved: notification
// LEDs and the buzzer are peripherals wired to the board, not servo setup, so
// they live on the Peripherals tab now. The JSX, the parameter set and the
// scoped apply/discard are unchanged — only where it renders moved.

import type { ReactElement, ReactNode } from 'react'
import type { ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import {
  ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS,
  ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS,
  formatArducopterNotificationLedBrightness,
  formatArducopterNotificationLedOverride
} from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { deriveOutputMappingSummary } from '@arduconfig/ardupilot-core'

import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import { ScopedField, ScopedSelectField } from '../views/ScopedField'
import { ParamInfoBubble } from '../views/ParamInfoBubble'
import { normalizeBitmaskValue } from '../parameter-format'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { toneForScopedDraftReview } from '../tone-helpers'

type ConfiguredOutput = ReturnType<typeof deriveOutputMappingSummary>['motorOutputs'][number]

/** One editable row plus the shared "i" bubble for its parameter. */
function NotificationFieldRow({
  parameter,
  children
}: {
  parameter: ParameterState
  children: ReactNode
}): ReactElement {
  return (
    <div className="config-section__field-row">
      {children}
      <ParamInfoBubble
        paramId={parameter.id}
        label={parameter.definition?.label ?? parameter.id}
        description={parameter.definition?.description}
        testId={`peripheral-field-info-${parameter.id}`}
      />
    </div>
  )
}

export interface NotificationAlertsCardProps {
  notificationLedTypesParameter: ParameterState | undefined
  notificationLedBrightnessParameter: ParameterState | undefined
  notificationLedLengthParameter: ParameterState | undefined
  notificationLedOverrideParameter: ParameterState | undefined
  notificationBuzzTypesParameter: ParameterState | undefined
  notificationBuzzVolumeParameter: ParameterState | undefined
  notificationLedTypes: number | undefined
  notificationLedBrightness: number | undefined
  notificationLedLength: number | undefined
  notificationLedOverride: number | undefined
  notificationBuzzTypes: number | undefined
  notificationBuzzVolume: number | undefined
  editedNotificationLedTypes: number
  editedNotificationBuzzTypes: number
  notificationLedOutputs: readonly ConfiguredOutput[]
  outputNotificationDraftEntries: ParameterDraftEntry[]
  outputNotificationStagedDrafts: ParameterDraftEntry[]
  outputNotificationInvalidDrafts: ParameterDraftEntry[]
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  editedValues: ParameterDraftValues
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  setDraft: (paramId: string, value: string) => void
  updateDrafts: (updater: (existing: ParameterDraftValues) => ParameterDraftValues) => void
  handleApplyScopedParameterDrafts: (
    entries: readonly ParameterDraftEntry[],
    actionId: string,
    label: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scope: string) => void
}

export function NotificationAlertsCard(props: NotificationAlertsCardProps): ReactElement | null {
  const {
    notificationLedTypesParameter,
    notificationLedBrightnessParameter,
    notificationLedLengthParameter,
    notificationLedOverrideParameter,
    notificationBuzzTypesParameter,
    notificationBuzzVolumeParameter,
    notificationLedTypes,
    notificationLedBrightness,
    notificationLedLength,
    notificationLedOverride,
    notificationBuzzTypes,
    notificationBuzzVolume,
    editedNotificationLedTypes,
    editedNotificationBuzzTypes,
    notificationLedOutputs,
    outputNotificationDraftEntries,
    outputNotificationStagedDrafts,
    outputNotificationInvalidDrafts,
    parameterDraftById,
    editedValues,
    busyAction,
    canApplyDraftParameters,
    setDraft,
    updateDrafts,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  return (
    <>
      {notificationLedTypesParameter || notificationLedLengthParameter || notificationLedBrightnessParameter || notificationLedOverrideParameter || notificationBuzzTypesParameter || notificationBuzzVolumeParameter ? (
        <div className="scoped-review-card scoped-review-card--compact">
          <div className="switch-exercise-card__header">
            <div>
              <strong>LED & buzzer notifications</strong>
              <p>Notification LEDs and the buzzer, without dropping into raw parameters.</p>
            </div>
            <StatusBadge tone={toneForScopedDraftReview(outputNotificationStagedDrafts.length, outputNotificationInvalidDrafts.length)}>
              {outputNotificationInvalidDrafts.length > 0
                ? `${outputNotificationInvalidDrafts.length} invalid`
                : outputNotificationStagedDrafts.length > 0
                  ? `${outputNotificationStagedDrafts.length} staged`
                  : 'in sync'}
            </StatusBadge>
          </div>

          <div className="config-pills">
            {notificationLedTypesParameter ? <span>LED drivers: {describeBitmaskSelections(notificationLedTypes, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}</span> : null}
            {notificationLedBrightnessParameter ? <span>Brightness: {formatArducopterNotificationLedBrightness(notificationLedBrightness)}</span> : null}
            {notificationLedLengthParameter ? <span>LED length: {notificationLedLength ?? 'Unknown'}</span> : null}
            {notificationLedOverrideParameter ? <span>LED source: {formatArducopterNotificationLedOverride(notificationLedOverride)}</span> : null}
            {notificationBuzzTypesParameter ? <span>Buzzer drivers: {describeBitmaskSelections(notificationBuzzTypes, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}</span> : null}
            {notificationBuzzVolumeParameter ? <span>Buzzer volume: {notificationBuzzVolume !== undefined ? `${notificationBuzzVolume}%` : 'Unknown'}</span> : null}
            {notificationLedOutputs.length > 0
              ? notificationLedOutputs.map((output) => <span key={`notification-output:${output.channelNumber}`}>OUT{output.channelNumber}: {output.functionLabel}</span>)
              : <span>No NeoPixel output assignment detected yet</span>}
          </div>

          <div className="scoped-editor-grid">
            {notificationLedTypesParameter ? (
              <NotificationFieldRow parameter={notificationLedTypesParameter}>
                <label className={`scoped-editor-field scoped-editor-field--${parameterDraftById.get(notificationLedTypesParameter.id)?.status ?? 'unchanged'}`}>
                  <span>{notificationLedTypesParameter.definition?.label ?? notificationLedTypesParameter.id}</span>
                  <div className="scoped-bitmask-bits">
                    {Object.entries(ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS).map(([bit, label]) => {
                      const numericBit = Number(bit)
                      const checked = hasBitmaskFlag(editedNotificationLedTypes, numericBit)
                      return (
                        <button
                          type="button"
                          key={`${notificationLedTypesParameter.id}:${bit}`}
                          className={`scoped-bitmask-bit${checked ? ' is-set' : ''}`}
                          aria-pressed={checked}
                          onClick={() =>
                            updateDrafts((existing) => {
                              const currentValue = normalizeBitmaskValue(existing[notificationLedTypesParameter.id], notificationLedTypes)
                              const nextValue = toggleBitmaskFlag(currentValue, numericBit, !checked)

                              return {
                                ...existing,
                                [notificationLedTypesParameter.id]: String(nextValue)
                              }
                            })
                          }
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <small>
                    {parameterDraftById.get(notificationLedTypesParameter.id)?.status === 'staged'
                      ? `Staged ${describeBitmaskSelections(parameterDraftById.get(notificationLedTypesParameter.id)?.nextValue, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}`
                      : parameterDraftById.get(notificationLedTypesParameter.id)?.reason ??
                        `Current ${describeBitmaskSelections(notificationLedTypes, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}`}
                  </small>
                </label>
              </NotificationFieldRow>
            ) : null}

            {notificationLedBrightnessParameter ? (
              <NotificationFieldRow parameter={notificationLedBrightnessParameter}>
                <ScopedSelectField
                  parameter={notificationLedBrightnessParameter}
                  liveValue={notificationLedBrightness}
                  editedValues={editedValues}
                  onChange={(paramId, value) => setDraft(paramId, value)}
                  draftStatusById={parameterDraftById}
                />
              </NotificationFieldRow>
            ) : null}

            {notificationLedLengthParameter ? (
              <NotificationFieldRow parameter={notificationLedLengthParameter}>
                <ScopedField
                  parameter={notificationLedLengthParameter}
                  liveValue={notificationLedLength}
                  editedValues={editedValues}
                  onChange={(paramId, value) => setDraft(paramId, value)}
                  draftStatusById={parameterDraftById}
                />
              </NotificationFieldRow>
            ) : null}

            {notificationLedOverrideParameter ? (
              <NotificationFieldRow parameter={notificationLedOverrideParameter}>
                <ScopedSelectField
                  parameter={notificationLedOverrideParameter}
                  liveValue={notificationLedOverride}
                  editedValues={editedValues}
                  onChange={(paramId, value) => setDraft(paramId, value)}
                  draftStatusById={parameterDraftById}
                />
              </NotificationFieldRow>
            ) : null}

            {notificationBuzzTypesParameter ? (
              <NotificationFieldRow parameter={notificationBuzzTypesParameter}>
                <label className={`scoped-editor-field scoped-editor-field--${parameterDraftById.get(notificationBuzzTypesParameter.id)?.status ?? 'unchanged'}`}>
                  <span>{notificationBuzzTypesParameter.definition?.label ?? notificationBuzzTypesParameter.id}</span>
                  <div className="scoped-bitmask-bits">
                    {Object.entries(ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS).map(([bit, label]) => {
                      const numericBit = Number(bit)
                      const checked = hasBitmaskFlag(editedNotificationBuzzTypes, numericBit)
                      return (
                        <button
                          type="button"
                          key={`${notificationBuzzTypesParameter.id}:${bit}`}
                          className={`scoped-bitmask-bit${checked ? ' is-set' : ''}`}
                          aria-pressed={checked}
                          onClick={() =>
                            updateDrafts((existing) => {
                              const currentValue = normalizeBitmaskValue(existing[notificationBuzzTypesParameter.id], notificationBuzzTypes)
                              const nextValue = toggleBitmaskFlag(currentValue, numericBit, !checked)

                              return {
                                ...existing,
                                [notificationBuzzTypesParameter.id]: String(nextValue)
                              }
                            })
                          }
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <small>
                    {parameterDraftById.get(notificationBuzzTypesParameter.id)?.status === 'staged'
                      ? `Staged ${describeBitmaskSelections(parameterDraftById.get(notificationBuzzTypesParameter.id)?.nextValue, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}`
                      : parameterDraftById.get(notificationBuzzTypesParameter.id)?.reason ??
                        `Current ${describeBitmaskSelections(notificationBuzzTypes, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}`}
                  </small>
                </label>
              </NotificationFieldRow>
            ) : null}

            {notificationBuzzVolumeParameter ? (
              <NotificationFieldRow parameter={notificationBuzzVolumeParameter}>
                <ScopedField
                  parameter={notificationBuzzVolumeParameter}
                  liveValue={notificationBuzzVolume}
                  editedValues={editedValues}
                  onChange={(paramId, value) => setDraft(paramId, value)}
                  draftStatusById={parameterDraftById}
                />
              </NotificationFieldRow>
            ) : null}
          </div>

          <ul className="output-note-list">
            <li>Assign a NeoPixel output in the Output assignments card before expecting external LED strips to respond.</li>
            <li>After notification-driver changes, bench-check the LEDs and buzzer with props off before flight.</li>
          </ul>

          <div className="switch-exercise-controls">
            <button
              style={buttonStyle('primary')}
              onClick={() =>
                void handleApplyScopedParameterDrafts(outputNotificationDraftEntries, 'outputs:notifications', 'Notification outputs')
              }
              disabled={
                busyAction !== undefined ||
                outputNotificationStagedDrafts.length === 0 ||
                outputNotificationInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'outputs:notifications' ? 'Applying…' : `Apply Notification Changes (${outputNotificationStagedDrafts.length})`}
            </button>
            <button
              style={buttonStyle()}
              onClick={() =>
                handleDiscardScopedParameterDrafts(outputNotificationDraftEntries.map((entry) => entry.id), 'notification outputs')
              }
              disabled={busyAction !== undefined || outputNotificationDraftEntries.length === 0}
            >
              Discard Notification Changes
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
