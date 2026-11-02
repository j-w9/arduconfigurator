import { describe, expect, it } from 'vitest'

import { flattenGenericMessage } from './use-mavlink-inspector'

describe('generically decoded messages in the inspector', () => {
  it('are named by their message, a field called type kept beside it', () => {
    expect(flattenGenericMessage({ type: 'GENERIC', name: 'BATTERY_STATUS', messageId: 147, fields: { id: 0, type: 1, current_battery: 120 } })).toEqual({
      id: 0,
      current_battery: 120,
      'type (field)': 1,
      type: 'BATTERY_STATUS'
    })
    expect(flattenGenericMessage({ type: 'GENERIC', name: 'VFR_HUD', messageId: 74, fields: { groundspeed: 3 } })).toEqual({ groundspeed: 3, type: 'VFR_HUD' })
  })
})
