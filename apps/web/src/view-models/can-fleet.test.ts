import { describe, expect, it } from 'vitest'
import type { DronecanInspectedNode } from '@arduconfig/ardupilot-core'

import { buildFleetParamOptions, buildFleetParamPlan, fleetFirmwareCandidates, fleetFirmwareCheck, fleetParamWrites } from './can-fleet'

const int = (n: number) => ({ tag: 'int64' as const, int64: String(n) })
function node(nodeId: number, params: Record<string, number>, hw?: [number, number]): DronecanInspectedNode {
  return {
    nodeId,
    health: 'ok',
    mode: 'operational',
    name: `n${nodeId}`,
    hwVersion: hw ? { major: hw[0], minor: hw[1] } : undefined,
    parameters: Object.entries(params).map(([name, value], index) => ({ index, name, value: int(value) })),
    paramFetch: { status: 'complete', nextIndex: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  } as unknown as DronecanInspectedNode
}

describe('fleet params', () => {
  const nodes = [node(10, { ESC_PWM_TYPE: 1, CAN_NODE: 10 }), node(11, { ESC_PWM_TYPE: 2, CAN_NODE: 11 }), node(12, { GPS_TYPE: 1, CAN_NODE: 12 })]
  it('lists names most-shared first, never the node ID', () => {
    const options = buildFleetParamOptions(nodes)
    expect(options[0]).toEqual({ name: 'ESC_PWM_TYPE', nodeIds: [10, 11] })
    expect(options.some((option) => option.name === 'CAN_NODE')).toBe(false)
  })
  it('plans a value per node: change, same, missing, invalid', () => {
    const plan = buildFleetParamPlan(nodes, [10, 11, 12], 'ESC_PWM_TYPE', '2')
    expect(plan.map((row) => row.state)).toEqual(['change', 'same', 'missing'])
    expect(plan[0]).toMatchObject({ currentLabel: '1', nextLabel: '2' })
    expect(buildFleetParamPlan(nodes, [10], 'ESC_PWM_TYPE', 'abc')[0].state).toBe('invalid')
    expect(fleetParamWrites(plan)).toEqual([{ nodeId: 10, value: int(2) }])
  })
})

describe('fleet firmware', () => {
  const nodes = [node(20, {}, [0x04, 0x10]), node(21, {}, [0x04, 0x10]), node(22, {}, [0x05, 0x00]), node(23, {}), node(1, {}, [0x04, 0x10])]
  it('candidates are identified nodes, not the autopilot', () => {
    expect(fleetFirmwareCandidates(nodes, [1]).map((n) => n.nodeId)).toEqual([20, 21, 22])
  })
  it('one image only to one board', () => {
    expect(fleetFirmwareCheck(nodes, [20, 21])).toEqual({ ok: true, boardId: 0x0410 })
    expect(fleetFirmwareCheck(nodes, [20, 22])).toMatchObject({ ok: false })
    expect(fleetFirmwareCheck(nodes, [23])).toMatchObject({ ok: false })
    expect(fleetFirmwareCheck(nodes, [])).toMatchObject({ ok: false })
  })
})
