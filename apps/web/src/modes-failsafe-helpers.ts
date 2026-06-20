// Flight-mode + failsafe-row helpers, extracted from App.tsx as part of its
// decomposition. Pure helpers that format mode-slot assignments, resolve the
// per-vehicle mode-slot parameter id, and build the Failsafe view's rows from
// the live snapshot. No React, no app state.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import {
  arducopterFlightModeLabel,
  arduplaneFlightModeLabel,
  arduroverFlightModeLabel,
  ardusubFlightModeLabel,
  formatArducopterBatteryFailsafeAction,
  formatArducopterEkfFailsafeAction,
  formatArducopterGcsFailsafe,
  formatArducopterThrottleFailsafe
} from '@arduconfig/param-metadata'

import { readParameterValue, readRoundedParameter, selectParameterById } from './selectors/parameter-read'
import type { DetectedVehicle } from './app-types'
import type { FailsafeViewRow } from './views/Failsafe'

// A flight-mode slot can hold a value that doesn't map to a real selectable
// mode (a gap in the vehicle's mode list, or a value from a firmware our map
// doesn't cover). Rather than surfacing a confusing "Mode 23" placeholder in
// the receiver/modes UI, render unknown (and unset) assignments as an em
// dash so the operator reads it as "nothing here" instead of a fake mode.
export function formatModeAssignment(value: number | undefined, vehicle: DetectedVehicle = 'ArduCopter'): string {
  const label =
    vehicle === 'ArduPlane'
      ? arduplaneFlightModeLabel(value)
      : vehicle === 'ArduRover'
        ? arduroverFlightModeLabel(value)
        : vehicle === 'ArduSub'
          ? ardusubFlightModeLabel(value)
          : arducopterFlightModeLabel(value)
  return label ?? '—'
}

export type FltModeParamId = 'FLTMODE1' | 'FLTMODE2' | 'FLTMODE3' | 'FLTMODE4' | 'FLTMODE5' | 'FLTMODE6'

export const MODES_SLOT_DEFINITIONS: ReadonlyArray<{
  position: number
  paramId: FltModeParamId
  pwmLabel: string
}> = [
  { position: 1, paramId: 'FLTMODE1', pwmLabel: '0 – 1230 us' },
  { position: 2, paramId: 'FLTMODE2', pwmLabel: '1231 – 1360 us' },
  { position: 3, paramId: 'FLTMODE3', pwmLabel: '1361 – 1490 us' },
  { position: 4, paramId: 'FLTMODE4', pwmLabel: '1491 – 1620 us' },
  { position: 5, paramId: 'FLTMODE5', pwmLabel: '1621 – 1749 us' },
  { position: 6, paramId: 'FLTMODE6', pwmLabel: '1750+ us' }
]

// Copter/Plane use FLTMODE1..6; ArduRover uses MODE1..6. Mirrors the
// core setup-exercises helper so the Modes/Receiver UI reads the right
// switch-slot param for the connected vehicle (Sub is joystick-driven
// and has no switch family — FLTMODE* simply absent, which is correct).
export function modeSlotParamId(vehicle: DetectedVehicle | undefined, slot: number): string {
  return vehicle === 'ArduRover' ? `MODE${slot}` : `FLTMODE${slot}`
}

// Generic vehicle-neutral failsafe row: resolves the value's display from
// the param's bound catalog definition (enum label) or a plain number.
// Used for Plane/Rover/Sub whose real failsafe params (FS_LONG_ACTN,
// FS_ACTION, FS_LEAK_ENABLE, …) the C2/C3 catalogs define with options.
export function genericFailsafeRow(
  snapshot: ConfiguratorSnapshot,
  source: string,
  paramId: string
): FailsafeViewRow {
  const param = selectParameterById(snapshot, paramId)
  const value = param?.value
  let formatted = 'Not synced'
  if (value !== undefined) {
    const option = param?.definition?.options?.find((entry) => entry.value === Math.round(value))
    formatted = option ? option.label : String(Number.isInteger(value) ? value : Number(value.toFixed(2)))
  }
  return { source, paramId, formatted, isSynced: value !== undefined, parameter: param }
}

// Vehicle-correct enum label for a failsafe-action summary value.
// ArduCopter (and pre-connect / Unknown) returns the exact ARDUCOPTER_*
// formatter output — byte-identical. A connected non-Copter resolves the
// label from the param's bound catalog definition (metadataByVehicle
// gives the right per-vehicle options): Plane/Rover/Sub battery & RC
// failsafe action enums differ from Copter's, so the Copter map would
// otherwise show a wrong action to the operator (safety-relevant).
export function failsafeActionLabel(
  snapshot: ConfiguratorSnapshot,
  paramId: string,
  value: number | undefined,
  copterFormat: (value: number | undefined) => string
): string {
  if ((snapshot.vehicle?.vehicle ?? 'ArduCopter') === 'ArduCopter') {
    return copterFormat(value)
  }
  if (value === undefined) {
    return copterFormat(undefined)
  }
  const definition = selectParameterById(snapshot, paramId)?.definition
  const option = definition?.options?.find((entry) => entry.value === Math.round(value))
  return option ? option.label : copterFormat(value)
}

