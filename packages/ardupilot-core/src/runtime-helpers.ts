import type {
  GuidedActionId,
  LiveSignalId
} from '@arduconfig/param-metadata'
import {
  formatArducopterFlightMode,
  formatArduplaneFlightMode,
  formatArduroverFlightMode,
  formatArdusubFlightMode
} from '@arduconfig/param-metadata'
import type { HeartbeatMessage } from '@arduconfig/protocol-mavlink'
import {
  MAV_AUTOPILOT,
  MAV_CMD,
  MAV_MODE_FLAG,
  MAV_RESULT,
  MAV_SEVERITY,
  MAV_STATE,
  MAV_TYPE
} from '@arduconfig/protocol-mavlink'

import type { MavftpDirectoryEntry } from './mavftp.js'
import type {
  BoardFileState,
  CanNodeHealth,
  CanNodeMode,
  GuidedActionState,
  HardwareState,
  LiveVerificationState,
  MotorTestState,
  ParameterState,
  ParameterSyncState,
  PreArmStatusState,
  StatusTextEntry,
  VehicleIdentity,
  VehicleSystemStatus
} from './types.js'

// Module-private constants. Several are also imported by runtime.ts so they
// can stay in one place instead of being duplicated.
export const UARTS_FILE_PATH = '@SYS/uarts.txt'
export const MAX_GUIDED_ACTION_STATUS_TEXTS = 5
export const DEFAULT_PARAMETER_WRITE_TOLERANCE = 0.0001
// ArduCopter airframe MAV_TYPE codes. Source: MAVLink common.xml
// (cross-checked against ArduPilot AP_Vehicle.h vehicle_type_t).
export const ARDUCOPTER_MAV_TYPES = new Set<number>([
  MAV_TYPE.QUADROTOR,
  MAV_TYPE.COAXIAL,
  MAV_TYPE.HEXAROTOR,
  MAV_TYPE.OCTOROTOR,
  MAV_TYPE.TRICOPTER,
  MAV_TYPE.HELICOPTER,
  MAV_TYPE.DODECAROTOR,
  MAV_TYPE.DECAROTOR
])
// ArduPlane reports FIXED_WING for a conventional plane, or one of the
// VTOL_* types when Q_ENABLE is on (QuadPlane). Both map to the ArduPlane
// metadata bundle.
export const ARDUPLANE_MAV_TYPES = new Set<number>([
  MAV_TYPE.FIXED_WING,
  MAV_TYPE.VTOL_TAILSITTER_DUOROTOR,
  MAV_TYPE.VTOL_TAILSITTER_QUADROTOR,
  MAV_TYPE.VTOL_TILTROTOR,
  MAV_TYPE.VTOL_FIXEDROTOR,
  MAV_TYPE.VTOL_TAILSITTER,
  MAV_TYPE.VTOL_TILTWING,
  MAV_TYPE.VTOL_RESERVED5
])
// ArduRover reports GROUND_ROVER for a land rover or SURFACE_BOAT for a
// boat; ArduSub reports SUBMARINE. Both map to their own metadata bundle
// once those catalogs exist — until then downstream falls back to the
// Copter bundle, but the vehicle identity is correct from here on.
export const ARDUROVER_MAV_TYPES = new Set<number>([
  MAV_TYPE.GROUND_ROVER,
  MAV_TYPE.SURFACE_BOAT
])
export const ARDUSUB_MAV_TYPES = new Set<number>([MAV_TYPE.SUBMARINE])
export const GUIDED_ACTION_IDS: GuidedActionId[] = [
  'request-parameters',
  'calibrate-accelerometer',
  'calibrate-level',
  'calibrate-compass',
  'reboot-autopilot'
]
export const ACCELEROMETER_CALIBRATION_STEPS = [
  {
    commandValue: 1,
    summary: 'Place the vehicle level and keep it still.',
    instructions: [
      'Set the frame level on a stable surface.',
      'When the frame is motionless, press Confirm Level Position.'
    ],
    ctaLabel: 'Confirm Level Position'
  },
  {
    commandValue: 2,
    summary: 'Place the vehicle on its left side and keep it still.',
    instructions: [
      'Move the frame onto its left side.',
      'When the frame is motionless, press Confirm Left Side Position.'
    ],
    ctaLabel: 'Confirm Left Side Position'
  },
  {
    commandValue: 3,
    summary: 'Place the vehicle on its right side and keep it still.',
    instructions: [
      'Move the frame onto its right side.',
      'When the frame is motionless, press Confirm Right Side Position.'
    ],
    ctaLabel: 'Confirm Right Side Position'
  },
  {
    commandValue: 4,
    summary: 'Place the vehicle nose down and keep it still.',
    instructions: [
      'Tilt the frame nose-down.',
      'When the frame is motionless, press Confirm Nose Down Position.'
    ],
    ctaLabel: 'Confirm Nose Down Position'
  },
  {
    commandValue: 5,
    summary: 'Place the vehicle nose up and keep it still.',
    instructions: [
      'Tilt the frame nose-up.',
      'When the frame is motionless, press Confirm Nose Up Position.'
    ],
    ctaLabel: 'Confirm Nose Up Position'
  },
  {
    commandValue: 6,
    summary: 'Place the vehicle on its back and keep it still.',
    instructions: [
      'Flip the frame onto its back.',
      'When the frame is motionless, press Confirm Back Position.'
    ],
    ctaLabel: 'Confirm Back Position'
  }
] as const

