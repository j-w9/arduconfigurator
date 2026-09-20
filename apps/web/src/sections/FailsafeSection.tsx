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
  //
  // The pre-arm family goes too. ArduPilot files ARMING_CHECK / ARMING_SKIPCHK
  // / ARMING_REQUIRE / ARMING_RUDDER under the 'failsafe' metadata category, so
  // they arrived here — but Config ▸ Arming already edits that exact set, and a
  // pre-arm check is not a failsafe: it is what stops you arming in the first
  // place. Nothing becomes unreachable; the card below says where they live.
  const isPreArmParamId = (paramId: string): boolean => paramId.startsWith('ARMING_')
  const additionalGroups: AdditionalSettingsGroup[] = failsafeAdditionalGroups
    .map((group) => ({
      ...group,
      parameters: group.parameters.filter(
        (parameter) => !failsafeIds.has(parameter.id) && !isPreArmParamId(parameter.id)
      )
    }))
    .filter((group) => group.parameters.length > 0)
  const inAdditionalScope = (paramId: string): boolean =>
    !failsafeIds.has(paramId) && !isPreArmParamId(paramId)
  const additionalDraftEntries = failsafeAdditionalDraftEntries.filter((entry) =>
    inAdditionalScope(entry.id)
  ) as ParameterDraftEntry[]
  const additionalStagedDrafts = failsafeAdditionalStagedDrafts.filter((entry) =>
    inAdditionalScope(entry.id)
  ) as ParameterDraftEntry[]
  const additionalInvalidDrafts = failsafeAdditionalInvalidDrafts.filter((entry) =>
    inAdditionalScope(entry.id)
  ) as ParameterDraftEntry[]

  // Where each metadata-backed parameter belongs among the sub-tabs.
  //
  // ArduPilot files them all under ONE metadata category ('failsafe'), so
  // routing has to be per parameter. Prefix rules rather than a hand-listed set
  // of ids, so a knob this build has and the catalog does not still lands
  // somewhere sensible, and a new BATT_FS_* in a future firmware needs no
  // change here. Anything unmatched falls to Advanced, which is what that tab
  // is for.
  const ADDITIONAL_ROUTES: ReadonlyArray<{ source: string; match: (paramId: string) => boolean }> = [
    { source: 'Battery failsafe', match: (id) => id.startsWith('BATT_') },
    {
      source: 'RC failsafe',
      match: (id) =>
        id.startsWith('FS_THR') || id.startsWith('RC_FS') || id.startsWith('THR_FS') || id === 'THR_FAILSAFE'
    },
    { source: 'GCS failsafe', match: (id) => id.startsWith('FS_GCS') },
    // Vibration rides with EKF: it is the EKF that the vibration failsafe is
    // protecting, and ArduPilot documents them together.
    { source: 'EKF failsafe', match: (id) => id.startsWith('FS_EKF') || id.startsWith('FS_VIBE') },
    // The geofence is a failsafe in its own right — a boundary with a breach
    // action — and the one in here a basic-mode operator is most likely to be
    // looking for, so it earns a tab rather than a row in a pile.
    { source: 'Fence', match: (id) => id.startsWith('FENCE_') }
  ]

  const routeFor = (paramId: string): string =>
    ADDITIONAL_ROUTES.find((route) => route.match(paramId))?.source ?? 'Advanced'
  const slotId = (source: string): string => source.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  // Split every group's parameters by route, keeping the group (and its label)
  // intact within each destination.
  const groupsBySlot = new Map<string, AdditionalSettingsGroup[]>()
  for (const group of additionalGroups) {
    const byRoute = new Map<string, typeof group.parameters>()
    for (const parameter of group.parameters) {
      const route = routeFor(parameter.id)
      const existing = byRoute.get(route)
      if (existing) existing.push(parameter)
      else byRoute.set(route, [parameter])
    }
    for (const [route, parameters] of byRoute) {
      const slot = slotId(route)
      const bucket = groupsBySlot.get(slot) ?? []
      bucket.push({ ...group, parameters })
      groupsBySlot.set(slot, bucket)
    }
  }

  const extraSlots: Record<string, ReactNode> = {}
  for (const [slot, groups] of groupsBySlot) {
    const ids = new Set(groups.flatMap((group) => group.parameters.map((parameter) => parameter.id)))
    const entries = additionalDraftEntries.filter((entry) => ids.has(entry.id))
    const staged = additionalStagedDrafts.filter((entry) => ids.has(entry.id))
    const invalid = additionalInvalidDrafts.filter((entry) => ids.has(entry.id))
    extraSlots[slot] =
      slot === 'fence'
        ? renderAdditionalSettingsCard(
            'Geofence',
            'A boundary and what the vehicle does when it reaches one.',
            groups,
            entries,
            staged,
            invalid,
            'failsafe:fence',
            'Apply Fence Changes',
            'geofence settings'
          )
        : renderAdditionalSettingsCard(
            'More settings',
            slot === 'advanced'
              ? 'The rest of the parameters ArduPilot files under failsafe. Pre-arm checks are not here — they stop you arming rather than react in flight, and Config ▸ Arming edits them.'
              : 'The rest of the parameters ArduPilot files under this failsafe.',
            groups,
            entries,
            staged,
            invalid,
            `failsafe:additional:${slot}`,
            'Apply These Changes',
            'additional failsafe settings'
          )
  }

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
        // Split by which failsafe each parameter belongs to, rather than one
        // "additional settings" pile at the end of the tab.
        extraSlots={extraSlots}
      />
    </section>
  )
}
