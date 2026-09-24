/**
 * The simulator's own controls: time, wind, power and faults.
 *
 * SITL exposes all of this as ordinary `SIM_*` parameters, so there is no
 * second channel to build — the panel reads and writes them over the same
 * MAVLink link as everything else, through the same verified write.
 *
 * What it must not do is offer a control the running build does not have.
 * Upstream documents ~630 `SIM_*` parameters; the WebAssembly ArduCopter
 * build carries 384 of them, and which ones depends on the vehicle and the
 * build flags. So every control is declared here and filtered against the
 * live parameter table, the same way the vehicle picker is filtered against
 * the frames the build actually declares.
 */

/** How a control is drawn. */
export type SimControlKind = 'slider' | 'switch' | 'choice'

export interface SimControl {
  /** The `SIM_*` parameter this control is. */
  parameter: string
  label: string
  /** One line saying what moving it does to the vehicle. */
  hint: string
  kind: SimControlKind
  unit?: string
  min?: number
  max?: number
  step?: number
  /**
   * `switch` only: the parameter value that means the switch is on. Off is
   * whichever of 0/1 this is not.
   *
   * This is where the polarity lives, because ArduPilot's is not consistent:
   * `SIM_MAG1_FAIL` is 1 when the compass is broken, but `SIM_GPS1_ENABLE`
   * is 1 when the GPS is *working*. Every switch under Faults reads "on means
   * broken", so an enable-shaped one simply declares `onValue: 0` rather than
   * asking the operator to invert it in their head.
   */
  onValue?: number
  choices?: readonly { value: number; label: string }[]
  /**
   * Faults only: the value this control has on an undamaged vehicle.
   *
   * Faults are sticky by design — one switched on to watch a failsafe stays
   * on — so there has to be one action that puts everything back, and it
   * needs to know what "back" is. Not always zero: a healthy GPS has
   * satellites and a healthy motor has full thrust.
   */
  healthyValue?: number
}

export interface SimControlGroup {
  id: string
  title: string
  /** What this group of controls is for. */
  blurb: string
  controls: readonly SimControl[]
}

/**
 * Deliberately NOT generated from the upstream parameter metadata.
 *
 * Upstream's option labels for these are written for whoever is reading the
 * source, and some are actively misleading out of context: `SIM_BARO_DISABLE`
 * documents its options as `0: Disable, 1: Enable`, which reads backwards for
 * a parameter whose name is already a negative. The ranges are chosen for a
 * slider a person drags, not for the full representable span.
 */
export const SIM_CONTROL_GROUPS: readonly SimControlGroup[] = [
  {
    id: 'time',
    title: 'Time',
    blurb: 'How fast the simulation runs against the wall clock.',
    controls: [
      {
        parameter: 'SIM_SPEEDUP',
        label: 'Speed',
        hint: 'Multiplies the rate the vehicle experiences time. Above about 5× the browser becomes the limit, not the physics.',
        kind: 'slider',
        unit: '×',
        min: 1,
        max: 10,
        step: 0.5
      }
    ]
  },
  {
    id: 'wind',
    title: 'Wind',
    blurb: 'What the airframe is flying through.',
    controls: [
      {
        parameter: 'SIM_WIND_SPD',
        label: 'Speed',
        hint: 'Steady wind the vehicle has to hold against.',
        kind: 'slider',
        unit: 'm/s',
        min: 0,
        max: 25,
        step: 0.5
      },
      {
        parameter: 'SIM_WIND_DIR',
        label: 'Direction',
        hint: 'True bearing the wind is coming from.',
        kind: 'slider',
        unit: '°',
        min: 0,
        max: 359,
        step: 1
      },
      {
        parameter: 'SIM_WIND_TURB',
        label: 'Turbulence',
        hint: 'Random variation on top of the steady wind — this is what makes altitude hold work for its living.',
        kind: 'slider',
        unit: 'm/s',
        min: 0,
        max: 15,
        step: 0.5
      }
    ]
  },
  {
    id: 'power',
    title: 'Battery',
    blurb: 'Changing either re-initialises the pack’s state of charge.',
    controls: [
      {
        parameter: 'SIM_BATT_VOLTAGE',
        label: 'Resting voltage',
        hint: 'No-load pack voltage. Drop it to walk the vehicle into its low-battery failsafe.',
        kind: 'slider',
        unit: 'V',
        min: 0,
        max: 30,
        step: 0.1
      },
      {
        parameter: 'SIM_BATT_CAP_AH',
        label: 'Capacity',
        hint: 'Pack capacity. Zero means the battery never runs down.',
        kind: 'slider',
        unit: 'Ah',
        min: 0,
        max: 50,
        step: 0.1
      }
    ]
  },
  {
    id: 'faults',
    title: 'Faults',
    blurb: 'Break something on purpose and watch the failsafes deal with it. Every switch here means "this is broken".',
    controls: [
      {
        parameter: 'SIM_GPS1_ENABLE',
        label: 'GPS lost',
        hint: 'Stops the GPS reporting at all, as though the receiver were unplugged.',
        kind: 'switch',
        onValue: 0,
        healthyValue: 1
      },
      {
        parameter: 'SIM_GPS1_JAM',
        label: 'GPS jammed',
        hint: 'The receiver is still there and still talking, but the fix degrades — the harder failure to handle.',
        kind: 'switch',
        onValue: 1,
        healthyValue: 0
      },
      {
        parameter: 'SIM_GPS1_NUMSATS',
        label: 'Satellites',
        hint: 'How many the receiver can see. Below about 6 the fix stops being usable.',
        kind: 'slider',
        min: 0,
        max: 25,
        step: 1,
        healthyValue: 10
      },
      {
        parameter: 'SIM_MAG1_FAIL',
        label: 'Compass failed',
        hint: 'The first compass stops responding.',
        kind: 'switch',
        onValue: 1,
        healthyValue: 0
      },
      {
        parameter: 'SIM_BARO_DISABLE',
        label: 'Barometer failed',
        hint: 'The barometer stops responding, which takes altitude hold with it.',
        kind: 'switch',
        onValue: 1,
        healthyValue: 0
      },
      {
        parameter: 'SIM_RC_FAIL',
        label: 'Radio control',
        hint: 'How the link from the transmitter fails, which is what the RC failsafe is written for.',
        kind: 'choice',
        choices: [
          { value: 0, label: 'Working' },
          { value: 1, label: 'No pulses' },
          { value: 2, label: 'Stuck at neutral' }
        ],
        healthyValue: 0
      },
      {
        parameter: 'SIM_ENGINE_MUL',
        label: 'Motor thrust',
        hint: 'How much thrust the failed motors keep. At 0 they are dead. Does nothing until a motor is picked below.',
        kind: 'slider',
        min: 0,
        max: 1,
        step: 0.05
      },
      {
        parameter: 'SIM_ENGINE_FAIL',
        label: 'Failed motors',
        hint: 'Which motors the thrust scale above applies to, as a bitmask: 1 is the first motor, 3 is the first two, 0 is none.',
        kind: 'slider',
        min: 0,
        max: 255,
        step: 1,
        healthyValue: 0
      }
    ]
  }
]