export function severityName(severity: number): StatusTextEntry['severity'] {
  if (severity <= MAV_SEVERITY.ERROR) {
    return 'error'
  }
  if (severity === MAV_SEVERITY.WARNING) {
    return 'warning'
  }
  return 'info'
}

export function formatArduPilotMode(
  customMode: number,
  vehicle: VehicleIdentity['vehicle'] = 'ArduCopter'
): string {
  switch (vehicle) {
    case 'ArduPlane':
      return formatArduplaneFlightMode(customMode)
    case 'ArduRover':
      return formatArduroverFlightMode(customMode)
    case 'ArduSub':
      return formatArdusubFlightMode(customMode)
    default:
      return formatArducopterFlightMode(customMode)
  }
}

export function createIdleParameterSync(): ParameterSyncState {
  return {
    status: 'idle',
    downloaded: 0,
    total: 0,
    duplicateFrames: 0,
    progress: null
  }
}

export function createIdleUartsFileState(): BoardFileState {
  return {
    status: 'idle',
    path: UARTS_FILE_PATH,
    mappings: []
  }
}

export function createIdleLiveVerification(): LiveVerificationState {
  return {
    satisfiedSignals: [],
    rcInput: {
      verified: false,
      channelCount: 0,
      channels: []
    },
    batteryTelemetry: {
      verified: false
    },
    attitudeTelemetry: {
      verified: false
    },
    globalPosition: {
      verified: false
    },
    baroSensor: {
      verified: false,
      present: false,
      healthy: false
    },
    gyroSensor: {
      verified: false,
      present: false,
      healthy: false
    },
    accelSensor: {
      verified: false,
      present: false,
      healthy: false
    },
    magSensor: {
      verified: false,
      present: false,
      healthy: false
    },
    gpsSensor: {
      verified: false,
      present: false,
      healthy: false
    },
    opticalFlow: {
      verified: false
    }
  }
}

export function createIdleMotorTestState(): MotorTestState {
  return {
    status: 'idle',
    summary: 'No motor test has been requested.',
    instructions: ['Motor tests remain disabled until the vehicle is connected, synced, disarmed, and explicitly acknowledged as a props-off bench session.']
  }
}

