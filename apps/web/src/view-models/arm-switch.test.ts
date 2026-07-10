import { describe, expect, it } from 'vitest'

import {
  ARM_SWITCH_AIRMODE_OPTION_VALUE,
  ARM_SWITCH_OPTION_VALUE,
  armSwitchAssignmentDrafts,
  armSwitchChannelOptions,
  deriveArmSwitchAssignment
} from './arm-switch'

function snapshotWith(params: Record<string, number>): any {
  return {
    parameters: Object.entries(params).map(([id, value]) => ({ id, value, definition: undefined }))
  }
}

describe('deriveArmSwitchAssignment', () => {
  it('reports no assignment when nothing is set', () => {
    expect(deriveArmSwitchAssignment(snapshotWith({}), {})).toEqual({ channel: undefined, airmode: false })
  })

  it('finds a plain Arm/Disarm assignment from the live snapshot', () => {
    const snapshot = snapshotWith({ RC7_OPTION: ARM_SWITCH_OPTION_VALUE })
    expect(deriveArmSwitchAssignment(snapshot, {})).toEqual({ channel: 7, airmode: false })
  })

  it('finds the AirMode variant', () => {
    const snapshot = snapshotWith({ RC9_OPTION: ARM_SWITCH_AIRMODE_OPTION_VALUE })
    expect(deriveArmSwitchAssignment(snapshot, {})).toEqual({ channel: 9, airmode: true })
  })

  it('prefers a staged edit over the live value', () => {
    const snapshot = snapshotWith({ RC6_OPTION: 0 })
    const edited = { RC6_OPTION: String(ARM_SWITCH_OPTION_VALUE) }
    expect(deriveArmSwitchAssignment(snapshot, edited)).toEqual({ channel: 6, airmode: false })
  })

  it('ignores channels outside the 5..16 AUX range', () => {
    const snapshot = snapshotWith({ RC1_OPTION: ARM_SWITCH_OPTION_VALUE })
    expect(deriveArmSwitchAssignment(snapshot, {})).toEqual({ channel: undefined, airmode: false })
  })
})

describe('armSwitchAssignmentDrafts', () => {
  it('assigns a fresh channel with no prior assignment', () => {
    const drafts = armSwitchAssignmentDrafts({ channel: undefined, airmode: false }, 8, false)
    expect(drafts).toEqual({ RC8_OPTION: String(ARM_SWITCH_OPTION_VALUE) })
  })

  it('writes the AirMode variant when requested', () => {
    const drafts = armSwitchAssignmentDrafts({ channel: undefined, airmode: false }, 8, true)
    expect(drafts).toEqual({ RC8_OPTION: String(ARM_SWITCH_AIRMODE_OPTION_VALUE) })
  })

  it('clears the previous channel when moving to a new one', () => {
    const drafts = armSwitchAssignmentDrafts({ channel: 6, airmode: false }, 10, false)
    expect(drafts).toEqual({ RC6_OPTION: '0', RC10_OPTION: String(ARM_SWITCH_OPTION_VALUE) })
  })

  it('clears the current channel when the target is undefined ("None")', () => {
    const drafts = armSwitchAssignmentDrafts({ channel: 6, airmode: false }, undefined, false)
    expect(drafts).toEqual({ RC6_OPTION: '0' })
  })

  it('toggling airmode on the SAME channel only rewrites that channel', () => {
    const drafts = armSwitchAssignmentDrafts({ channel: 6, airmode: false }, 6, true)
    expect(drafts).toEqual({ RC6_OPTION: String(ARM_SWITCH_AIRMODE_OPTION_VALUE) })
  })
})

describe('armSwitchChannelOptions', () => {
  it('starts with "None" followed by every AUX channel 5..16', () => {
    const options = armSwitchChannelOptions()
    expect(options[0]).toEqual({ value: 0, label: 'None' })
    expect(options).toHaveLength(1 + (16 - 5 + 1))
    expect(options[1]).toEqual({ value: 5, label: 'Channel 5' })
    expect(options[options.length - 1]).toEqual({ value: 16, label: 'Channel 16' })
  })
})
