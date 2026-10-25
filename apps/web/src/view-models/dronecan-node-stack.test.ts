import { describe, expect, it } from 'vitest'

import { dronecanNodeStack, dronecanNodeStackLabel } from './dronecan-node-stack'

const node = (name: string | undefined, params: string[]) => ({ name, parameters: params.map((n) => ({ name: n })) })

describe('dronecanNodeStack', () => {
  it('reads PX4 from the CANNODE_* params a PX4 cannode build exposes', () => {
    expect(dronecanNodeStack(node('com.vendor.gps', ['CANNODE_NODE_ID', 'GPS_UBX_DYNMODEL']))).toBe('px4')
  })
  it('reads AP_Periph from CAN_NODE / FORMAT_VERSION', () => {
    expect(dronecanNodeStack(node('com.hex.here3', ['CAN_NODE', 'GPS_TYPE']))).toBe('ap_periph')
    expect(dronecanNodeStack(node(undefined, ['FORMAT_VERSION']))).toBe('ap_periph')
  })
  it('params win over the name', () => {
    expect(dronecanNodeStack(node('org.ardupilot.ap_periph', ['CANNODE_BITRATE']))).toBe('px4')
  })
  it('falls back to the node name before any parameter is read', () => {
    expect(dronecanNodeStack(node('org.ark.can-rtk-gps', []))).toBe('px4')
    expect(dronecanNodeStack(node('com.cuav.can-gps-v1', []), ['com.cuav.can-gps-v1'])).toBe('px4')
    expect(dronecanNodeStack(node('org.ardupilot.MatekL431', []))).toBe('ap_periph')
    expect(dronecanNodeStack(node('com.hex.here3', []))).toBe('unknown')
    expect(dronecanNodeStack(node(undefined, []))).toBe('unknown')
  })
  it('labels', () => {
    expect(dronecanNodeStackLabel('px4')).toBe('PX4 cannode')
    expect(dronecanNodeStackLabel('ap_periph')).toBe('AP_Periph')
    expect(dronecanNodeStackLabel('unknown')).toBe('—')
  })
})