export function createIdleGuidedActions(): Record<GuidedActionId, GuidedActionState> {
  return {
    'request-parameters': createIdleGuidedAction('request-parameters'),
    'calibrate-accelerometer': createIdleGuidedAction('calibrate-accelerometer'),
    'calibrate-level': createIdleGuidedAction('calibrate-level'),
    'calibrate-compass': createIdleGuidedAction('calibrate-compass'),
    'reboot-autopilot': createIdleGuidedAction('reboot-autopilot')
  }
}

export function createIdleGuidedAction(actionId: GuidedActionId): GuidedActionState {
  return {
    actionId,
    status: 'idle',
    summary: idleSummaryForAction(actionId),
    instructions: defaultInstructionsForAction(actionId),
    statusTexts: []
  }
}

export function buildAccelerometerCalibrationGuidedAction(
  stepIndex: number,
  current: GuidedActionState
): GuidedActionState {
  const step = ACCELEROMETER_CALIBRATION_STEPS[stepIndex]
  if (!step) {
    return {
      ...current,
      status: 'running',
      summary: 'Finalizing accelerometer calibration…',
      instructions: ['Keep the vehicle still while ArduPilot stores the new accelerometer calibration.'],
      ctaLabel: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    }
  }

  const now = Date.now()
  return {
    ...current,
    status: 'running',
    summary: step.summary,
    instructions: Array.from(step.instructions),
    ctaLabel: step.ctaLabel,
    updatedAtMs: now,
    completedAtMs: undefined,
    startedAtMs: current.startedAtMs ?? now
  }
}

export function cloneGuidedActions(guidedActions: Record<GuidedActionId, GuidedActionState>): Record<GuidedActionId, GuidedActionState> {
  return Object.fromEntries(
    GUIDED_ACTION_IDS.map((actionId) => [
      actionId,
      {
        ...guidedActions[actionId],
        instructions: [...guidedActions[actionId].instructions],
        statusTexts: [...guidedActions[actionId].statusTexts]
      }
    ])
  ) as Record<GuidedActionId, GuidedActionState>
}

export function cloneLiveVerification(liveVerification: LiveVerificationState): LiveVerificationState {
  return {
    satisfiedSignals: [...liveVerification.satisfiedSignals],
    rcInput: {
      ...liveVerification.rcInput,
      channels: [...liveVerification.rcInput.channels]
    },
    batteryTelemetry: {
      ...liveVerification.batteryTelemetry
    },
    attitudeTelemetry: {
      ...liveVerification.attitudeTelemetry
    },
    globalPosition: {
      ...liveVerification.globalPosition
    },
    baroSensor: {
      ...liveVerification.baroSensor
    },
    gyroSensor: {
      ...liveVerification.gyroSensor
    },
    accelSensor: {
      ...liveVerification.accelSensor
    },
    magSensor: {
      ...liveVerification.magSensor
    },
    gpsSensor: {
      ...liveVerification.gpsSensor
    },
    opticalFlow: {
      ...liveVerification.opticalFlow
    }
  }
}

export function clonePreArmStatus(preArmStatus: PreArmStatusState): PreArmStatusState {
  return {
    healthy: preArmStatus.healthy,
    lastUpdatedAtMs: preArmStatus.lastUpdatedAtMs,
    issues: preArmStatus.issues.map((issue) => ({
      ...issue
    }))
  }
}

export function cloneMotorTestState(motorTest: MotorTestState): MotorTestState {
  return {
    ...motorTest,
    instructions: [...motorTest.instructions]
  }
}

export function cloneBoardFileState(boardFile: BoardFileState): BoardFileState {
  return {
    ...boardFile,
    mappings: boardFile.mappings.map((mapping) => ({ ...mapping }))
  }
}

export function cloneHardwareState(hardware: HardwareState): HardwareState {
  return {
    board: hardware.board ? { ...hardware.board } : undefined,
    uartsFile: cloneBoardFileState(hardware.uartsFile),
    pwmOutputCount: hardware.pwmOutputCount
  }
}

