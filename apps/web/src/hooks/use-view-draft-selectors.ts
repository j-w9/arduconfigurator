// View-scoped parameter-draft selectors factored out of App.tsx. Each review
// tab (receiver, ports, config, OSD, VTX, frame, power, tuning + its rate/PID/
// filter sub-scopes, and the output review/notification/assignment scopes) runs
// the shared selectViewDrafts() over the full draft pool with its own paramId
// predicate to get the entries/staged/invalid bag it applies. This collapses the
// 14 near-identical useMemo blocks into one hook; bodies and dependency arrays
// are moved verbatim, so output values are byte-identical to the originals.

import { useMemo } from 'react'

import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'

import {
  isCopterAutotuneReviewParamId,
  isOsdReviewParamId,
  isOutputAssignmentParamId,
  isPlaneAutotuneReviewParamId,
  isPlaneSoaringAdsbParamId,
  isPlaneTuningReviewParamId,
  isRoverTuningReviewParamId,
  isPortsReviewParamId,
  isPowerReviewParamId,
  isReceiverReviewParamId,
  isSubTuningReviewParamId,
  isTuningReviewParamId,
  isVtxReviewParamId
} from '../param-review'
import { OUTPUT_NOTIFICATION_PARAM_IDS, OUTPUT_REVIEW_PARAM_IDS, isRelayParamId } from '../param-groups'
import { TUNING_ALL_PID_PARAM_IDS, TUNING_FILTER_PARAM_IDS, TUNING_RATE_PARAM_IDS } from '../tuning-params'
import { selectViewDrafts, type ViewDrafts } from '../selectors/view-drafts'

// Every scope below memoizes the same `selectViewDrafts(pool, predicate)` call
// and recomputes only when the draft pool changes (plus, for the config scope,
// when its section-derived predicate changes). This helper centralises that
// memo so each scope is one line. Behaviorally identical to the inlined
// `useMemo(() => selectViewDrafts(parameterDraftEntries, predicate), [parameterDraftEntries, ...extraDeps])`
// it replaces: same predicate, same source list, same dependency set — the
// `extraDeps` spread reproduces the per-scope dep array verbatim (`[]` for the
// `[parameterDraftEntries]`-only scopes, `[isConfigParamId]` for the config
// scope). Each call site is a distinct, fixed-order hook instance, so its
// dep-array length is stable across renders.
function useViewDraftSlice(
  parameterDraftEntries: ParameterDraftEntry[],
  predicate: (paramId: string) => boolean,
  extraDeps: readonly unknown[] = []
): ViewDrafts {
  // deps assembled explicitly to reproduce each scope's verbatim dependency
  // array; `predicate` is intentionally excluded (matches the originals, which
  // depended only on `parameterDraftEntries` plus, for config, `isConfigParamId`).
  return useMemo(
    () => selectViewDrafts(parameterDraftEntries, predicate),
    [parameterDraftEntries, ...extraDeps]
  )
}

