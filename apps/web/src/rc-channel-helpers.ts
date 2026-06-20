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

export function channelRole(channelNumber: number, modeChannelNumber: number | undefined): string {
  if (modeChannelNumber === channelNumber) {
    return 'Mode switch'
  }

  switch (channelNumber) {
    case 1:
      return 'Roll'
    case 2:
      return 'Pitch'
    case 3:
      return 'Throttle'
    case 4:
      return 'Yaw'
    default:
      return `Aux ${channelNumber - 4}`
  }
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
  const highestAssignedChannel = Math.max(0, ...assignedRcOptionChannels.keys())
  const channelCount = Math.max(visibleCount, snapshot.liveVerification.rcInput.channelCount, modeChannelNumber ?? 0, highestAssignedChannel)

  return Array.from({ length: channelCount }, (_, index) => {
    const channelNumber = index + 1
    const pwm = snapshot.liveVerification.rcInput.channels[index]
    const minimum = readParameterValue(snapshot, `RC${channelNumber}_MIN`) ?? 1000
    const maximum = readParameterValue(snapshot, `RC${channelNumber}_MAX`) ?? 2000
    const trim = readParameterValue(snapshot, `RC${channelNumber}_TRIM`) ?? 1500
    const range = Math.max(maximum - minimum, 1)
    const hasLivePwm = typeof pwm === 'number' && pwm !== 0xffff

    return {
      channelNumber,
      role: modeChannelNumber === channelNumber ? 'Mode switch' : assignedRcOptionChannels.get(channelNumber) ?? channelRole(channelNumber, modeChannelNumber),
      pwm: hasLivePwm ? pwm : undefined,
      fillPercent: hasLivePwm ? clamp01((pwm - minimum) / range) * 100 : 0,
      trimPercent: clamp01((trim - minimum) / range) * 100,
      isModeChannel: modeChannelNumber === channelNumber
    }
  })
}