/**
 * Parse ArduPilot's "RCOut: PWM:1-N" boot-banner STATUSTEXT into a channel
 * count. The banner is the only on-wire signal for how many physical PWM
 * outputs a board exposes (`SERVOn_FUNCTION` params allocate up to MAX_SERVO
 * regardless of hardware). Returns undefined when the line doesn't match.
 * Multi-range banners ("RCOut: PWM:1-8 PWM:9-12") take the highest endpoint.
 */
export function parsePwmOutputCountFromBanner(text: string): number | undefined {
  if (!/^\s*RCOut:/i.test(text)) return undefined
  let best: number | undefined
  // Match any PWM channel range; take the max endpoint as the total count.
  const re = /PWM:\d+-(\d+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1])
    if (!Number.isFinite(value) || value < 1 || value > 64) continue
    if (best === undefined || value > best) best = value
  }
  return best
}

export function sortMavftpDirectoryEntries(left: MavftpDirectoryEntry, right: MavftpDirectoryEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
}

export function hasActiveGuidedAction(guidedActions: Record<GuidedActionId, GuidedActionState>): boolean {
  return GUIDED_ACTION_IDS.some((actionId) => {
    const status = guidedActions[actionId].status
    return status === 'requested' || status === 'running'
  })
}

export function approximatelyEqualParameterValue(left: number, right: number, tolerance = DEFAULT_PARAMETER_WRITE_TOLERANCE): boolean {
  const relativeTolerance = Math.max(Math.abs(right) * 1e-6, tolerance)
  return Math.abs(left - right) <= relativeTolerance
}

export function formatParameterValueForLog(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '')
}

export function idleSummaryForAction(actionId: GuidedActionId): string {
  switch (actionId) {
    case 'request-parameters':
      return 'Ready to request the full parameter table.'
    case 'calibrate-accelerometer':
      return 'Accelerometer calibration has not started.'
    case 'calibrate-level':
      return 'Board level calibration has not started.'
    case 'calibrate-compass':
      return 'Compass calibration has not started.'
    case 'reboot-autopilot':
      return 'No reboot has been requested.'
    default:
      return 'Ready.'
  }
}

// Count compasses that are BOTH enabled (COMPASS_USE*) AND backed by a
// detected device — COMPASS_USE* default to 1 even with no magnetometer, so
// the enabled flag alone over-counts. ArduPilot indexes the two families
// differently: COMPASS_USE*/COMPASS_PRIO{n}_ID by priority, COMPASS_DEV_ID*
// by state slot, and they diverge once compasses are reordered/disabled.
// Presence is therefore "nonzero priority-id OR nonzero same-index dev-id",
// falling back to the enabled flag when firmware streams neither.
const COMPASS_SLOTS: ReadonlyArray<{ use: string; prioId: string; devId: string }> = [
  { use: 'COMPASS_USE', prioId: 'COMPASS_PRIO1_ID', devId: 'COMPASS_DEV_ID' },
  { use: 'COMPASS_USE2', prioId: 'COMPASS_PRIO2_ID', devId: 'COMPASS_DEV_ID2' },
  { use: 'COMPASS_USE3', prioId: 'COMPASS_PRIO3_ID', devId: 'COMPASS_DEV_ID3' }
]

export function enabledCompassCountFromParameters(parameters: Map<string, ParameterState>): number {
  return COMPASS_SLOTS.filter(({ use, prioId, devId }) => {
    const useValue = parameters.get(use)?.value
    const enabled = useValue !== undefined && Math.round(useValue) > 0
    if (!enabled) {
      return false
    }

    const prioValue = parameters.get(prioId)?.value
    const devValue = parameters.get(devId)?.value
    const prioPresent = prioValue !== undefined
    const devPresent = devValue !== undefined

    // If neither the priority-list id nor the state-slot device id is in the
    // table (older builds / partial param tables), fall back to the enabled
    // flag alone rather than hiding a compass that might be present.
    if (!prioPresent && !devPresent) {
      return true
    }

    // A nonzero in EITHER indexing proves a real compass occupies this
    // priority; only a present-and-zero in both means "no hardware here".
    return (
      (prioPresent && Math.round(prioValue) !== 0) || (devPresent && Math.round(devValue) !== 0)
    )
  }).length
}