export function buildSharedBatteryFailsafeRows(snapshot: ConfiguratorSnapshot): FailsafeViewRow[] {
  // ArduPilot's battery library only registers BATT_FS_*/BATT_LOW_*/BATT_CRT_*
  // params when a battery monitor is enabled (BATT_MONITOR != 0). With
  // BATT_MONITOR=0 those params don't exist on the FC, so rendering four
  // "Not synced" rows reads as "still loading" when it's actually "off by
  // configuration". Surface ONE honest explainer row instead.
  const battMonitorParam = selectParameterById(snapshot, 'BATT_MONITOR')
  const battMonitor = battMonitorParam?.value
  if (battMonitor !== undefined && Math.round(battMonitor) === 0) {
    return [
      {
        source: 'Battery failsafe',
        paramId: 'BATT_MONITOR',
        formatted:
          'Disabled — enable BATT_MONITOR (Power tab) to expose the voltage/current failsafe thresholds.',
        isSynced: true,
        parameter: battMonitorParam
      }
    ]
  }
  return [
    genericFailsafeRow(snapshot, 'Battery failsafe', 'BATT_LOW_VOLT'),
    genericFailsafeRow(snapshot, 'Battery failsafe', 'BATT_FS_LOW_ACT'),
    genericFailsafeRow(snapshot, 'Battery failsafe', 'BATT_CRT_VOLT'),
    genericFailsafeRow(snapshot, 'Battery failsafe', 'BATT_FS_CRT_ACT')
  ]
}

export function buildNonCopterFailsafeRows(
  snapshot: ConfiguratorSnapshot,
  vehicle: DetectedVehicle | undefined
): readonly FailsafeViewRow[] {
  if (vehicle === 'ArduPlane') {
    return [
      genericFailsafeRow(snapshot, 'RC failsafe', 'THR_FAILSAFE'),
      genericFailsafeRow(snapshot, 'RC failsafe', 'THR_FS_VALUE'),
      genericFailsafeRow(snapshot, 'Short failsafe', 'FS_SHORT_ACTN'),
      genericFailsafeRow(snapshot, 'Short failsafe', 'FS_SHORT_TIMEOUT'),
      genericFailsafeRow(snapshot, 'Long failsafe', 'FS_LONG_ACTN'),
      genericFailsafeRow(snapshot, 'Long failsafe', 'FS_LONG_TIMEOUT'),
      ...buildSharedBatteryFailsafeRows(snapshot),
      genericFailsafeRow(snapshot, 'GCS failsafe', 'FS_GCS_ENABLE')
    ]
  }
  if (vehicle === 'ArduRover') {
    return [
      genericFailsafeRow(snapshot, 'RC failsafe', 'FS_THR_ENABLE'),
      genericFailsafeRow(snapshot, 'RC failsafe', 'FS_THR_VALUE'),
      genericFailsafeRow(snapshot, 'Failsafe action', 'FS_ACTION'),
      genericFailsafeRow(snapshot, 'Failsafe action', 'FS_TIMEOUT'),
      genericFailsafeRow(snapshot, 'Crash check', 'FS_CRASH_CHECK'),
      ...buildSharedBatteryFailsafeRows(snapshot),
      genericFailsafeRow(snapshot, 'GCS failsafe', 'FS_GCS_ENABLE')
    ]
  }
  // ArduSub — the leak failsafe is the single most safety-critical Sub
  // setting and was previously not shown at all.
  return [
    genericFailsafeRow(snapshot, 'Leak failsafe', 'FS_LEAK_ENABLE'),
    genericFailsafeRow(snapshot, 'Internal pressure', 'FS_PRESS_ENABLE'),
    genericFailsafeRow(snapshot, 'Internal temperature', 'FS_TEMP_ENABLE'),
    genericFailsafeRow(snapshot, 'Pilot input', 'FS_PILOT_INPUT'),
    genericFailsafeRow(snapshot, 'GCS failsafe', 'FS_GCS_ENABLE'),
    ...buildSharedBatteryFailsafeRows(snapshot)
  ]
}

