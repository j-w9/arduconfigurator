import { describe, expect, it } from 'vitest'

import {
  apjBuildMismatch,
  autoSelectTarget,
  firmwareBuildKey,
  defaultFinderVehicle,
  findFirmwareTargets,
  isRunningTarget,
  parseFirmwareIndex,
  targetWarning,
  type FirmwareIndexRow
} from './firmware-finder'

const columns = ['platform', 'boardId', 'vehicle', 'mavType', 'channel', 'version', 'brand', 'manufacturer', 'path']
const row = (platform: string, boardId: number, mavType = 'Copter', channel = 'OFFICIAL', vehicle = 'Copter') => [
  platform,
  boardId,
  vehicle,
  mavType,
  channel,
  'V4.7.1',
  platform.startsWith('Matek') ? 'Matek H743' : '',
  platform.startsWith('Matek') ? 'Matek' : 'CubePilot',
  `${vehicle}/stable/${platform}/arducopter.apj`
]

const rows: FirmwareIndexRow[] = parseFirmwareIndex({
  format: 1,
  columns,
  rows: [
    row('MatekH743', 1013),
    row('MatekH743', 1013, 'HELICOPTER'),
    row('MatekH743-bdshot', 1013),
    row('MatekH743', 1013, 'Copter', 'BETA'),
    row('CubeOrange', 140),
    row('CubeOrange-bdshot', 140),
    row('CubeOrangePlus', 1063),
    row('MatekF405', 125),
    row('MatekH743', 1013, 'FIXED_WING', 'OFFICIAL', 'Plane')
  ]
})

describe('the firmware index', () => {
  it('reads the deploy-built index and refuses anything else', () => {
    expect(rows).toHaveLength(9)
    expect(rows[0]).toMatchObject({ platform: 'MatekH743', boardId: 1013, channel: 'OFFICIAL', path: 'Copter/stable/MatekH743/arducopter.apj' })
    expect(() => parseFirmwareIndex({ format: 2 })).toThrow()
    expect(() => parseFirmwareIndex('<!doctype html>')).toThrow()
  })
})

describe('finding targets', () => {
  it('searches names, brands and board ids, one row per target, heli and other vehicles apart', () => {
    const matek = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: 'matekh7' })
    expect(matek.map((target) => target.platform)).toEqual(['MatekH743', 'MatekH743-bdshot'])
    expect(findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '140' }).map((t) => t.platform)).toEqual([
      'CubeOrange',
      'CubeOrange-bdshot'
    ])
    expect(findFirmwareTargets(rows, { vehicle: 'Heli', channel: 'OFFICIAL', query: 'matek' })).toHaveLength(1)
    expect(findFirmwareTargets(rows, { vehicle: 'Plane', channel: 'OFFICIAL', query: 'matek' })).toHaveLength(1)
    expect(findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'BETA', query: 'matek' })).toHaveLength(1)
  })

  it('connected: no query lists the board\'s variants, the running build first and pre-selected', () => {
    const board = { boardId: 1013, boardName: 'MatekH743-bdshot' }
    const targets = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '', board })
    expect(targets.slice(0, 2).map((target) => [target.platform, target.running, target.sameBoard])).toEqual([
      ['MatekH743-bdshot', true, true],
      ['MatekH743', false, true]
    ])
    expect(autoSelectTarget(targets)?.platform).toBe('MatekH743-bdshot')
    // Not connected and nothing typed: every board, for the dropdown, nothing picked.
    const all = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '' })
    expect(all.map((target) => target.platform)).toEqual(['CubeOrange', 'CubeOrange-bdshot', 'CubeOrangePlus', 'MatekF405', 'MatekH743', 'MatekH743-bdshot'])
    expect(autoSelectTarget(all)).toBeUndefined()
  })

  it('without the banner name, one variant is pre-selected; several are left to the operator', () => {
    const one = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '', board: { boardId: 1063 } })
    expect(autoSelectTarget(one)?.platform).toBe('CubeOrangePlus')
    const two = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '', board: { boardId: 140 } })
    expect(autoSelectTarget(two)).toBeUndefined()
  })

  it('matches a banner name ArduPilot cut at 23 characters', () => {
    expect(isRunningTarget('SomeVeryLongBoardName-bdshot', 'SomeVeryLongBoardName-b')).toBe(true)
    expect(isRunningTarget('MatekH743-bdshot', 'MatekH743')).toBe(false)
  })
})

describe('warnings', () => {
  it('says when a pick is another board, or another variant of this one', () => {
    const board = { boardId: 1013, boardName: 'MatekH743-bdshot' }
    const [running, other] = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: '', board })
    expect(targetWarning(running, board)).toBeUndefined()
    expect(targetWarning(other, board)).toMatch(/different variant/)
    const cube = findFirmwareTargets(rows, { vehicle: 'Copter', channel: 'OFFICIAL', query: 'cubeorange-bdshot', board })[0]
    expect(targetWarning(cube, board)).toMatch(/will refuse it/)
    expect(defaultFinderVehicle('ArduPlane')).toBe('Plane')
    expect(defaultFinderVehicle(undefined)).toBe('Copter')
  })
})

describe('the downloaded build', () => {
  it('reads the listed commit when the index has one, and checks the file against it', () => {
    const withSha = parseFirmwareIndex({ format: 1, columns: [...columns, 'gitSha'], rows: [[...row('MatekH743', 1013), 'dbe792162d06cab66c3475fd5556bf7a120f119e']] })
    expect(withSha[0].gitSha).toBe('dbe792162d06cab66c3475fd5556bf7a120f119e')
    expect(rows[0].gitSha).toBe('') // an index from before the column
    const apj = (identity: string) => JSON.stringify({ board_id: 1013, git_identity: identity, image: '' })
    expect(apjBuildMismatch(apj('dbe79216'), withSha[0].gitSha)).toBeUndefined()
    expect(apjBuildMismatch(apj('0a1b2c3d'), withSha[0].gitSha)).toMatch(/sent build 0a1b2c3d, not the listed dbe79216/)
    expect(apjBuildMismatch(apj('0a1b2c3d'), '')).toBeUndefined()
    expect(apjBuildMismatch('<!doctype html>', 'dbe79216')).toMatch(/not an \.apj/)
    expect(firmwareBuildKey({ path: 'a/b.apj', gitSha: 'x' })).not.toBe(firmwareBuildKey({ path: 'a/b.apj', gitSha: 'y' }))
  })
})