/**
 * The groups this vehicle can actually offer, with controls it does not have
 * dropped and groups left empty removed.
 *
 * A control whose parameter is absent is not a broken control — it is a
 * control for a part this build does not simulate — so it is left out rather
 * than shown disabled.
 */
export function availableGroups(
  parameters: Readonly<Record<string, number>> | undefined
): readonly SimControlGroup[] {
  if (!parameters) return []
  return SIM_CONTROL_GROUPS.map((group) => ({
    ...group,
    controls: group.controls.filter((control) => parameters[control.parameter] !== undefined)
  })).filter((group) => group.controls.length > 0)
}

/** Whether a switch-shaped control currently reads as on. */
export function switchIsOn(control: SimControl, value: number | undefined): boolean {
  if (value === undefined) return false
  return value === (control.onValue ?? 1)
}

/** The value to write when a switch is moved to `next`. */
export function switchValue(control: SimControl, next: boolean): number {
  const on = control.onValue ?? 1
  return next ? on : on === 0 ? 1 : 0
}

/**
 * A control's value rendered for display.
 *
 * Steps carry the precision: a 0.5-step slider reading "12.50 m/s" is noise,
 * and an integer one reading "12.0" invites the question of what the .0 is.
 */
export function formatControlValue(control: SimControl, value: number | undefined): string {
  if (value === undefined) return '—'
  const step = control.step ?? 1
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  const shown = value.toFixed(decimals)
  return control.unit ? `${shown} ${control.unit}` : shown
}

/**
 * Whether any control in this set sits away from a quiet, healthy vehicle.
 *
 * Worth surfacing because these are sticky: a fault switched on to watch a
 * failsafe stays on, and a vehicle that will not hold altitude an hour later
 * is a long way from the switch that explains it.
 */
export function activeFaultCount(
  groups: readonly SimControlGroup[],
  parameters: Readonly<Record<string, number>> | undefined
): number {
  if (!parameters) return 0
  const faults = groups.find((group) => group.id === 'faults')
  if (!faults) return 0
  return faults.controls.filter((control) => {
    const value = parameters[control.parameter]
    if (value === undefined) return false
    if (control.kind === 'switch') return switchIsOn(control, value)
    if (control.parameter === 'SIM_RC_FAIL') return value !== 0
    // The mask is the fault. The scaler beside it only says how bad it is,
    // and does nothing at all while the mask names no motor -- which is why
    // its own default is 0 rather than 1, and why it is never counted here.
    if (control.parameter === 'SIM_ENGINE_FAIL') return value > 0
    if (control.parameter === 'SIM_ENGINE_MUL') return false
    // Satellites: healthy is "plenty", and the simulator's own default is 10.
    if (control.parameter === 'SIM_GPS1_NUMSATS') return value < 6
    return false
  }).length
}

/**
 * The writes that put every fault back to healthy, skipping the ones already
 * there.
 *
 * Returning only what actually differs keeps the "clear" action honest: on a
 * vehicle with one broken compass it writes one parameter, not eight, and the
 * verified-write result says so.
 */
export function healthyWrites(
  groups: readonly SimControlGroup[],
  parameters: Readonly<Record<string, number>> | undefined
): readonly { parameter: string; value: number }[] {
  const faults = groups.find((group) => group.id === 'faults')
  if (!faults || !parameters) return []
  return faults.controls.flatMap((control) => {
    if (control.healthyValue === undefined) return []
    const current = parameters[control.parameter]
    if (current === undefined || current === control.healthyValue) return []
    return [{ parameter: control.parameter, value: control.healthyValue }]
  })
}
