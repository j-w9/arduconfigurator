/**
 * Flying the simulated vehicle.
 *
 * Several steps of AMC's sequence cannot be reached on the ground — autotune,
 * notch-filter logging, in-flight magnetometer fit — and the live map has
 * nothing to draw until something moves. Both need a vehicle that flies, and
 * the simulator is the only one this app is willing to command.
 */

export interface FlightMode {
  /** ArduPilot's own mode number, as HEARTBEAT.custom_mode carries it. */
  value: number
  label: string
}

/**
 * The modes worth offering, per vehicle.
 *
 * Deliberately a short list rather than every mode the firmware has: this is
 * for getting a simulated vehicle airborne and back, not for flying a mission.
 * The numbers are ArduPilot's, from Copter's `Mode::Number` and Plane's
 * `Mode::Number` — they do NOT agree between vehicles, which is exactly why
 * this is keyed by vehicle rather than shared.
 */
export const FLIGHT_MODES: Readonly<Record<string, readonly FlightMode[]>> = {
  copter: [
    { value: 0, label: 'Stabilize' },
    { value: 2, label: 'Alt hold' },
    { value: 4, label: 'Guided' },
    { value: 5, label: 'Loiter' },
    // Flies a circle on its own, which is the simplest way to make a
    // simulated vehicle go somewhere -- and the only way to see whether the
    // live map keeps up with one.
    { value: 7, label: 'Circle' },
    { value: 6, label: 'RTL' },
    { value: 9, label: 'Land' }
  ],
  plane: [
    { value: 0, label: 'Manual' },
    { value: 2, label: 'Stabilize' },
    { value: 5, label: 'FBWA' },
    { value: 11, label: 'RTL' },
    { value: 12, label: 'Loiter' },
    { value: 15, label: 'Guided' }
  ],
  // A traditional helicopter IS ArduCopter -- same firmware, same mode
  // numbers, built under a second program name. Listed separately all the
  // same, because nothing here should assume two vehicles agree.
  heli: [
    { value: 0, label: 'Stabilize' },
    { value: 2, label: 'Alt hold' },
    { value: 4, label: 'Guided' },
    { value: 5, label: 'Loiter' },
    { value: 7, label: 'Circle' },
    { value: 6, label: 'RTL' },
    { value: 9, label: 'Land' }
  ],
  rover: [
    { value: 0, label: 'Manual' },
    { value: 3, label: 'Steering' },
    { value: 4, label: 'Hold' },
    { value: 10, label: 'Auto' },
    { value: 11, label: 'RTL' },
    { value: 15, label: 'Guided' }
  ]
}

/** GUIDED, which a takeoff has to be flown from. */
export const GUIDED_MODE: Readonly<Record<string, number>> = { copter: 4, plane: 15, heli: 4, rover: 15 }

/**
 * The way back: Land where there is one, RTL otherwise.
 *
 * A rover has no "down" to go to, so Hold is the nearest thing -- it stops.
 */
export const DESCEND_MODE: Readonly<Record<string, number>> = {
  copter: 9,
  plane: 11,
  heli: 9,
  rover: 4
}

export function flightModesFor(vehicleId: string): readonly FlightMode[] {
  return FLIGHT_MODES[vehicleId] ?? []
}

/**
 * Whether a one-button takeoff is offered.
 *
 * Copter only. A multirotor in GUIDED climbs straight up from where it sits,
 * which is the whole manoeuvre. A fixed wing needs a runway roll or a hand
 * launch and airspeed before it is flying, and pretending one button covers
 * that would be a button that usually fails.
 */
export function canTakeOff(vehicleId: string): boolean {
  return vehicleId === 'copter'
}

/** The default takeoff altitude, in metres above home. */
export const DEFAULT_TAKEOFF_ALTITUDE_M = 20

/**
 * What the takeoff button does, in order.
 *
 * Copter refuses NAV_TAKEOFF unless it is already armed and already in
 * GUIDED, so this is three commands rather than one, and the order is not
 * negotiable.
 */
export function takeOffSequence(
  vehicleId: string,
  altitudeMetres: number
): readonly ({ kind: 'mode'; value: number } | { kind: 'arm' } | { kind: 'takeoff'; altitudeMetres: number })[] {
  const guided = GUIDED_MODE[vehicleId]
  if (guided === undefined || !canTakeOff(vehicleId)) return []
  return [{ kind: 'mode', value: guided }, { kind: 'arm' }, { kind: 'takeoff', altitudeMetres }]
}

/** A mode number as the picker should show it. */
export function modeLabel(vehicleId: string, value: number | undefined): string {
  if (value === undefined) return '—'
  return flightModesFor(vehicleId).find((mode) => mode.value === value)?.label ?? `Mode ${value}`
}
