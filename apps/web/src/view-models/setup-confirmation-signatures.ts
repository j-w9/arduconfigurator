// Setup-section confirmation signatures for the guided Setup view.
//
// Part of the App.tsx view-model decomposition. Each guided-setup section
// gets a stable JSON signature of the inputs its confirmation depends on, so
// a stored confirmation can be invalidated when those inputs change. Pure
// derivation, lifted verbatim from the App.tsx useMemo into
// buildSetupConfirmationSignatures. App.tsx keeps the same memo deps.
// Behavior-preserving.

import {
  deriveAirframe,
  deriveCompassSetupAvailability,
  deriveEscSetupSummary,
  deriveOutputMappingSummary,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations
} from '@arduconfig/ardupilot-core'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { RcMappingSessionState } from '../app-types'
import { readParameterValue, readRoundedParameter } from '../selectors/parameter-read'
import { RC_CALIBRATION_AXIS_ORDER } from '../setup-exercise-helpers'

export interface SetupConfirmationSignatureInputs {
  airframe: ReturnType<typeof deriveAirframe>
  outputMapping: ReturnType<typeof deriveOutputMappingSummary>
  escSetup: ReturnType<typeof deriveEscSetupSummary>
  compassSetupAvailability: ReturnType<typeof deriveCompassSetupAvailability>
  currentRcAxisChannelMap: ReturnType<typeof deriveRcAxisChannelMap>
  rcAxisObservations: ReturnType<typeof deriveRcAxisObservations>
  rcMappingSession: RcMappingSessionState
  snapshot: ConfiguratorSnapshot
  batteryCapacity: number | undefined
  batteryFailsafe: number | undefined
  batteryMonitor: number | undefined
  throttleFailsafe: number | undefined
}

export function buildSetupConfirmationSignatures(inputs: SetupConfirmationSignatureInputs): Record<string, string> {
  const {
    airframe,
    outputMapping,
    escSetup,
    compassSetupAvailability,
    currentRcAxisChannelMap,
    rcAxisObservations,
    rcMappingSession,
    snapshot,
    batteryCapacity,
    batteryFailsafe,
    batteryMonitor,
    throttleFailsafe
  } = inputs

  return {
      airframe: JSON.stringify({
        frameClassValue: airframe.frameClassValue,
        frameTypeValue: airframe.frameTypeValue,
        frameTypeIgnored: airframe.frameTypeIgnored
      }),
      outputs: JSON.stringify({
        expectedMotorCount: airframe.expectedMotorCount,
        motorOutputs: outputMapping.motorOutputs.map((output) => ({
          channelNumber: output.channelNumber,
          functionValue: output.functionValue,
          motorNumber: output.motorNumber
        })),
        auxOutputs: outputMapping.configuredAuxOutputs.map((output) => ({
          channelNumber: output.channelNumber,
          functionValue: output.functionValue
        })),
        notes: outputMapping.notes
      }),
      'esc-range': JSON.stringify({
        calibrationPath: escSetup.calibrationPath,
        pwmTypeValue: escSetup.pwmTypeValue,
        notes: escSetup.notes,
        relevantParameters: escSetup.relevantParameters
      }),
      // The three calibration signatures are bound to the calibration's
      // STORED RESULT on the FC (offset/trim/id params), not the transient
      // guided-action state: guided actions reset to idle on every
      // reboot/reconnect, which invalidated the operator's confirmation
      // and regressed the wizard to "calibration pending" after every
      // planned reboot (SERIALx_PROTOCOL / RCMAP_* writes force one). The
      // params survive a reboot and change exactly when the calibration is
      // re-run or the sensor hardware changes — which is when a stale
      // sign-off SHOULD stop counting.
      accelerometer: JSON.stringify({
        accId: readRoundedParameter(snapshot, 'INS_ACC_ID'),
        offsets: ['INS_ACCOFFS_X', 'INS_ACCOFFS_Y', 'INS_ACCOFFS_Z'].map((id) => readParameterValue(snapshot, id)),
        scales: ['INS_ACCSCAL_X', 'INS_ACCSCAL_Y', 'INS_ACCSCAL_Z'].map((id) => readParameterValue(snapshot, id))
      }),
      level: JSON.stringify({
        trims: ['AHRS_TRIM_X', 'AHRS_TRIM_Y'].map((id) => readParameterValue(snapshot, id))
      }),
      compass: JSON.stringify({
        devIds: ['COMPASS_DEV_ID', 'COMPASS_DEV_ID2', 'COMPASS_DEV_ID3'].map((id) => readRoundedParameter(snapshot, id)),
        offsets: ['COMPASS_OFS_X', 'COMPASS_OFS_Y', 'COMPASS_OFS_Z'].map((id) => readParameterValue(snapshot, id)),
        gpsConfigured: compassSetupAvailability.gpsConfigured,
        enabledCompassCount: compassSetupAvailability.enabledCompassCount,
        canSkipCalibration: compassSetupAvailability.canSkipCalibration
      }),
      radio: JSON.stringify({
        rcMap: currentRcAxisChannelMap,
        detectedMap:
          rcMappingSession.status === 'ready'
            ? RC_CALIBRATION_AXIS_ORDER.map((axisId) => ({
                axisId,
                channelNumber: rcMappingSession.captures[axisId].detectedChannelNumber
              }))
            : undefined,
        mappings: rcAxisObservations.map((observation) => ({
          axisId: observation.axisId,
          channelNumber: observation.channelNumber
        })),
        params: rcAxisObservations.map((observation) => ({
          channelNumber: observation.channelNumber,
          minimum: readRoundedParameter(snapshot, `RC${observation.channelNumber}_MIN`),
          maximum: readRoundedParameter(snapshot, `RC${observation.channelNumber}_MAX`),
          trim: readRoundedParameter(snapshot, `RC${observation.channelNumber}_TRIM`)
        }))
      }),
      // Failsafe/power signatures pin the reviewed CONFIGURATION only.
      // Live state (telemetry-verified flags, pre-arm issue text) churns
      // across every reboot — fresh pre-arm checks re-run, telemetry flags
      // restart false — which invalidated the operator's sign-off even
      // though nothing they reviewed had changed. The section criteria
      // still re-check live telemetry and pre-arm health on every render,
      // so safety gating is unchanged; only the sign-off's validity stops
      // depending on transient state.
      failsafe: JSON.stringify({
        throttleFailsafe,
        batteryFailsafe
      }),
      power: JSON.stringify({
        batteryMonitor,
        batteryCapacity
      })
  }
}
