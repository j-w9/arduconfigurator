// Durable guided-setup progress.
//
// Operator confirmations and terminal exercise results live in React state;
// #707 made them survive link drops, but a page reload — common around FC
// reboots (Web Serial re-enumeration, a reflexive F5) — still wiped them,
// regressing every exercise/confirmation-gated wizard step (airframe,
// outputs, radio, modes, power) on real hardware. This module persists that
// progress to localStorage keyed by the connected board's identity and
// restores it on reconnect.
//
// Safety model: restoring onto the wrong craft is defended in layers —
// the storage key prefers the board's AUTOPILOT_VERSION uid (per-unit
// unique); confirmations only count while their parameter-bound signature
// still matches (see setup-confirmation-signatures.ts); and every derived
// write (RCMAP_*, RC ranges) still goes through operator-reviewed drafts.
// Stored exercise results are evidence of checks performed on THIS board,
// never a source of parameter values.

import type { ConfiguratorSnapshot, RcRangeExerciseState } from '@arduconfig/ardupilot-core'

import type {
  ModeSwitchExerciseState,
  MotorVerificationState,
  OrientationExerciseState,
  RcCalibrationSessionState,
  RcMappingSessionState,
  SetupConfirmationRecord
} from './app-types'

export interface StoredSetupExercises {
  orientationExercise?: OrientationExerciseState
  modeSwitchExercise?: ModeSwitchExerciseState
  rcRangeExercise?: RcRangeExerciseState
  rcMappingSession?: RcMappingSessionState
  rcCalibrationSession?: RcCalibrationSessionState
  motorVerification?: MotorVerificationState
}

export interface StoredSetupProgress {
  version: 1
  savedAtMs: number
  confirmations: Record<string, SetupConfirmationRecord>
  exercises: StoredSetupExercises
}

export interface SetupExerciseStates {
  orientationExercise: OrientationExerciseState
  modeSwitchExercise: ModeSwitchExerciseState
  rcRangeExercise: RcRangeExerciseState
  rcMappingSession: RcMappingSessionState
  rcCalibrationSession: RcCalibrationSessionState
  motorVerification: MotorVerificationState
}

const STORAGE_KEY_PREFIX = 'arduconfig:setup-progress:'
// Stale sign-offs should not resurface months later on a craft that has
// likely been rebuilt/retuned since.
const MAX_STORED_PROGRESS_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Storage key for the connected vehicle, or undefined while the identity
 * isn't known yet (pre-connect, or before AUTOPILOT_VERSION/board info
 * arrives). Prefers the board uid (per-unit unique). The composite
 * fallback can collide between two identical board models — acceptable
 * because confirmations stay signature-gated against the actual params.
 */
export function deriveSetupProgressKey(snapshot: ConfiguratorSnapshot): string | undefined {
  if (snapshot.connection.kind !== 'connected' || snapshot.vehicle === undefined) {
    return undefined
  }

  const board = snapshot.hardware.board
  if (!board) {
    return undefined
  }

  if (board.uid) {
    return `${STORAGE_KEY_PREFIX}uid:${board.uid}`
  }

  return `${STORAGE_KEY_PREFIX}board:${snapshot.vehicle.vehicle}:${board.boardType}:${board.vendorId}:${board.productId}`
}

/**
 * Keep only terminal results. In-flight exercises track live telemetry and
 * are meaningless across a reload; failed ones are retried, not restored.
 */
export function collectTerminalSetupExercises(states: SetupExerciseStates): StoredSetupExercises {
  const exercises: StoredSetupExercises = {}
  if (states.orientationExercise.status === 'passed') {
    exercises.orientationExercise = states.orientationExercise
  }
  if (states.modeSwitchExercise.status === 'passed') {
    exercises.modeSwitchExercise = states.modeSwitchExercise
  }
  if (states.rcRangeExercise.status === 'passed') {
    exercises.rcRangeExercise = states.rcRangeExercise
  }
  if (states.rcMappingSession.status === 'ready') {
    exercises.rcMappingSession = states.rcMappingSession
  }
  if (states.rcCalibrationSession.status === 'ready') {
    exercises.rcCalibrationSession = states.rcCalibrationSession
  }
  if (states.motorVerification.status === 'passed') {
    exercises.motorVerification = states.motorVerification
  }
  return exercises
}

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  if (storage) {
    return storage
  }
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    // Some embedding contexts throw on localStorage access entirely.
    return undefined
  }
}

export function loadStoredSetupProgress(
  key: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): StoredSetupProgress | undefined {
  const store = resolveStorage(storage)
  if (!store) {
    return undefined
  }

  try {
    const raw = store.getItem(key)
    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw) as StoredSetupProgress
    if (
      parsed?.version !== 1 ||
      typeof parsed.savedAtMs !== 'number' ||
      typeof parsed.confirmations !== 'object' ||
      parsed.confirmations === null ||
      typeof parsed.exercises !== 'object' ||
      parsed.exercises === null
    ) {
      return undefined
    }

    if (Date.now() - parsed.savedAtMs > MAX_STORED_PROGRESS_AGE_MS) {
      store.removeItem(key)
      return undefined
    }

    return parsed
  } catch {
    // Corrupt entry or storage read failure — treat as no stored progress.
    return undefined
  }
}

export function saveStoredSetupProgress(
  key: string,
  progress: StoredSetupProgress,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): void {
  const store = resolveStorage(storage)
  if (!store) {
    return
  }

  try {
    store.setItem(key, JSON.stringify(progress))
  } catch {
    // Quota/permission failures must never break the app — persistence is
    // best-effort on top of the in-memory state.
  }
}