export function useViewDraftSelectors(input: {
  parameterDraftEntries: ParameterDraftEntry[]
  isConfigParamId: (paramId: string) => boolean
}) {
  const { parameterDraftEntries, isConfigParamId } = input

  const {
    entries: receiverDraftEntries,
    staged: receiverStagedDrafts,
    invalid: receiverInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isReceiverReviewParamId)
  const {
    entries: portsDraftEntries,
    staged: portsStagedDrafts,
    invalid: portsInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isPortsReviewParamId)
  // Config tab — see isConfigParamId for the section-driven membership
  // logic. Apply pulls every staged config-section field in one shot.
  const {
    entries: configDraftEntries,
    staged: configStagedDrafts,
    invalid: configInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isConfigParamId, [isConfigParamId])
  const {
    staged: osdStagedDrafts,
    invalid: osdInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isOsdReviewParamId)
  const {
    staged: vtxStagedDrafts,
    invalid: vtxInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isVtxReviewParamId)
  // Copter FRAME_CLASS / FRAME_TYPE drafts get their own apply/revert in the
  // Motors tab — metadata-field drafts can't be applied from Basic mode's
  // global banner, so the inline editor needs a scoped apply.
  const {
    entries: frameDraftEntries,
    staged: frameStagedDrafts,
    invalid: frameInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) => id === 'FRAME_CLASS' || id === 'FRAME_TYPE')
  const {
    entries: powerDraftEntries,
    staged: powerStagedDrafts,
    invalid: powerInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isPowerReviewParamId)
  const {
    entries: tuningDraftEntries,
    staged: tuningStagedDrafts,
    invalid: tuningInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isTuningReviewParamId)
  // ArduPlane curated tuning surface gets its own review/apply scope, separate
  // from the Copter ATC_* tuning scope above (disjoint paramId sets).
  const {
    entries: planeTuningDraftEntries,
    staged: planeTuningStagedDrafts,
    invalid: planeTuningInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isPlaneTuningReviewParamId)
  // ArduPlane Soaring + ADS-B/avoidance curated surface gets its own
  // review/apply scope, disjoint from the plane tuning scope above (SOAR_/
  // ADSB_/AVD_ vs the RLL_/PTCH_/TECS_/Q_ tuning ids).
  const {
    entries: planeSoaringAdsbDraftEntries,
    staged: planeSoaringAdsbStagedDrafts,
    invalid: planeSoaringAdsbInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isPlaneSoaringAdsbParamId)
  // ArduCopter curated AUTOTUNE surface gets its own review/apply scope,
  // disjoint from the Copter ATC_* tuning scope so the sibling section applies
  // independently of the large TuningCopterSection.
  const {
    entries: copterAutotuneDraftEntries,
    staged: copterAutotuneStagedDrafts,
    invalid: copterAutotuneInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isCopterAutotuneReviewParamId)
  // ArduPlane curated AUTOTUNE surface (fixed-wing + QuadPlane) gets its own
  // review/apply scope, disjoint from the plane tuning and soaring/ADS-B scopes.
  const {
    entries: planeAutotuneDraftEntries,
    staged: planeAutotuneStagedDrafts,
    invalid: planeAutotuneInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isPlaneAutotuneReviewParamId)
  // ArduRover curated tuning surface gets its own review/apply scope, disjoint
  // from both the Copter ATC_* scope and the Plane scope above.
  const {
    entries: roverTuningDraftEntries,
    staged: roverTuningStagedDrafts,
    invalid: roverTuningInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isRoverTuningReviewParamId)
  // ArduSub curated tuning surface gets its own review/apply scope, disjoint
  // from the Copter ATC_* scope, the Plane scope, and the Rover scope above.
  const {
    entries: subTuningDraftEntries,
    staged: subTuningStagedDrafts,
    invalid: subTuningInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isSubTuningReviewParamId)
  const {
    staged: tuningRateStagedDrafts,
    invalid: tuningRateInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) =>
    TUNING_RATE_PARAM_IDS.includes(id as (typeof TUNING_RATE_PARAM_IDS)[number])
  )
  const {
    staged: tuningPidStagedDrafts,
    invalid: tuningPidInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) =>
    TUNING_ALL_PID_PARAM_IDS.includes(id as (typeof TUNING_ALL_PID_PARAM_IDS)[number])
  )
  const {
    staged: tuningFilterStagedDrafts,
    invalid: tuningFilterInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) =>
    TUNING_FILTER_PARAM_IDS.includes(id as (typeof TUNING_FILTER_PARAM_IDS)[number])
  )
  const {
    entries: outputReviewDraftEntries,
    staged: outputReviewStagedDrafts,
    invalid: outputReviewInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) =>
    OUTPUT_REVIEW_PARAM_IDS.includes(id as (typeof OUTPUT_REVIEW_PARAM_IDS)[number])
  )
  const {
    entries: outputNotificationDraftEntries,
    staged: outputNotificationStagedDrafts,
    invalid: outputNotificationInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, (id) =>
    OUTPUT_NOTIFICATION_PARAM_IDS.includes(id as (typeof OUTPUT_NOTIFICATION_PARAM_IDS)[number])
  )
  const {
    entries: outputAssignmentDraftEntries,
    staged: outputAssignmentStagedDrafts,
    invalid: outputAssignmentInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isOutputAssignmentParamId)
  const {
    entries: relayDraftEntries,
    staged: relayStagedDrafts,
    invalid: relayInvalidDrafts
  } = useViewDraftSlice(parameterDraftEntries, isRelayParamId)

  return {
    receiverDraftEntries,
    receiverStagedDrafts,
    receiverInvalidDrafts,
    portsDraftEntries,
    portsStagedDrafts,
    portsInvalidDrafts,
    configDraftEntries,
    configStagedDrafts,
    configInvalidDrafts,
    osdStagedDrafts,
    osdInvalidDrafts,
    vtxStagedDrafts,
    vtxInvalidDrafts,
    frameDraftEntries,
    frameStagedDrafts,
    frameInvalidDrafts,
    powerDraftEntries,
    powerStagedDrafts,
    powerInvalidDrafts,
    tuningDraftEntries,
    tuningStagedDrafts,
    tuningInvalidDrafts,
    planeTuningDraftEntries,
    planeTuningStagedDrafts,
    planeTuningInvalidDrafts,
    planeSoaringAdsbDraftEntries,
    planeSoaringAdsbStagedDrafts,
    planeSoaringAdsbInvalidDrafts,
    copterAutotuneDraftEntries,
    copterAutotuneStagedDrafts,
    copterAutotuneInvalidDrafts,
    planeAutotuneDraftEntries,
    planeAutotuneStagedDrafts,
    planeAutotuneInvalidDrafts,
    roverTuningDraftEntries,
    roverTuningStagedDrafts,
    roverTuningInvalidDrafts,
    subTuningDraftEntries,
    subTuningStagedDrafts,
    subTuningInvalidDrafts,
    tuningRateStagedDrafts,
    tuningRateInvalidDrafts,
    tuningPidStagedDrafts,
    tuningPidInvalidDrafts,
    tuningFilterStagedDrafts,
    tuningFilterInvalidDrafts,
    outputReviewDraftEntries,
    outputReviewStagedDrafts,
    outputReviewInvalidDrafts,
    outputNotificationDraftEntries,
    outputNotificationStagedDrafts,
    outputNotificationInvalidDrafts,
    outputAssignmentDraftEntries,
    outputAssignmentStagedDrafts,
    outputAssignmentInvalidDrafts,
    relayDraftEntries,
    relayStagedDrafts,
    relayInvalidDrafts
  }
}