export function defaultInstructionsForAction(actionId: GuidedActionId): string[] {
  switch (actionId) {
    case 'request-parameters':
      return ['Pull the full parameter table before attempting guided setup or parameter edits.']
    case 'calibrate-accelerometer':
      return [
        'Keep the vehicle disarmed on a stable surface.',
        'Follow each orientation request from the autopilot and hold the frame still until the next prompt appears.'
      ]
    case 'calibrate-level':
      return [
        'Place the vehicle on a level surface — match what the FC sees as "ground" during flight.',
        'Press Calibrate Level and keep the frame motionless. ArduPilot samples a few seconds of attitude and stores AHRS_TRIM_X / AHRS_TRIM_Y.'
      ]
    case 'calibrate-compass':
      return [
        'Keep the vehicle away from strong magnetic interference.',
        'Rotate the vehicle smoothly through all axes until the autopilot reports completion.'
      ]
    case 'reboot-autopilot':
      return ['Expect the serial link to drop if the autopilot accepts the reboot request.']
    default:
      return []
  }
}

export function appendGuidedActionText(statusTexts: string[], text: string): string[] {
  const next = statusTexts[0] === text ? [...statusTexts] : [text, ...statusTexts]
  return next.slice(0, MAX_GUIDED_ACTION_STATUS_TEXTS)
}

export function includesAny(text: string, fragments: string[]): boolean {
  return fragments.some((fragment) => text.includes(fragment))
}

export function matchesGenericCalibrationSuccess(text: string): boolean {
  return includesAny(text, [
    'successful',
    'succeeded',
    'finished',
    'done',
    'complete',
    'completed'
  ])
}

export function matchesGenericCalibrationFailure(text: string): boolean {
  // Anchor on "calibration"/"cal " so per-pose retry hints that merely
  // contain "fail" (e.g. "Bad cal sample - try again") don't hard-fail the
  // whole calibration.
  if (!text.includes('calibration') && !text.includes('cal ')) {
    return false
  }
  return includesAny(text, [
    'failed',
    'failure',
    'cancelled',
    'canceled',
    'aborted'
  ])
}

export function normalizePreArmIssueText(text: string): string | undefined {
  const normalized = text.trim()
  const prefixedMatch = normalized.match(/^prearm[:\s-]*(.+)$/i)
  if (prefixedMatch) {
    return `PreArm: ${prefixedMatch[1].trim()}`
  }

  const inlineMatch = normalized.match(/\bprearm[:\s-]*(.+)$/i)
  if (inlineMatch) {
    return `PreArm: ${inlineMatch[1].trim()}`
  }

  return undefined
}

