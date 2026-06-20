// FailsafeSection — App.tsx's `activeViewId === 'failsafe'` block, lifted
// into its own component. Owns the per-view row derivation (build the
// FailsafeView rows + collect the staged/invalid draft slices that belong
// to those rows) and renders the FailsafeView. No effects, no extra state —
// the parent owns the draft pool and the apply/discard handlers, and just
// hands the inputs in.

import type { ReactNode } from 'react'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import {
  formatArducopterBatteryFailsafeAction,
  formatArducopterThrottleFailsafe
} from '@arduconfig/param-metadata'

import { buildFailsafeRows, failsafeActionLabel } from '../modes-failsafe-helpers'
import { selectParameterById } from '../selectors/parameter-read'
import type { AdditionalSettingsGroup } from '../view-models/peripherals'
import { FailsafeView } from '../views/Failsafe'
import type { ScopedFieldDraftMap } from '../views/ScopedField'

export interface FailsafeSectionProps {
  snapshot: ConfiguratorSnapshot
  throttleFailsafe: number | undefined
  throttleFailsafeValue: number | undefined
  batteryFailsafe: number | undefined
  batteryCriticalFailsafe: number | undefined
  batteryLowVoltage: number | undefined
  batteryCriticalVoltage: number | undefined
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
  parameterDraftEntries: readonly ParameterDraftEntry[]
  parameterDraftById: ScopedFieldDraftMap
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  onApplyScopedDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  onDiscardScopedDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  onOpenPower: () => void
  /** Additional-settings groups for the 'failsafe' view category (the
   *  metadata-driven catch-all surface that used to leak into Power). */
  failsafeAdditionalGroups: readonly AdditionalSettingsGroup[]
  failsafeAdditionalDraftEntries: readonly ParameterDraftEntry[]
  failsafeAdditionalStagedDrafts: readonly ParameterDraftEntry[]
  failsafeAdditionalInvalidDrafts: readonly ParameterDraftEntry[]
  renderAdditionalSettingsCard: (
    title: string,
    description: string,
    groups: AdditionalSettingsGroup[],
    drafts: ParameterDraftEntry[],
    staged: ParameterDraftEntry[],
    invalid: ParameterDraftEntry[],
    busyKey: string,
    applyLabel: string,
    scopeLabel: string
  ) => ReactNode
}

export function FailsafeSection(props: FailsafeSectionProps) {
  const {
    snapshot,
    throttleFailsafe,
    throttleFailsafeValue,
    batteryFailsafe,
    batteryCriticalFailsafe,
    batteryLowVoltage,
    batteryCriticalVoltage,
    editedValues,
    setDraft,
    parameterDraftEntries,
    parameterDraftById,
    canApplyDraftParameters,
    busyAction,
    onApplyScopedDrafts,
    onDiscardScopedDrafts,
    onOpenPower,
    failsafeAdditionalGroups,
    failsafeAdditionalDraftEntries,
    failsafeAdditionalStagedDrafts,
    failsafeAdditionalInvalidDrafts,
    renderAdditionalSettingsCard
  } = props

  const failsafeRows = buildFailsafeRows({
    snapshot,
    vehicle: snapshot.vehicle?.vehicle,
    throttleFailsafe,
    throttleFailsafeValue,
    batteryFailsafe,
    batteryCriticalFailsafe,
    batteryLowVoltage,
    batteryCriticalVoltage
    // Attach the live parameter to every row so the view renders an
    // inline editor (the Copter rows are built as literals without it;
    // the non-Copter rows already carry it).
  }).map((row) => ({ ...row, parameter: row.parameter ?? selectParameterById(snapshot, row.paramId) }))

  const failsafeIds = new Set(failsafeRows.map((row) => row.paramId))
  const failsafeDraftEntries = parameterDraftEntries.filter((entry) => failsafeIds.has(entry.id))
  const failsafeStagedDrafts = failsafeDraftEntries.filter((entry) => entry.status === 'staged')
  const failsafeInvalidDrafts = failsafeDraftEntries.filter((entry) => entry.status === 'invalid')

  // Any 'failsafe' category param already shown in the primary FailsafeView
  // rows above is filtered out of the additional-settings groups so it
  // doesn't double-render.
  const additionalGroups: AdditionalSettingsGroup[] = failsafeAdditionalGroups
    .map((group) => ({
      ...group,
      parameters: group.parameters.filter((parameter) => !failsafeIds.has(parameter.id))
    }))
    .filter((group) => group.parameters.length > 0)
  const additionalDraftEntries = failsafeAdditionalDraftEntries.filter((entry) => !failsafeIds.has(entry.id)) as ParameterDraftEntry[]
  const additionalStagedDrafts = failsafeAdditionalStagedDrafts.filter((entry) => !failsafeIds.has(entry.id)) as ParameterDraftEntry[]
  const additionalInvalidDrafts = failsafeAdditionalInvalidDrafts.filter((entry) => !failsafeIds.has(entry.id)) as ParameterDraftEntry[]

  return (
    <section className="grid one-up">
      <FailsafeView
        rcFailsafeLabel={failsafeActionLabel(snapshot, 'FS_THR_ENABLE', throttleFailsafe, formatArducopterThrottleFailsafe)}
        rcFailsafeThresholdText={
          throttleFailsafeValue !== undefined
            ? `Triggers below ${Math.round(throttleFailsafeValue)} us throttle PWM.`
            : 'No FS_THR_VALUE threshold configured.'
        }
        batteryLowLabel={failsafeActionLabel(snapshot, 'BATT_FS_LOW_ACT', batteryFailsafe, formatArducopterBatteryFailsafeAction)}
        batteryLowThresholdText={
          batteryLowVoltage !== undefined
            ? `Threshold ${batteryLowVoltage.toFixed(1)} V (BATT_LOW_VOLT).`
            : 'No BATT_LOW_VOLT threshold configured.'
        }
        batteryCriticalLabel={failsafeActionLabel(snapshot, 'BATT_FS_CRT_ACT', batteryCriticalFailsafe, formatArducopterBatteryFailsafeAction)}
        batteryCriticalThresholdText={
          batteryCriticalVoltage !== undefined
            ? `Threshold ${batteryCriticalVoltage.toFixed(1)} V (BATT_CRT_VOLT).`
            : 'No BATT_CRT_VOLT threshold configured.'
        }
        rows={failsafeRows}
        editedValues={editedValues}
        onEditChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        stagedCount={failsafeStagedDrafts.length}
        invalidCount={failsafeInvalidDrafts.length}
        draftCount={failsafeDraftEntries.length}
        canApply={canApplyDraftParameters}
        isApplying={busyAction === 'failsafe:apply'}
        isBusy={busyAction !== undefined}
        onApply={() => void onApplyScopedDrafts(failsafeDraftEntries, 'failsafe:apply', 'Failsafe')}
        onRevert={() => onDiscardScopedDrafts(failsafeDraftEntries.map((entry) => entry.id), 'failsafe')}
        onOpenPower={onOpenPower}
      />
      {renderAdditionalSettingsCard(
        'Additional failsafe settings',
        'Metadata-backed failsafe knobs that extend the rows above (advanced battery / EKF / pre-arm failsafe options).',
        additionalGroups,
        additionalDraftEntries,
        additionalStagedDrafts,
        additionalInvalidDrafts,
        'failsafe:additional',
        'Apply Additional Failsafe Changes',
        'additional failsafe settings'
      )}
    </section>
  )
}
