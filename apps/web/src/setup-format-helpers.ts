// Setup / view formatting helpers, extracted from App.tsx as part of its
// decomposition. Pure formatters for confirmation timestamps, setup-section
// outcomes, AHRS orientation labels, degrees, and per-view monogram / mission
// title. No React, no app state.

import type { AppViewId } from '@arduconfig/param-metadata'

import type { SetupSectionOutcome } from './app-types'

const ORIENTATION_LABELS: Record<number, string> = {
  0: 'No rotation',
  2: 'Yaw 90',
  4: 'Yaw 180',
  6: 'Yaw 270',
  8: 'Roll 180',
  24: 'Pitch 90',
  25: 'Pitch 270',
  100: 'Custom 1',
  101: 'Custom 2'
}

export function formatConfirmationTime(confirmedAtMs: number | undefined): string {
  if (confirmedAtMs === undefined) {
    return 'Not confirmed'
  }

  return new Date(confirmedAtMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function formatSetupOutcome(outcome: SetupSectionOutcome): string {
  switch (outcome) {
    case 'complete':
      return 'Complete'
    case 'not-applicable':
      return 'Not applicable'
    case 'already-done':
      return 'Already done'
    case 'deferred':
      return 'Deferred'
    default:
      return 'Resolved'
  }
}

export function formatOrientationLabel(value: number | undefined): string {
  if (value === undefined) {
    return 'Unknown orientation'
  }

  return ORIENTATION_LABELS[value] ?? `Orientation ${value}`
}

export function formatDegrees(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(1)}°`
}

export function viewMonogram(viewId: AppViewId): string {
  switch (viewId) {
    case 'setup':
      return 'ST'
    case 'ports':
      return 'PR'
    case 'vtx':
      return 'VTX'
    case 'osd':
      return 'OSD'
    case 'receiver':
      return 'RX'
    case 'modes':
      return 'MOD'
    case 'motors':
      return 'MOT'
    case 'servos':
      return 'SRV'
    case 'power':
      return 'PWR'
    case 'failsafe':
      return 'FS'
    case 'logs':
      return 'LOG'
    case 'snapshots':
      return 'SNP'
    case 'tuning':
      return 'TUN'
    case 'presets':
      return 'PRE'
    case 'config':
      return 'CFG'
    case 'parameters':
      return 'PAR'
    case 'rc-mixer':
      return 'MIX'
    case 'can':
      return 'CAN'
    case 'flash':
      return 'FLS'
    case 'files':
      return 'FIL'
    default:
      return 'APP'
  }
}

export function missionTitleForView(viewId: AppViewId): string {
  switch (viewId) {
    case 'setup':
      return 'Setup'
    case 'ports':
      return 'Ports'
    case 'vtx':
      return 'Video Transmitter'
    case 'osd':
      return 'On-Screen Display'
    case 'receiver':
      return 'Receiver'
    case 'modes':
      return 'Modes'
    case 'motors':
      return 'Motors'
    case 'servos':
      return 'Servos'
    case 'power':
      return 'Power'
    case 'failsafe':
      return 'Failsafe'
    case 'logs':
      return 'Logs'
    case 'snapshots':
      return 'Snapshots'
    case 'tuning':
      return 'Tuning'
    case 'presets':
      return 'Presets'
    case 'config':
      return 'Configuration'
    case 'parameters':
      return 'Parameters'
    case 'rc-mixer':
      return 'RC Option Mixer'
    case 'can':
      return 'DroneCAN Bus'
    case 'flash':
      return 'Firmware Flash'
    case 'files':
      return 'File Browser'
    default:
      return 'Configurator'
  }
}