export function matchGuidedActionText(
  actionId: GuidedActionId,
  current: GuidedActionState,
  text: string
):
  | {
      status?: GuidedActionState['status']
      summary: string
      instructions?: string[]
    }
  | undefined {
  const normalized = text.toLowerCase()
  const actionIsActive = current.status === 'requested' || current.status === 'running'

  if (actionId === 'calibrate-accelerometer') {
    if (
      normalized.includes('accelerometer calibration complete') ||
      (actionIsActive &&
        includesAny(normalized, [
          'accel calibration successful',
          'accelerometer calibration successful',
          'accel cal successful',
          'calibration successful',
          'calibration complete',
          'calibration completed'
        ])) ||
      (actionIsActive && matchesGenericCalibrationSuccess(normalized))
    ) {
      return {
        status: 'succeeded',
        summary: 'Accelerometer calibration complete.',
        instructions: ['Review the updated setup state before moving on to compass or radio setup.']
      }
    }
    if (
      normalized.includes('accelerometer calibration failed') ||
      normalized.includes('accel cal failed') ||
      (actionIsActive &&
        includesAny(normalized, [
          'accelerometer calibration failed',
          'accel calibration failed',
          'accel cal failed',
          'calibration failed',
          'calibration cancelled',
          'calibration canceled'
        ])) ||
      (actionIsActive && matchesGenericCalibrationFailure(normalized))
    ) {
      return {
        status: 'failed',
        summary: 'Accelerometer calibration failed.',
        instructions: defaultInstructionsForAction(actionId)
      }
    }
    if (actionIsActive && normalized.includes('level')) {
      return {
        status: 'running',
        summary: 'Place the vehicle level and keep it still.',
        instructions: ['Set the frame level on a stable surface and wait for the next orientation prompt.']
      }
    }
    if (actionIsActive && normalized.includes('left')) {
      return {
        status: 'running',
        summary: 'Place the vehicle on its left side and keep it still.',
        instructions: ['Move the frame onto its left side and avoid motion until the next prompt.']
      }
    }
    if (actionIsActive && normalized.includes('right')) {
      return {
        status: 'running',
        summary: 'Place the vehicle on its right side and keep it still.',
        instructions: ['Move the frame onto its right side and avoid motion until the next prompt.']
      }
    }
    if (actionIsActive && normalized.includes('nose down')) {
      return {
        status: 'running',
        summary: 'Place the vehicle nose down and keep it still.',
        instructions: ['Tilt the frame nose-down and hold it steady until the autopilot advances.']
      }
    }
    if (actionIsActive && normalized.includes('nose up')) {
      return {
        status: 'running',
        summary: 'Place the vehicle nose up and keep it still.',
        instructions: ['Tilt the frame nose-up and hold it steady until the autopilot advances.']
      }
    }
    if (actionIsActive && normalized.includes('back')) {
      return {
        status: 'running',
        summary: 'Place the vehicle on its back and keep it still.',
        instructions: ['Flip the frame onto its back and keep it motionless until calibration completes.']
      }
    }
    if (normalized.includes('accelerometer calibration')) {
      return {
        status: 'running',
        summary: text,
        instructions: current.ctaLabel ? current.instructions : defaultInstructionsForAction(actionId)
      }
    }
  }

  if (actionId === 'calibrate-level') {
    // Every level match is gated on actionIsActive: level cal completes on
    // its own COMMAND_ACK (no success STATUSTEXT on real firmware), so these
    // text matches are only a supplement while a level cal is in progress and
    // must never fire against accel-cal text when level is idle.
    if (
      actionIsActive &&
      (normalized.includes('level calibration complete') ||
        normalized.includes('trim ok') ||
        includesAny(normalized, [
          'level calibration successful',
          'calibration successful',
          'calibration complete',
          'calibration completed'
        ]) ||
        matchesGenericCalibrationSuccess(normalized))
    ) {
      return {
        status: 'succeeded',
        summary: 'Board level calibration complete.',
        instructions: ['AHRS_TRIM_X and AHRS_TRIM_Y were updated; re-pull parameters if you want a clean post-cal snapshot.']
      }
    }
    if (
      actionIsActive &&
      (normalized.includes('level calibration failed') ||
        includesAny(normalized, [
          'level calibration failed',
          'calibration failed',
          'calibration cancelled',
          'calibration canceled'
        ]) ||
        matchesGenericCalibrationFailure(normalized))
    ) {
      return {
        status: 'failed',
        summary: 'Board level calibration failed.',
        instructions: defaultInstructionsForAction(actionId)
      }
    }
  }

  if (actionId === 'calibrate-compass') {
    if (
      normalized.includes('compass calibration complete') ||
      (actionIsActive &&
        includesAny(normalized, [
          'compass calibration successful',
          'mag calibration successful',
          'calibration successful',
          'calibration complete',
          'calibration completed'
        ])) ||
      (actionIsActive && matchesGenericCalibrationSuccess(normalized))
    ) {
      return {
        status: 'succeeded',
        summary: 'Compass calibration complete.',
        instructions: ['Review compass health before flight, especially if this was a USB-only bench session.']
      }
    }
    if (
      normalized.includes('compass calibration failed') ||
      normalized.includes('mag calibration failed') ||
      (actionIsActive &&
        includesAny(normalized, [
          'compass calibration failed',
          'mag calibration failed',
          'calibration failed',
          'calibration cancelled',
          'calibration canceled'
        ])) ||
      (actionIsActive && matchesGenericCalibrationFailure(normalized))
    ) {
      return {
        status: 'failed',
        summary: 'Compass calibration failed.',
        instructions: defaultInstructionsForAction(actionId)
      }
    }
    if (
      actionIsActive &&
      (normalized.includes('rotate') ||
        normalized.includes('yaw') ||
        normalized.includes('pitch') ||
        normalized.includes('roll'))
    ) {
      return {
        status: 'running',
        summary: 'Rotate the vehicle through all axes until compass calibration completes.',
        instructions: defaultInstructionsForAction(actionId)
      }
    }
    if (normalized.includes('compass calibration')) {
      return {
        status: 'running',
        summary: text,
        instructions: defaultInstructionsForAction(actionId)
      }
    }
  }

  if (actionId === 'reboot-autopilot') {
    if (normalized.includes('reboot requested') || normalized.includes('rebooting')) {
      return {
        status: 'succeeded',
        summary: 'Autopilot reboot requested.',
        instructions: defaultInstructionsForAction(actionId)
      }
    }
  }

  return undefined
}

