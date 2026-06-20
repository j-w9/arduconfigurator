import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  collectTerminalSetupExercises,
  deriveSetupProgressKey,
  loadStoredSetupProgress,
  saveStoredSetupProgress,
  type SetupExerciseStates,
  type StoredSetupProgress
} from './setup-progress-storage'

function snapshot(over: Record<string, unknown> = {}): ConfiguratorSnapshot {
  return {
    connection: { kind: 'connected' },
    vehicle: { vehicle: 'ArduCopter', systemId: 1, componentId: 1 },
    hardware: {
      board: { boardVersion: 1, boardType: 9, vendorId: 0x1209, productId: 0x5740, uid: '0123456789abcdef' }
    },
    ...over
  } as unknown as ConfiguratorSnapshot
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key)
  }
}

const exerciseStates = (over: Partial<SetupExerciseStates> = {}): SetupExerciseStates =>
  ({
    orientationExercise: { status: 'passed', targetSteps: [], completedSteps: [] },
    modeSwitchExercise: { status: 'running', targetSlots: [], visitedSlots: [], unexpectedSlots: [] },
    rcRangeExercise: { status: 'failed', targetAxes: [], axisProgress: {} },
    rcMappingSession: { status: 'ready', baselineChannels: [], captures: {} },
    rcCalibrationSession: { status: 'capturing', captures: {} },
    motorVerification: { status: 'idle', targetOutputs: [], verifiedOutputs: [] },
    ...over
  }) as unknown as SetupExerciseStates

const progress = (over: Partial<StoredSetupProgress> = {}): StoredSetupProgress => ({
  version: 1,
  savedAtMs: Date.now(),
  confirmations: { radio: { signature: 'sig', confirmedAtMs: 1, outcome: 'complete' } },
  exercises: {},
  ...over
})

describe('deriveSetupProgressKey', () => {
  it('prefers the per-unit board uid', () => {
    expect(deriveSetupProgressKey(snapshot())).toBe('arduconfig:setup-progress:uid:0123456789abcdef')
  })

  it('falls back to a vehicle+board composite when the uid is absent', () => {
    const key = deriveSetupProgressKey(
      snapshot({ hardware: { board: { boardType: 9, vendorId: 4617, productId: 22336 } } })
    )
    expect(key).toBe('arduconfig:setup-progress:board:ArduCopter:9:4617:22336')
  })

  it('returns undefined until the connection, vehicle, and board identity are all known', () => {
    expect(deriveSetupProgressKey(snapshot({ connection: { kind: 'disconnected' } }))).toBeUndefined()
    expect(deriveSetupProgressKey(snapshot({ vehicle: undefined }))).toBeUndefined()
    expect(deriveSetupProgressKey(snapshot({ hardware: {} }))).toBeUndefined()
  })
})

describe('collectTerminalSetupExercises', () => {
  it('keeps passed/ready results and drops idle, running, capturing, and failed states', () => {
    const collected = collectTerminalSetupExercises(exerciseStates())
    expect(Object.keys(collected).sort()).toEqual(['orientationExercise', 'rcMappingSession'])
  })

  it('collects all six when every exercise is terminal', () => {
    const collected = collectTerminalSetupExercises(
      exerciseStates({
        modeSwitchExercise: { status: 'passed' },
        rcRangeExercise: { status: 'passed' },
        rcCalibrationSession: { status: 'ready' },
        motorVerification: { status: 'passed' }
      } as unknown as Partial<SetupExerciseStates>)
    )
    expect(Object.keys(collected)).toHaveLength(6)
  })
})

describe('save/load round-trip', () => {
  const KEY = 'arduconfig:setup-progress:uid:test'

  it('round-trips stored progress', () => {
    const storage = memoryStorage()
    const stored = progress()
    saveStoredSetupProgress(KEY, stored, storage)
    expect(loadStoredSetupProgress(KEY, storage)).toEqual(stored)
  })

  it('returns undefined for missing, corrupt, or wrong-version entries', () => {
    const storage = memoryStorage({
      corrupt: '{not json',
      wrongVersion: JSON.stringify({ version: 2, savedAtMs: Date.now(), confirmations: {}, exercises: {} }),
      notObject: JSON.stringify('hello')
    })
    expect(loadStoredSetupProgress('absent', storage)).toBeUndefined()
    expect(loadStoredSetupProgress('corrupt', storage)).toBeUndefined()
    expect(loadStoredSetupProgress('wrongVersion', storage)).toBeUndefined()
    expect(loadStoredSetupProgress('notObject', storage)).toBeUndefined()
  })

  it('expires entries older than the max age and removes them', () => {
    const storage = memoryStorage()
    saveStoredSetupProgress(KEY, progress({ savedAtMs: Date.now() - 31 * 24 * 60 * 60 * 1000 }), storage)
    expect(loadStoredSetupProgress(KEY, storage)).toBeUndefined()
    expect(storage.data.has(KEY)).toBe(false)
  })

  it('never throws when storage rejects writes', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => {}
    }
    expect(() => saveStoredSetupProgress(KEY, progress(), throwing)).not.toThrow()
  })
})