export function buildFailsafeRows(input: {
  snapshot: ConfiguratorSnapshot
  vehicle?: DetectedVehicle
  throttleFailsafe: number | undefined
  throttleFailsafeValue: number | undefined
  batteryFailsafe: number | undefined
  batteryCriticalFailsafe: number | undefined
  batteryLowVoltage: number | undefined
  batteryCriticalVoltage: number | undefined
}): readonly FailsafeViewRow[] {
  if ((input.vehicle ?? 'ArduCopter') !== 'ArduCopter') {
    return buildNonCopterFailsafeRows(input.snapshot, input.vehicle)
  }

  const rcTimeout = readParameterValue(input.snapshot, 'RC_FS_TIMEOUT')
  const fsOptions = readRoundedParameter(input.snapshot, 'FS_OPTIONS')

  // Same BATT_MONITOR=0 gating as the non-Copter path: when the battery
  // library hasn't registered (BATT_MONITOR=0), the four BATT_FS_* rows
  // below would all read "Not synced" — which on a fresh connect is
  // indistinguishable from "still loading" and reads as a real fault.
  // Replace them with one explainer row.
  const battMonitorParam = selectParameterById(input.snapshot, 'BATT_MONITOR')
  const battMonitor = battMonitorParam?.value
  const batteryRows: FailsafeViewRow[] =
    battMonitor !== undefined && Math.round(battMonitor) === 0
      ? [
          {
            source: 'Battery failsafe',
            paramId: 'BATT_MONITOR',
            formatted:
              'Disabled — enable BATT_MONITOR (Power tab) to expose the voltage/current failsafe thresholds.',
            isSynced: true,
            parameter: battMonitorParam
          }
        ]
      : [
          {
            source: 'Battery failsafe',
            paramId: 'BATT_LOW_VOLT',
            formatted: input.batteryLowVoltage !== undefined ? `${input.batteryLowVoltage.toFixed(2)} V` : 'Not synced',
            isSynced: input.batteryLowVoltage !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_LOW_MAH',
            formatted: (() => {
              const raw = readRoundedParameter(input.snapshot, 'BATT_LOW_MAH')
              return raw !== undefined ? `${raw} mAh` : 'Not synced'
            })(),
            isSynced: readParameterValue(input.snapshot, 'BATT_LOW_MAH') !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_FS_LOW_ACT',
            formatted: formatArducopterBatteryFailsafeAction(input.batteryFailsafe),
            isSynced: input.batteryFailsafe !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_CRT_VOLT',
            formatted: input.batteryCriticalVoltage !== undefined ? `${input.batteryCriticalVoltage.toFixed(2)} V` : 'Not synced',
            isSynced: input.batteryCriticalVoltage !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_CRT_MAH',
            formatted: (() => {
              const raw = readRoundedParameter(input.snapshot, 'BATT_CRT_MAH')
              return raw !== undefined ? `${raw} mAh` : 'Not synced'
            })(),
            isSynced: readParameterValue(input.snapshot, 'BATT_CRT_MAH') !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_FS_CRT_ACT',
            formatted: formatArducopterBatteryFailsafeAction(input.batteryCriticalFailsafe),
            isSynced: input.batteryCriticalFailsafe !== undefined
          },
          {
            source: 'Battery failsafe',
            paramId: 'BATT_FS_VOLTSRC',
            formatted: (() => {
              const raw = readRoundedParameter(input.snapshot, 'BATT_FS_VOLTSRC')
              if (raw === undefined) return 'Not synced'
              return raw === 0 ? 'Raw voltage (0)' : raw === 1 ? 'Sag-compensated (1)' : `${raw}`
            })(),
            isSynced: readParameterValue(input.snapshot, 'BATT_FS_VOLTSRC') !== undefined
          }
        ]

  return [
    {
      source: 'RC failsafe',
      paramId: 'FS_THR_ENABLE',
      formatted: formatArducopterThrottleFailsafe(input.throttleFailsafe),
      isSynced: input.throttleFailsafe !== undefined
    },
    {
      source: 'RC failsafe',
      paramId: 'FS_THR_VALUE',
      formatted: input.throttleFailsafeValue !== undefined ? `${Math.round(input.throttleFailsafeValue)} us` : 'Not synced',
      isSynced: input.throttleFailsafeValue !== undefined
    },
    {
      source: 'RC failsafe',
      paramId: 'RC_FS_TIMEOUT',
      formatted: rcTimeout !== undefined ? `${rcTimeout.toFixed(1)} s` : 'Not synced',
      isSynced: rcTimeout !== undefined
    },
    ...batteryRows,
    {
      source: 'GCS failsafe',
      paramId: 'FS_GCS_ENABLE',
      formatted: formatArducopterGcsFailsafe(readRoundedParameter(input.snapshot, 'FS_GCS_ENABLE')),
      isSynced: readParameterValue(input.snapshot, 'FS_GCS_ENABLE') !== undefined
    },
    {
      source: 'EKF failsafe',
      paramId: 'FS_EKF_ACTION',
      formatted: formatArducopterEkfFailsafeAction(readRoundedParameter(input.snapshot, 'FS_EKF_ACTION')),
      isSynced: readParameterValue(input.snapshot, 'FS_EKF_ACTION') !== undefined
    },
    {
      source: 'EKF failsafe',
      paramId: 'FS_EKF_THRESH',
      formatted: (() => {
        const value = readParameterValue(input.snapshot, 'FS_EKF_THRESH')
        return value !== undefined ? value.toFixed(1) : 'Not synced'
      })(),
      isSynced: readParameterValue(input.snapshot, 'FS_EKF_THRESH') !== undefined
    },
    {
      source: 'Advanced',
      paramId: 'FS_OPTIONS',
      formatted: fsOptions !== undefined ? `Bitmask 0x${fsOptions.toString(16).toUpperCase()}` : 'Not synced',
      isSynced: fsOptions !== undefined
    }
  ]
}
