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
import { buildSetupPortsEvidence } from './setup-ports-evidence'

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

  // Per-vehicle additions. Copter gets `{}` spread in, so its JSON -- and
  // every stored Copter sign-off -- is byte-identical.
  const vehicle = snapshot.vehicle?.vehicle
  const airframeVehicleKeys =
    vehicle === 'ArduPlane'
      ? {
          // The Plane airframe step's own task card edits these; without them a
          // QuadPlane could flip Q_ENABLE after signing off and stay green.
          qEnable: readRoundedParameter(snapshot, 'Q_ENABLE'),
          qFrameClass: readRoundedParameter(snapshot, 'Q_FRAME_CLASS'),
          qFrameType: readRoundedParameter(snapshot, 'Q_FRAME_TYPE')
        }
      : {}
  const failsafeVehicleKeys =
    vehicle === 'ArduPlane'
      ? {
          planeThrottleFailsafe: readRoundedParameter(snapshot, 'THR_FAILSAFE'),
          planeThrottleFailsafeValue: readRoundedParameter(snapshot, 'THR_FS_VALUE'),
          shortAction: readRoundedParameter(snapshot, 'FS_SHORT_ACTN'),
          longAction: readRoundedParameter(snapshot, 'FS_LONG_ACTN')
        }
      : vehicle === 'ArduRover'
        ? { action: readRoundedParameter(snapshot, 'FS_ACTION') }
        : vehicle === 'ArduSub'
          ? {
              leak: readRoundedParameter(snapshot, 'FS_LEAK_ENABLE'),
              pressure: readRoundedParameter(snapshot, 'FS_PRESS_ENABLE'),
              gcs: readRoundedParameter(snapshot, 'FS_GCS_ENABLE'),
              pilotInput: readRoundedParameter(snapshot, 'FS_PILOT_INPUT')
            }
          : {}

  // The Ports wiring sign-off is bound to the port map and to the ports it
  // was taken over, so changing a protocol or a different port lighting up
  // puts the review back.
  const portsProtocolByPort = Object.fromEntries(
    Array.from({ length: 10 }, (_, port) => [port, readRoundedParameter(snapshot, `SERIAL${port}_PROTOCOL`)])
  )
  const portsEvidence = buildSetupPortsEvidence({
    rawText: snapshot.hardware?.uartsFile?.rawText,
    previousRawText: snapshot.hardware?.uartsFile?.previousRawText,
    protocolByPort: portsProtocolByPort
  })

  return {
      ports: JSON.stringify({
        protocolByPort: portsProtocolByPort,
        unconfigured: portsEvidence.unconfigured.map((finding) => finding.portNumber),
        duplicateRcinPorts: portsEvidence.duplicateRcinPorts
      }),
      // AHRS_ORIENTATION belongs in all three of these.
      //
      // The level cal is AP_InertialSensor::calibrate_trim(), which samples via
      // get_accel(0) -- and that reading is rotated by _board_orientation
      // (AP_InertialSensor.cpp: ret.rotate(_board_orientation)). So AHRS_TRIM_X/Y
      // are only valid for the orientation in effect when the cal ran, and the
      // same holds for the 6-pose cal's trim path. The airframe step's own
      // criterion is the orientation exercise.
      //
      // Without it: run the orientation exercise, calibrate accel and level, get
      // three green steps -- then re-mount the board and change AHRS_ORIENTATION,
      // and all three STAY green against a rotation they were never run at. The
      // aircraft's level reference is off by the orientation error and it leans on
      // takeoff, with nothing telling the operator to re-run anything.
      airframe: JSON.stringify({
        frameClassValue: airframe.frameClassValue,
        frameTypeValue: airframe.frameTypeValue,
        frameTypeIgnored: airframe.frameTypeIgnored,
        boardOrientation: readRoundedParameter(snapshot, 'AHRS_ORIENTATION'),
        ...airframeVehicleKeys
      }),
      outputs: JSON.stringify({
        expectedMotorCount: airframe.expectedMotorCount,
        // The ESC protocol is part of what the review signed off.
        pwmTypeValue: escSetup.pwmTypeValue,
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
      'motor-range': JSON.stringify({
        spinArm: readParameterValue(snapshot, 'MOT_SPIN_ARM'),
        spinMin: readParameterValue(snapshot, 'MOT_SPIN_MIN'),
        pwmTypeValue: escSetup.pwmTypeValue,
        calibrationPath: escSetup.calibrationPath
      }),
      // A flight record: nothing on the vehicle can make it stale.
      maiden: JSON.stringify({}),
      'initial-tune': JSON.stringify({
        gyroFilter: readParameterValue(snapshot, 'INS_GYRO_FILTER'),
        voltMax: readParameterValue(snapshot, 'MOT_BAT_VOLT_MAX'),
        voltMin: readParameterValue(snapshot, 'MOT_BAT_VOLT_MIN'),
        thrustExpo: readParameterValue(snapshot, 'MOT_THST_EXPO'),
        rollFilterD: readParameterValue(snapshot, 'ATC_RAT_RLL_FLTD')
      }),
      autotune: JSON.stringify({
        aggressiveness: readParameterValue(snapshot, 'AUTOTUNE_AGGR'),
        gains: ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_D', 'ATC_RAT_PIT_P', 'ATC_RAT_PIT_D', 'ATC_RAT_YAW_P', 'ATC_ANG_RLL_P', 'ATC_ANG_PIT_P', 'ATC_ANG_YAW_P'].map((id) =>
          readParameterValue(snapshot, id)
        )
      }),
      filters: JSON.stringify({
        notch: ['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE', 'INS_HNTCH_REF', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_HNTCH_HMNCS', 'INS_HNTCH_OPTS'].map((id) =>
          readParameterValue(snapshot, id)
        )
      }),
      hover: JSON.stringify({
        hoverThrottle: readParameterValue(snapshot, 'MOT_THST_HOVER'),
        hoverLearn: readRoundedParameter(snapshot, 'MOT_HOVER_LEARN'),
        accelP: readParameterValue(snapshot, 'PSC_D_ACC_P') ?? readParameterValue(snapshot, 'PSC_ACCZ_P'),
        accelI: readParameterValue(snapshot, 'PSC_D_ACC_I') ?? readParameterValue(snapshot, 'PSC_ACCZ_I')
      }),
      readiness: JSON.stringify({
        armingCheck: readRoundedParameter(snapshot, 'ARMING_CHECK'),
        armingSkip: readRoundedParameter(snapshot, 'ARMING_SKIPCHK'),
        armingRudder: readRoundedParameter(snapshot, 'ARMING_RUDDER'),
        logBitmask: readRoundedParameter(snapshot, 'LOG_BITMASK'),
        logBackend: readRoundedParameter(snapshot, 'LOG_BACKEND_TYPE'),
        armSwitch: Array.from({ length: 16 }, (_, index) => readRoundedParameter(snapshot, `RC${index + 1}_OPTION`)).map(
          (option) => (option === 153 || option === 154 ? option : 0)
        )
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
        boardOrientation: readRoundedParameter(snapshot, 'AHRS_ORIENTATION'),
        accId: readRoundedParameter(snapshot, 'INS_ACC_ID'),
        offsets: ['INS_ACCOFFS_X', 'INS_ACCOFFS_Y', 'INS_ACCOFFS_Z'].map((id) => readParameterValue(snapshot, id)),
        scales: ['INS_ACCSCAL_X', 'INS_ACCSCAL_Y', 'INS_ACCSCAL_Z'].map((id) => readParameterValue(snapshot, id))
      }),
      level: JSON.stringify({
        boardOrientation: readRoundedParameter(snapshot, 'AHRS_ORIENTATION'),
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
      // The modes signature pins the reviewed mode CONFIGURATION (which channel
      // selects modes and what each position is assigned to). A waiver stops
      // counting exactly when the operator re-assigns a mode position, which is
      // when it should. Without an entry here getSetupConfirmationRecord finds
      // an undefined signature and silently discards every 'modes' record.
      modes: JSON.stringify({
        modeChannel: readRoundedParameter(snapshot, 'FLTMODE_CH'),
        modes: [1, 2, 3, 4, 5, 6].map((slot) => readRoundedParameter(snapshot, `FLTMODE${slot}`))
      }),
      // Failsafe/power signatures pin the reviewed CONFIGURATION only.
      // Live state (telemetry-verified flags, pre-arm issue text) churns
      // across every reboot — fresh pre-arm checks re-run, telemetry flags
      // restart false — which invalidated the operator's sign-off even
      // though nothing they reviewed had changed. The section criteria
      // still re-check live telemetry and pre-arm health on every render,
      // so safety gating is unchanged; only the sign-off's validity stops
      // depending on transient state.
      // Widened to the values the step's own copy claims to have reviewed. Pinning
      // just the two enables meant an operator could sign off "I reviewed the
      // failsafe behaviour" and then move FS_THR_VALUE below the receiver's
      // failsafe output, zero BATT_LOW_VOLT, or set the critical action to
      // warn-only -- and the sign-off stayed valid and green. Every id here is
      // already in the bundle's requiredParameters for this section.
      failsafe: JSON.stringify({
        throttleFailsafe,
        batteryFailsafe,
        throttleFailsafeValue: readRoundedParameter(snapshot, 'FS_THR_VALUE'),
        batteryCriticalAction: readRoundedParameter(snapshot, 'BATT_FS_CRT_ACT'),
        batteryLowVoltage: readParameterValue(snapshot, 'BATT_LOW_VOLT'),
        batteryCriticalVoltage: readParameterValue(snapshot, 'BATT_CRT_VOLT'),
        batteryLowCapacity: readParameterValue(snapshot, 'BATT_LOW_MAH'),
        ...failsafeVehicleKeys
      }),
      power: JSON.stringify({
        batteryMonitor,
        batteryCapacity,
        armVoltage: readParameterValue(snapshot, 'BATT_ARM_VOLT'),
        armCapacity: readParameterValue(snapshot, 'BATT_ARM_MAH')
      })
  }
}
