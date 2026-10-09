import { describe, expect, it } from 'vitest'

import { periphPickerOptions, periphPreselect, periphTargetFromName, type PeriphBuild } from './dronecan-firmware-picker'

const build = (platform: string, boardId: number, releaseLabel = 'Stable'): PeriphBuild => ({
  url: `https://firmware.ardupilot.org/AP_Periph/stable/${platform}/AP_Periph.apj`,
  platform,
  boardId,
  versionLabel: '1.9.0',
  releaseLabel
})
const builds = [
  build('MatekL431-GPS', 1062),
  build('MatekL431-Rangefinder', 1062),
  build('ARK_CANNODE', 1156),
  build('f303-M10070', 1048),
  build('MatekL431-GPS', 1062, 'Beta')
]

describe('the node firmware picker', () => {
  it('reads the build target from an AP_Periph node name', () => {
    expect(periphTargetFromName('org.ardupilot.MatekL431-GPS')).toBe('MatekL431-GPS')
    expect(periphTargetFromName('org.ardupilot.ARK_CANNODE(12)')).toBe('ARK_CANNODE')
    expect(periphTargetFromName('io.mrobotics.m10070_loc1')).toBeUndefined()
  })

  it('lists every build of the channel, the node\'s own first, and pre-selects a name match over the board-id ones', () => {
    const options = periphPickerOptions(builds, { channel: 'Stable', query: '', node: { name: 'org.ardupilot.MatekL431-GPS', boardId: 1062 } })
    expect(options.map((option) => [option.platform, option.match])).toEqual([
      ['MatekL431-GPS', 'name'],
      ['MatekL431-Rangefinder', 'board'],
      ['ARK_CANNODE', undefined],
      ['f303-M10070', undefined]
    ])
    expect(periphPreselect(options)?.platform).toBe('MatekL431-GPS')
  })

  it('a board id shared by several builds pre-selects nothing; an unknown node can search', () => {
    const shared = periphPickerOptions(builds, { channel: 'Stable', query: '', node: { name: 'io.vendor.thing', boardId: 1062 } })
    expect(periphPreselect(shared)).toBeUndefined()
    const unknown = periphPickerOptions(builds, { channel: 'Stable', query: 'ark', node: { name: 'io.mrobotics.m10070_loc1' } })
    expect(unknown.map((option) => option.platform)).toEqual(['ARK_CANNODE'])
    expect(periphPickerOptions(builds, { channel: 'Beta', query: '', node: {} })).toHaveLength(1)
  })
})
