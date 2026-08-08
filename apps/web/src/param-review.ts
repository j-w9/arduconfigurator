// Per-tab "is this parameter reviewed on tab X" predicates, extracted from
// App.tsx as part of its decomposition. Pure parameter-id classifiers used to
// route a parameter into the right per-tab review/draft scope. They read the
// per-tab parameter-id sets (tuning-params / osd-params / param-groups).

import {
  GPS_PARAM_IDS,
  LOGS_PARAM_IDS,
  VTX_PARAM_IDS,
  POWER_REVIEW_PARAM_IDS,
  RECEIVER_SUPPORT_PARAM_IDS
} from './param-groups'
import { AUTOTUNE_COPTER_PARAM_IDS, AUTOTUNE_PLANE_REVIEW_PARAM_IDS } from './autotune-params'
import { OSD_PARAM_IDS } from './osd-params'
import { PORT_PAIRING_PARAM_IDS } from './view-models/port-protocol-pairings'
import { PLANE_SOARING_ADSB_PARAM_IDS } from './plane-soaring-adsb-params'
import { TUNING_PARAM_IDS, TUNING_PLANE_PARAM_IDS, TUNING_ROVER_PARAM_IDS, TUNING_SUB_PARAM_IDS } from './tuning-params'

// Most per-tab review scopes are pure "is this id one of a fixed set" checks
// (`SOME_PARAM_IDS.includes(id)`). This factory builds those membership
// predicates so each scope is a one-liner instead of a hand-written function
// with the repeated `as (typeof IDS)[number]` cast. Behaviorally identical to
// the inlined `IDS.includes(paramId as ...)` it replaces. Scopes that mix in
// regex / `startsWith` rules (receiver, ports, output assignment) stay
// hand-written below.
function makeParamIdPredicate<Id extends string>(
  ids: readonly Id[]
): (paramId: string) => boolean {
  return (paramId: string): boolean => ids.includes(paramId as Id)
}

export function isReceiverReviewParamId(paramId: string): boolean {
  return (
    paramId.startsWith('RCMAP_') ||
    // MIN/MAX/TRIM from calibration; OPTION from the arm-switch control
    // (also in the Relay tab's scope — a channel's OPTION can legitimately
    // be edited from either place).
    /^RC\d+_(MIN|MAX|TRIM|OPTION)$/.test(paramId) ||
    /^FLTMODE\d+$/.test(paramId) ||
    RECEIVER_SUPPORT_PARAM_IDS.includes(paramId as (typeof RECEIVER_SUPPORT_PARAM_IDS)[number])
  )
}

export function isPortsReviewParamId(paramId: string): boolean {
  return (
    /^SERIAL\d+_(PROTOCOL|BAUD|OPTIONS)$/.test(paramId) ||
    /^BRD_SER\d+_RTSCTS$/.test(paramId) ||
    GPS_PARAM_IDS.includes(paramId as (typeof GPS_PARAM_IDS)[number]) ||
    // Peripheral-enable params a protocol pairing stages (DisplayPort->OSD_TYPE,
    // Tramp/SmartAudio->VTX_ENABLE/VTX_TYPES) live in the ports scope too, so a
    // staged pairing commits together with the SERIALn_PROTOCOL change. They
    // stay editable from the OSD/VTX tabs as well (both scopes include them).
    PORT_PAIRING_PARAM_IDS.includes(paramId as (typeof PORT_PAIRING_PARAM_IDS)[number])
  )
}

export const isOsdReviewParamId = makeParamIdPredicate(OSD_PARAM_IDS)

export const isLogsReviewParamId = makeParamIdPredicate(LOGS_PARAM_IDS)

export const isVtxReviewParamId = makeParamIdPredicate(VTX_PARAM_IDS)

export const isPowerReviewParamId = makeParamIdPredicate(POWER_REVIEW_PARAM_IDS)

export function isOutputAssignmentParamId(paramId: string): boolean {
  // Per-channel SERVOn_FUNCTION plus the PWM range / direction sibs.
  // All five live in the same edit scope so the Servos tab Apply
  // button commits a coherent batch when the user edits multiple
  // channels at once.
  //
  // 1..32, matching DEFAULT_MAX_SERVO_OUTPUTS in
  // packages/ardupilot-core/src/airframe-outputs.ts and the 32 channels
  // buildServoChannelParameterDefinitions curates. The old ceiling of 16 meant
  // SERVO17-32 never entered effectiveMotorOutputs — so motor test, the reorder
  // dialog and guided identify could not see them — and edits to them were
  // silently dropped from the Outputs Apply batch.
  return /^SERVO([1-9]|[12][0-9]|3[0-2])_(FUNCTION|MIN|MAX|TRIM|REVERSED)$/.test(paramId)
}

export const isTuningReviewParamId = makeParamIdPredicate(TUNING_PARAM_IDS)

export const isPlaneTuningReviewParamId = makeParamIdPredicate(TUNING_PLANE_PARAM_IDS)

// ArduCopter AUTOTUNE_* config scope — disjoint from the Copter ATC_* tuning
// scope (isTuningReviewParamId) so the sibling Autotune section applies on its
// own without touching the large TuningCopterSection's draft batch.
export const isCopterAutotuneReviewParamId = makeParamIdPredicate(AUTOTUNE_COPTER_PARAM_IDS)

// ArduPlane fixed-wing + QuadPlane AUTOTUNE config scope — disjoint from the
// plane tuning scope (RLL_/PTCH_/TECS_/Q_A_/Q_P_) and the soaring/ADS-B scope.
export const isPlaneAutotuneReviewParamId = makeParamIdPredicate(AUTOTUNE_PLANE_REVIEW_PARAM_IDS)

export const isPlaneSoaringAdsbParamId = makeParamIdPredicate(PLANE_SOARING_ADSB_PARAM_IDS)

export const isRoverTuningReviewParamId = makeParamIdPredicate(TUNING_ROVER_PARAM_IDS)

export const isSubTuningReviewParamId = makeParamIdPredicate(TUNING_SUB_PARAM_IDS)
