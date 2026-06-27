import { describe, expect, it } from 'vitest'

import type { ServoOutputAssignment } from '@arduconfig/ardupilot-core'

import { buildPlaneControlSurfaces } from './plane-control-surfaces'

const a = (channelNumber: number, functionValue: number): ServoOutputAssignment => ({
  channelNumber,
  paramId: `SERVO${channelNumber}_FUNCTION`,
  functionValue,
  functionLabel: '',
  kind: 'control-surface'
})

describe('buildPlaneControlSurfaces', () => {
  it('lists mapped surfaces with channel + reversal, omits fully-unmapped ones', () => {
    const summary = buildPlaneControlSurfaces([a(1, 4), a(2, 19), a(3, 21), a(4, 70)], (ch) => ch === 2)
    expect(summary.surfaces.map((s) => s.key)).toEqual(['aileron', 'elevator', 'rudder', 'throttle'])
    expect(summary.mappedCount).toBe(4)
    expect(summary.surfaces.find((s) => s.key === 'elevator')?.channels).toEqual([
      { channelNumber: 2, reversed: true, side: undefined }
    ])
    // Unmapped surfaces (elevon, v-tail, …) are not listed.
    expect(summary.surfaces.some((s) => s.key === 'elevon')).toBe(false)
  })

  it('flags a paired surface with only one side mapped as incomplete', () => {
    const summary = buildPlaneControlSurfaces([a(1, 77)], () => false) // elevon left only
    const elevon = summary.surfaces.find((s) => s.key === 'elevon')
    expect(elevon?.status).toBe('incomplete')
    expect(elevon?.note).toBe('Right side not mapped')
    expect(summary.incompleteCount).toBe(1)
    expect(summary.mappedCount).toBe(0)
  })

  it('marks a complete L/R pair as mapped, ordered by channel', () => {
    const summary = buildPlaneControlSurfaces([a(5, 78), a(2, 77)], () => false)
    const elevon = summary.surfaces.find((s) => s.key === 'elevon')
    expect(elevon?.status).toBe('mapped')
    expect(elevon?.channels.map((c) => [c.channelNumber, c.side])).toEqual([
      [2, 'Left'],
      [5, 'Right']
    ])
  })

  it('treats dual throttle as sided but not a required pair', () => {
    const summary = buildPlaneControlSurfaces([a(1, 73)], () => false) // throttle left only
    const throttle = summary.surfaces.find((s) => s.key === 'throttle')
    expect(throttle?.status).toBe('mapped') // throttle is not `paired`
    expect(throttle?.channels[0]?.side).toBe('Left')
  })

  it('is empty for a craft with no control surfaces mapped', () => {
    expect(buildPlaneControlSurfaces([], () => false).surfaces).toEqual([])
  })
})
