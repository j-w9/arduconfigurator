// FailsafeSection — App.tsx's `activeViewId === 'failsafe'` block, lifted
// into its own component. Owns the per-view row derivation (build the
// FailsafeView rows + collect the staged/invalid draft slices that belong
// to those rows) and renders the FailsafeView. No effects, no extra state —
// the parent owns the draft pool and the apply/discard handlers, and just
// hands the inputs in.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { buildFailsafeRows } from '../modes-failsafe-helpers'
import { selectParameterById } from '../selectors/parameter-read'
import type { AdditionalSettingsGroup } from '../view-models/peripherals'
import { FailsafeView, type FailsafeViewRow } from '../views/Failsafe'
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
  // ...and the battery family when the battery library is off.
  //
  // With BATT_MONITOR = 0 ArduPilot never registers BATT_LOW_VOLT and friends,
  // so buildFailsafeRows deliberately collapses them into one explainer row
  // (regression #481: four "Not synced" rows read as "still loading" when the
  // truth is "off by configuration"). The metadata catalog still lists them,
  // so rendering the extras as rows would quietly bring the ghosts back — with
  // the curated rows gone, there is nothing left to filter them against.
  const batteryMonitorDisabled =
    Math.round(selectParameterById(snapshot, 'BATT_MONITOR')?.value ?? Number.NaN) === 0
  const isDisabledBatteryParamId = (paramId: string): boolean =>
    batteryMonitorDisabled && paramId.startsWith('BATT_') && paramId !== 'BATT_MONITOR'
  const additionalGroups: AdditionalSettingsGroup[] = failsafeAdditionalGroups
    .map((group) => ({
      ...group,
      parameters: group.parameters.filter(
        (parameter) =>
          !failsafeIds.has(parameter.id) &&
          !isPreArmParamId(parameter.id) &&
          !isDisabledBatteryParamId(parameter.id)
      )
    }))
    .filter((group) => group.parameters.length > 0)

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

  // These become ROWS in the tab's own grid, not a "More settings" card under
  // it with its own apply button. There is no difference in kind between
  // BATT_LOW_VOLT (a curated row) and BATT_LOW_TIMER (a metadata one) to the
  // operator setting up a battery failsafe — only in where the app happened to
  // get them from. One grid, one Save.
  const additionalRows: FailsafeViewRow[] = additionalGroups.flatMap((group) =>
    group.parameters.map((parameter) => ({
      source: routeFor(parameter.id),
      paramId: parameter.id,
      formatted: parameter.value !== undefined ? String(parameter.value) : 'Not synced',
      isSynced: parameter.value !== undefined,
      parameter
    }))
  )
  const rows = [...failsafeRows, ...additionalRows]
  // Save covers everything the tab shows, so the extra rows join the scope.
  const rowIds = new Set(rows.map((row) => row.paramId))
  const draftEntries = parameterDraftEntries.filter((entry) => rowIds.has(entry.id))
  const stagedDrafts = draftEntries.filter((entry) => entry.status === 'staged')
  const invalidDrafts = draftEntries.filter((entry) => entry.status === 'invalid')

  return (
    <section className="grid one-up">
      <FailsafeView
        rows={rows}
        editedValues={editedValues}
        onEditChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        stagedCount={stagedDrafts.length}
        invalidCount={invalidDrafts.length}
        draftCount={draftEntries.length}
        canApply={canApplyDraftParameters}
        isApplying={busyAction === 'failsafe:apply'}
        isBusy={busyAction !== undefined}
        onApply={() => void onApplyScopedDrafts(draftEntries, 'failsafe:apply', 'Failsafe')}
        onRevert={() => onDiscardScopedDrafts(draftEntries.map((entry) => entry.id), 'failsafe')}
      />
    </section>
  )
}