export function isAuthoritativeHeartbeat(message: HeartbeatMessage): boolean {
  return message.autopilot === MAV_AUTOPILOT.ARDUPILOTMEGA
}

// UAVCAN_NODE_HEALTH enum, mirrored from uavcan.protocol.NodeStatus.Health
// via ArduPilot's MAVLink-UAVCAN bridge. Anything outside the documented
// range maps to 'unknown' rather than silently falling through.
export function canNodeHealthFromCode(code: number): CanNodeHealth {
  switch (code) {
    case 0:
      return 'ok'
    case 1:
      return 'warning'
    case 2:
      return 'error'
    case 3:
      return 'critical'
    default:
      return 'unknown'
  }
}

// UAVCAN_NODE_MODE enum, mirrored from uavcan.protocol.NodeStatus.Mode.
export function canNodeModeFromCode(code: number): CanNodeMode {
  switch (code) {
    case 0:
      return 'operational'
    case 1:
      return 'initialization'
    case 2:
      return 'maintenance'
    case 3:
      return 'software_update'
    case 7:
      return 'offline'
    default:
      return 'unknown'
  }
}

/**
 * Decode HEARTBEAT.system_status (MAV_STATE) into a stable operator-
 * readable label. Codes outside the documented range fall to
 * 'unknown' rather than being silently treated as 'standby' or similar.
 */
export function vehicleSystemStatusFromCode(code: number): VehicleSystemStatus {
  switch (code) {
    case MAV_STATE.UNINIT:
      return 'uninit'
    case MAV_STATE.BOOT:
      return 'boot'
    case MAV_STATE.CALIBRATING:
      return 'calibrating'
    case MAV_STATE.STANDBY:
      return 'standby'
    case MAV_STATE.ACTIVE:
      return 'active'
    case MAV_STATE.CRITICAL:
      return 'critical'
    case MAV_STATE.EMERGENCY:
      return 'emergency'
    case MAV_STATE.POWEROFF:
      return 'poweroff'
    case MAV_STATE.FLIGHT_TERMINATION:
      return 'flight-termination'
    default:
      return 'unknown'
  }
}

