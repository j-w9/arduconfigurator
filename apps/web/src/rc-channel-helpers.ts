// RC-channel display helpers, extracted from App.tsx as part of its
// decomposition. Pure functions that build the per-channel display rows the
// Receiver tab renders from the live RC snapshot + RCn_* parameters.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { readParameterValue, readRoundedParameter } from './selectors/parameter-read'

export interface RcChannelDisplay {
  channelNumber: number
  role: string
  pwm: number | undefined
  fillPercent: number
  trimPercent: number
  isModeChannel: boolean
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// Which input channel drives each control axis. ArduPilot lets the operator
// remap these via RCMAP_* (defaults: roll=1, pitch=2, throttle=3, yaw=4), so the
// role labels must follow the params — not a hardcoded 1-4 — or a remapped TX
// shows the wrong roles on every channel.
const AXIS_RCMAP: ReadonlyArray<{ param: string; defaultChannel: number; role: string }> = [
  { param: 'RCMAP_ROLL', defaultChannel: 1, role: 'Roll' },
  { param: 'RCMAP_PITCH', defaultChannel: 2, role: 'Pitch' },
  { param: 'RCMAP_THROTTLE', defaultChannel: 3, role: 'Throttle' },
  { param: 'RCMAP_YAW', defaultChannel: 4, role: 'Yaw' }
]

export function buildRcmapRoleByChannel(snapshot: ConfiguratorSnapshot): Map<number, string> {
  const roleByChannel = new Map<number, string>()
  for (const axis of AXIS_RCMAP) {
    const channel = readRoundedParameter(snapshot, axis.param) ?? axis.defaultChannel
    if (channel >= 1 && channel <= 16) {
      roleByChannel.set(channel, axis.role)
    }
  }
  return roleByChannel
}

export function deriveAssignedRcOptionChannels(snapshot: ConfiguratorSnapshot): Map<number, string> {
  const assignedChannels = new Map<number, string>()

  for (let channelNumber = 5; channelNumber <= 16; channelNumber += 1) {
    const optionValue = readRoundedParameter(snapshot, `RC${channelNumber}_OPTION`)
    if (optionValue === undefined || optionValue === 0) {
      continue
    }

    const label =
      optionValue === 153
        ? 'Arm / Disarm'
        : optionValue === 154
          ? 'Arm / Disarm + AirMode'
          : 'Assigned switch'

    assignedChannels.set(channelNumber, label)
  }

  return assignedChannels
}

export function getModeChannelNumber(snapshot: ConfiguratorSnapshot): number | undefined {
  const configuredChannel = readRoundedParameter(snapshot, 'FLTMODE_CH') ?? readRoundedParameter(snapshot, 'MODE_CH') ?? 5
  return configuredChannel >= 1 && configuredChannel <= 16 ? configuredChannel : undefined
}

export function buildRcChannelDisplays(snapshot: ConfiguratorSnapshot, visibleCount = 8): RcChannelDisplay[] {
  const modeChannelNumber = getModeChannelNumber(snapshot)
  const assignedRcOptionChannels = deriveAssignedRcOptionChannels(snapshot)
  const rcmapRoleByChannel = buildRcmapRoleByChannel(snapshot)
  const highestAssignedChannel = Math.max(0, ...assignedRcOptionChannels.keys())
  const channelCount = Math.max(visibleCount, snapshot.liveVerification.rcInput.channelCount, modeChannelNumber ?? 0, highestAssignedChannel)

  // Aux channels are numbered sequentially among the leftovers (not by raw
  // channel number) so the labels stay sensible even when an axis is remapped
  // off the usual 1-4. Array.from's map callback runs in channel order.
  let auxIndex = 0

  return Array.from({ length: channelCount }, (_, index) => {
    const channelNumber = index + 1
    const pwm = snapshot.liveVerification.rcInput.channels[index]
    const minimum = readParameterValue(snapshot, `RC${channelNumber}_MIN`) ?? 1000
    const maximum = readParameterValue(snapshot, `RC${channelNumber}_MAX`) ?? 2000
    const trim = readParameterValue(snapshot, `RC${channelNumber}_TRIM`) ?? 1500
    const range = Math.max(maximum - minimum, 1)
    const hasLivePwm = typeof pwm === 'number' && pwm !== 0xffff

    let role: string
    if (modeChannelNumber === channelNumber) {
      role = 'Mode switch'
    } else if (rcmapRoleByChannel.has(channelNumber)) {
      role = rcmapRoleByChannel.get(channelNumber) as string
    } else if (assignedRcOptionChannels.has(channelNumber)) {
      role = assignedRcOptionChannels.get(channelNumber) as string
    } else {
      auxIndex += 1
      role = `Aux ${auxIndex}`
    }

    return {
      channelNumber,
      role,
      pwm: hasLivePwm ? pwm : undefined,
      fillPercent: hasLivePwm ? clamp01((pwm - minimum) / range) * 100 : 0,
      trimPercent: clamp01((trim - minimum) / range) * 100,
      isModeChannel: modeChannelNumber === channelNumber
    }
  })
}
