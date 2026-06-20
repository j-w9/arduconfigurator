import type { ServoOutputAssignment, VehicleIdentity } from '@arduconfig/ardupilot-core'

// Per-vehicle output summary. ArduCopter has the motor-matrix + guided
// direction-test workflow; Plane / Rover / Sub don't fit that shape, so
// instead of a bare "not a multirotor matrix" note this groups their
// configured outputs by role (primary flight controls vs secondary vs
// other) using the already-classified SERVOn_FUNCTION assignments.
//
// Read-only review only — powered output movement tests (control-surface
// sweeps, steering/throttle, thrusters) are a guarded follow-up, the same
// way the multirotor motor test is heavily gated.

export interface VehicleOutputGroup {
  id: string
  label: string
  outputs: ServoOutputAssignment[]
}

export interface VehicleOutputSummary {
  /** Vehicle-appropriate heading, e.g. "Fixed-wing outputs". */
  title: string
  /** Short orientation line under the heading. */
  description: string
  groups: VehicleOutputGroup[]
  /** Configured (non-unused) output count, for the header badge. */
  configuredCount: number
}

// SERVOn_FUNCTION codes grouped by role, per vehicle. These are the
// universal output-function numbers (same enum across all firmwares).
const PLANE_PRIMARY = new Set([4, 19, 21, 70, 73, 74]) // aileron, elevator, rudder, throttle, throttle L/R
const PLANE_SECONDARY = new Set([2, 3, 16, 17, 24, 25, 77, 78, 79, 80, 86, 87]) // flap/flaperon/elevon/vtail/spoiler
const ROVER_PRIMARY = new Set([26, 70, 73, 74]) // ground steering, throttle, throttle L/R
const SUB_PRIMARY = new Set([33, 34, 35, 36, 37, 38, 39, 40]) // thrusters (motor 1-8)

function groupBy(
  outputs: ServoOutputAssignment[],
  primary: Set<number>,
  secondary: Set<number>,
  primaryLabel: string,
  secondaryLabel: string
): VehicleOutputGroup[] {
  const configured = outputs.filter((output) => output.kind !== 'unused')
  const primaryOutputs = configured.filter((output) => primary.has(output.functionValue))
  const secondaryOutputs = configured.filter(
    (output) => !primary.has(output.functionValue) && secondary.has(output.functionValue)
  )
  const otherOutputs = configured.filter(
    (output) => !primary.has(output.functionValue) && !secondary.has(output.functionValue)
  )
  const groups: VehicleOutputGroup[] = []
  if (primaryOutputs.length > 0) groups.push({ id: 'primary', label: primaryLabel, outputs: primaryOutputs })
  if (secondaryOutputs.length > 0) groups.push({ id: 'secondary', label: secondaryLabel, outputs: secondaryOutputs })
  if (otherOutputs.length > 0) groups.push({ id: 'other', label: 'Other outputs', outputs: otherOutputs })
  return groups
}

export function buildVehicleOutputSummary(
  vehicle: VehicleIdentity['vehicle'] | undefined,
  outputs: readonly ServoOutputAssignment[]
): VehicleOutputSummary {
  const all = [...outputs]
  const configuredCount = all.filter((output) => output.kind !== 'unused').length

  switch (vehicle) {
    case 'ArduPlane':
      return {
        title: 'Fixed-wing / QuadPlane outputs',
        description: 'Control-surface and throttle assignments read from SERVOn_FUNCTION. Edit them in the Servos tab.',
        groups: groupBy(all, PLANE_PRIMARY, PLANE_SECONDARY, 'Primary flight controls', 'Secondary surfaces'),
        configuredCount
      }
    case 'ArduRover':
      return {
        title: 'Rover outputs',
        description: 'Steering and throttle assignments read from SERVOn_FUNCTION. Edit them in the Servos tab.',
        groups: groupBy(all, ROVER_PRIMARY, new Set<number>(), 'Steering & throttle', ''),
        configuredCount
      }
    case 'ArduSub':
      return {
        title: 'Sub outputs',
        description: 'Thruster and accessory assignments read from SERVOn_FUNCTION. Edit them in the Servos tab.',
        groups: groupBy(all, SUB_PRIMARY, new Set<number>(), 'Thrusters', ''),
        configuredCount
      }
    default:
      // Should not be reached (Copter uses the motor matrix), but keep a
      // sensible generic grouping rather than throwing.
      return {
        title: 'Vehicle outputs',
        description: 'Output assignments read from SERVOn_FUNCTION. Edit them in the Servos tab.',
        groups: groupBy(all, new Set<number>(), new Set<number>(), 'Outputs', ''),
        configuredCount
      }
  }
}