export function createVehicleIdentity(message: HeartbeatMessage, systemId: number, componentId: number): VehicleIdentity {
  const vehicle: VehicleIdentity['vehicle'] = ARDUCOPTER_MAV_TYPES.has(message.vehicleType)
    ? 'ArduCopter'
    : ARDUPLANE_MAV_TYPES.has(message.vehicleType)
      ? 'ArduPlane'
      : ARDUROVER_MAV_TYPES.has(message.vehicleType)
        ? 'ArduRover'
        : ARDUSUB_MAV_TYPES.has(message.vehicleType)
          ? 'ArduSub'
          : 'Unknown'
  return {
    firmware: 'ArduPilot',
    vehicle,
    systemId,
    componentId,
    armed: Boolean(message.baseMode & MAV_MODE_FLAG.SAFETY_ARMED),
    flightMode: formatArduPilotMode(message.customMode, vehicle),
    systemStatus: vehicleSystemStatusFromCode(message.systemStatus)
  }
}

export function recomputeSatisfiedSignals(liveVerification: LiveVerificationState): LiveSignalId[] {
  const signals: LiveSignalId[] = []
  if (liveVerification.rcInput.verified) {
    signals.push('rc-input')
  }
  if (liveVerification.batteryTelemetry.verified) {
    signals.push('battery-telemetry')
  }
  return signals
}

export function radiansToDegrees(value: number): number {
  return Number((value * (180 / Math.PI)).toFixed(1))
}

export function isValidGlobalCoordinates(latitudeE7: number, longitudeE7: number): boolean {
  const latitudeDeg = latitudeE7 / 1e7
  const longitudeDeg = longitudeE7 / 1e7
  return latitudeE7 !== 0 && longitudeE7 !== 0 && Math.abs(latitudeDeg) <= 90 && Math.abs(longitudeDeg) <= 180
}

export function liveSignalLabel(signalId: LiveSignalId): string {
  if (signalId === 'rc-input') {
    return 'RC input telemetry'
  }
  return 'battery telemetry'
}

export function mavResultLabel(result: number): string {
  switch (result) {
    case MAV_RESULT.ACCEPTED:
      return 'ACCEPTED'
    case MAV_RESULT.TEMPORARILY_REJECTED:
      return 'TEMPORARILY_REJECTED'
    case MAV_RESULT.DENIED:
      return 'DENIED'
    case MAV_RESULT.UNSUPPORTED:
      return 'UNSUPPORTED'
    case MAV_RESULT.FAILED:
      return 'FAILED'
    case MAV_RESULT.IN_PROGRESS:
      return 'IN_PROGRESS'
    default:
      return `UNKNOWN(${result})`
  }
}

export function mavCommandLabel(command: number): string {
  // Keep this table aligned with every MAV_CMD the runtime actually sends, so
  // diagnostic strings (rejection errors, timeout self-diagnostic) read as the
  // command name instead of a bare `COMMAND(42424)`.
  switch (command) {
    case MAV_CMD.PREFLIGHT_CALIBRATION:
      return 'PREFLIGHT_CALIBRATION'
    case MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN:
      return 'PREFLIGHT_REBOOT_SHUTDOWN'
    case MAV_CMD.PREFLIGHT_STORAGE:
      return 'PREFLIGHT_STORAGE'
    case MAV_CMD.SET_MESSAGE_INTERVAL:
      return 'SET_MESSAGE_INTERVAL'
    case MAV_CMD.REQUEST_MESSAGE:
      return 'REQUEST_MESSAGE'
    case MAV_CMD.DO_MOTOR_TEST:
      return 'DO_MOTOR_TEST'
    case MAV_CMD.DO_START_MAG_CAL:
      return 'DO_START_MAG_CAL'
    case MAV_CMD.DO_ACCEPT_MAG_CAL:
      return 'DO_ACCEPT_MAG_CAL'
    case MAV_CMD.DO_CANCEL_MAG_CAL:
      return 'DO_CANCEL_MAG_CAL'
    case MAV_CMD.ACCELCAL_VEHICLE_POS:
      return 'ACCELCAL_VEHICLE_POS'
    case MAV_CMD.UAVCAN_GET_NODE_INFO:
      return 'UAVCAN_GET_NODE_INFO'
    default:
      return `COMMAND(${command})`
  }
}

export function isPwmChannelValue(value: number): boolean {
  return value >= 800 && value <= 2200
}

