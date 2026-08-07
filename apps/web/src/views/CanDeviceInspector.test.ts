import { describe, expect, it } from 'vitest'

import { canLookUpFirmwareOnline } from './CanDeviceInspector'

// A DroneCAN node shows up in the device list the moment its first NodeStatus
// broadcast arrives — seconds before its GetNodeInfo answer on a busy bus. The
// online firmware lookup is matched purely on the APJ board id reconstructed
// from that answer's hardware_version, so offering it in that gap can only
// produce "this node hasn't reported its hardware version yet". This gate keeps
// the affordance closed until the identity is genuinely in hand; it guards a
// path that ends in flashing a peripheral, so it stays covered off the DOM.
describe('canLookUpFirmwareOnline', () => {
  it('stays closed until the node has answered GetNodeInfo', () => {
    expect(canLookUpFirmwareOnline({ hwVersion: undefined })).toBe(false)
  })

  it('opens once a hardware version is in hand', () => {
    expect(canLookUpFirmwareOnline({ hwVersion: { major: 2, minor: 1 } })).toBe(true)
  })

  it('treats a zero hardware version as reported (board id 0 is still an answer)', () => {
    expect(canLookUpFirmwareOnline({ hwVersion: { major: 0, minor: 0 } })).toBe(true)
  })
})
