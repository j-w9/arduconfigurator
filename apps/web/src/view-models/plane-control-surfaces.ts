// View-model for the ArduPlane "Control surfaces" output card. The generic
// vehicle-output-summary groups SERVOn_FUNCTION assignments into Primary /
// Secondary, but it doesn't surface the two things a fixed-wing operator most
// wants to verify before flight: per-surface reversal, and whether paired
// surfaces (elevons, V-tails, flaperons, differential spoilers, dual throttle)
// have BOTH sides mapped. This builds that explicit, pre-flight-checkable view.
//
// Pure + unit-tested; the section renders straight from this.

import type { ServoOutputAssignment } from '@arduconfig/ardupilot-core'

export type SurfaceStatus = 'mapped' | 'incomplete'

export interface PlaneSurfaceChannel {
  channelNumber: number
  reversed: boolean
  side?: 'Left' | 'Right'
}

export interface PlaneControlSurface {
  key: string
  label: string
  channels: PlaneSurfaceChannel[]
  status: SurfaceStatus
  /** Pairing problem, e.g. "Right side not mapped". */
  note?: string
}

export interface PlaneControlSurfaceSummary {
  /** Mapped + incomplete surfaces (fully-unmapped surfaces are omitted). */
  surfaces: PlaneControlSurface[]
  mappedCount: number
  incompleteCount: number
}

interface SurfaceMember {
  code: number
  side?: 'Left' | 'Right'
}

interface SurfaceSpec {
  key: string
  label: string
  members: SurfaceMember[]
  /** Surface needs a Left + Right pair to be complete. */
  paired?: boolean
}

// SERVOn_FUNCTION codes per fixed-wing control surface (verified against
// ArduPilot SRV_Channel.h Aux_servo_function_t).
const SURFACE_SPECS: readonly SurfaceSpec[] = [
  { key: 'aileron', label: 'Aileron', members: [{ code: 4 }] },
  { key: 'elevator', label: 'Elevator', members: [{ code: 19 }] },
  { key: 'rudder', label: 'Rudder', members: [{ code: 21 }] },
  {
    key: 'throttle',
    label: 'Throttle',
    members: [{ code: 70 }, { code: 73, side: 'Left' }, { code: 74, side: 'Right' }]
  },
  {
    key: 'elevon',
    label: 'Elevon',
    members: [{ code: 77, side: 'Left' }, { code: 78, side: 'Right' }],
    paired: true
  },
  {
    key: 'vtail',
    label: 'V-Tail',
    members: [{ code: 79, side: 'Left' }, { code: 80, side: 'Right' }],
    paired: true
  },
  {
    key: 'flaperon',
    label: 'Flaperon',
    members: [{ code: 24, side: 'Left' }, { code: 25, side: 'Right' }],
    paired: true
  },
  { key: 'flap', label: 'Flap', members: [{ code: 2 }, { code: 3 }] },
  {
    key: 'dspoiler',
    label: 'Differential Spoiler',
    members: [
      { code: 16, side: 'Left' },
      { code: 86, side: 'Left' },
      { code: 17, side: 'Right' },
      { code: 87, side: 'Right' }
    ],
    paired: true
  },
  { key: 'airbrake', label: 'Airbrake', members: [{ code: 110 }] }
]

export function buildPlaneControlSurfaces(
  assignments: readonly ServoOutputAssignment[],
  isReversed: (channelNumber: number) => boolean
): PlaneControlSurfaceSummary {
  const surfaces: PlaneControlSurface[] = []

  for (const spec of SURFACE_SPECS) {
    const sideByCode = new Map(spec.members.map((member) => [member.code, member.side]))
    const channels: PlaneSurfaceChannel[] = assignments
      .filter((assignment) => sideByCode.has(assignment.functionValue))
      .map((assignment) => ({
        channelNumber: assignment.channelNumber,
        reversed: isReversed(assignment.channelNumber),
        side: sideByCode.get(assignment.functionValue)
      }))
      .sort((a, b) => a.channelNumber - b.channelNumber)

    if (channels.length === 0) {
      continue
    }

    let status: SurfaceStatus = 'mapped'
    let note: string | undefined
    if (spec.paired) {
      const haveLeft = channels.some((channel) => channel.side === 'Left')
      const haveRight = channels.some((channel) => channel.side === 'Right')
      if (!haveLeft || !haveRight) {
        status = 'incomplete'
        note = haveLeft ? 'Right side not mapped' : 'Left side not mapped'
      }
    }

    surfaces.push({ key: spec.key, label: spec.label, channels, status, note })
  }

  return {
    surfaces,
    mappedCount: surfaces.filter((surface) => surface.status === 'mapped').length,
    incompleteCount: surfaces.filter((surface) => surface.status === 'incomplete').length
  }
}
