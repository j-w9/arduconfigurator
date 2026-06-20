// Data shape and seed catalog for the RC option mixer scaffold.
//
// PHASE 0 NOTE: this is intentionally a UI-only model. ArduPilot does not
// today expose a way to assign multiple functions to one RC channel with
// independent PWM activation ranges (the BF "modes" mental model). The
// mixer view renders local state only; nothing here is written to the
// vehicle, the snapshot, or persisted storage. The view exists so:
//   - The configurator can demonstrate the desired UX to ArduPilot devs.
//   - We can wire the real protocol the day ArduPilot ships support
//     without redoing the UI from scratch.

export interface RcMixerFunctionDefinition {
  /** Numeric option value if/when ArduPilot adopts an enum. For the
   * scaffold this is a stable lookup key. */
  id: number
  /** Short label rendered in the assignment row. */
  label: string
  /** Long-form description rendered in tooltips and the function picker. */
  description: string
  /** True if the function is a momentary action (e.g. trigger gripper)
   * rather than a sustained state (e.g. arm). Affects how the range UI
   * narrates "active" — momentary functions describe the active range as
   * a trigger window, sustained ones as a hold window. */
  momentary?: boolean
}

export interface RcMixerAssignment {
  /** Stable, sortable id within a session. Generated on row creation. */
  id: string
  /** RC channel index 1..16. */
  channel: number
  /** Index into the function catalog (RcMixerFunctionDefinition.id). */
  functionId: number
  /** Inclusive low PWM (typically 1000..2000). Below low or above high the
   * function is inactive. */
  lowPwm: number
  /** Inclusive high PWM. */
  highPwm: number
  /** When true, the function is active when the channel is OUTSIDE the
   * [low, high] window. Mirrors BF's "inverted" semantics. */
  inverted: boolean
}

export interface RcMixerState {
  assignments: RcMixerAssignment[]
}

// Seed catalog. The numeric ids match the most common ArduPilot
// `RCn_OPTION` values today so that, if AP later wires this directly,
// scaffold assignments map cleanly. Not every BF auxiliary function has
// an ArduPilot equivalent — those are still listed here so the demo UI
// covers the same surface area; the demo banner makes clear this is
// not flight-functional yet.
export const RC_MIXER_FUNCTION_CATALOG: readonly RcMixerFunctionDefinition[] = [
  { id: 0, label: 'Do nothing', description: 'No assigned function — the channel is reserved or used by another mapping.' },
  { id: 9, label: 'Save waypoint', description: 'Records the current vehicle position into the active mission.', momentary: true },
  { id: 16, label: 'AutoTune', description: 'Triggers ArduCopter\'s automatic tuning routine while the channel is high.' },
  { id: 18, label: 'Land', description: 'Switches the vehicle into LAND immediately when this range is active.' },
  { id: 22, label: 'Parachute release', description: 'Fires the chute servo when the channel enters the active range.', momentary: true },
  { id: 27, label: 'Arm / Disarm', description: 'Toggles the motor arm state. Most operators bind this to a sticky two-position switch.' },
  { id: 31, label: 'Motor emergency stop', description: 'Cuts power to the motors immediately. Wire to a guarded switch.', momentary: true },
  { id: 41, label: 'RTL', description: 'Engages Return-to-Launch while the channel sits in the active range.' },
  { id: 46, label: 'RC override enable', description: 'Lets a companion computer pilot via MAVLink while this range is held.' },
  { id: 47, label: 'Gripper', description: 'Cycles the gripper open/closed on each pulse into the active range.', momentary: true },
  { id: 51, label: 'Precision Loiter', description: 'Engages precision-loiter assistance (requires PrecLand sensor).' },
  { id: 55, label: 'Guided', description: 'Switches the vehicle into GUIDED mode for the duration of the active range.' },
  { id: 66, label: 'Reverse throttle', description: 'Inverts the throttle stick mapping while the channel sits in the active range.' },
  { id: 77, label: 'Camera trigger', description: 'Fires the configured camera shutter / record line.', momentary: true },
  { id: 83, label: 'Disable airmode', description: 'Forces airmode off while held; vehicle-dependent.' },
  { id: 153, label: 'Arm without safety', description: 'Arms even with safety switch active. Off-flight bench use only.' },
  { id: 300, label: 'Scripting 1', description: 'Triggers Lua script flag 1 (vehicle must run a script that reads it).' },
  { id: 301, label: 'Scripting 2', description: 'Triggers Lua script flag 2.' }
]

export function createIdleRcMixerState(): RcMixerState {
  return { assignments: [] }
}

let assignmentCounter = 0
function nextAssignmentId(): string {
  assignmentCounter += 1
  return `rc-mixer-assignment-${assignmentCounter}`
}

export function createAssignment(channel: number, functionId: number): RcMixerAssignment {
  return {
    id: nextAssignmentId(),
    channel,
    functionId,
    lowPwm: 1700,
    highPwm: 2100,
    inverted: false
  }
}

export interface RcMixerFunctionDefinitionLookup {
  byId: ReadonlyMap<number, RcMixerFunctionDefinition>
}

export function buildRcMixerFunctionLookup(
  catalog: readonly RcMixerFunctionDefinition[] = RC_MIXER_FUNCTION_CATALOG
): RcMixerFunctionDefinitionLookup {
  return { byId: new Map(catalog.map((definition) => [definition.id, definition])) }
}

/**
 * Group assignments by channel for the channel-row layout. Channels with no
 * assignments are still surfaced so the UI can show "+ Add" affordances on
 * every channel in the 1..maxChannel range.
 */
export function groupAssignmentsByChannel(
  assignments: readonly RcMixerAssignment[],
  maxChannel = 16
): Array<{ channel: number; assignments: RcMixerAssignment[] }> {
  const byChannel = new Map<number, RcMixerAssignment[]>()
  for (let channel = 1; channel <= maxChannel; channel += 1) {
    byChannel.set(channel, [])
  }
  for (const assignment of assignments) {
    const bucket = byChannel.get(assignment.channel)
    if (bucket) {
      bucket.push(assignment)
    }
  }
  return Array.from(byChannel.entries())
    .sort(([left], [right]) => left - right)
    .map(([channel, bucket]) => ({ channel, assignments: bucket }))
}

// The PWM track in the chart visualizer spans 800..2200 μs. Real RC links
// land in 1000..2000 μs, but the wider window matches the input bounds and
// keeps the visualization honest when an operator slides a band to the
// edges.
export const RC_MIXER_TRACK_MIN_PWM = 800
export const RC_MIXER_TRACK_MAX_PWM = 2200
export const RC_MIXER_TRACK_RANGE = RC_MIXER_TRACK_MAX_PWM - RC_MIXER_TRACK_MIN_PWM

export interface RcMixerBandGeometry {
  /** Left edge of the band as a percentage of the track width. */
  leftPercent: number
  /** Width of the band as a percentage of the track width. */
  widthPercent: number
}

/**
 * Compute where an assignment's [low, high] band sits on the chart's 800..2200
 * μs track. Both endpoints are clamped so a draft that briefly drops below
 * the floor or above the ceiling still renders coherently (otherwise we'd
 * draw a band starting offscreen during a number-input keystroke).
 */
export function computeBandGeometry(lowPwm: number, highPwm: number): RcMixerBandGeometry {
  const lowClamped = Math.max(RC_MIXER_TRACK_MIN_PWM, Math.min(RC_MIXER_TRACK_MAX_PWM, lowPwm))
  const highClamped = Math.max(lowClamped, Math.min(RC_MIXER_TRACK_MAX_PWM, highPwm))
  const leftPercent = ((lowClamped - RC_MIXER_TRACK_MIN_PWM) / RC_MIXER_TRACK_RANGE) * 100
  const widthPercent = ((highClamped - lowClamped) / RC_MIXER_TRACK_RANGE) * 100
  return { leftPercent, widthPercent }
}

/** Convert a live PWM reading into a position percentage on the chart's
 * 800..2200 μs track. Returns undefined when the value is out of range
 * so the UI can hide the cursor instead of pinning it to an edge. */
export function computeCursorPercent(pwm: number | undefined): number | undefined {
  if (pwm === undefined || !Number.isFinite(pwm)) {
    return undefined
  }
  if (pwm < RC_MIXER_TRACK_MIN_PWM || pwm > RC_MIXER_TRACK_MAX_PWM) {
    return undefined
  }
  return ((pwm - RC_MIXER_TRACK_MIN_PWM) / RC_MIXER_TRACK_RANGE) * 100
}

/** Validates that low <= high, both within [800, 2200]. Returns a short
 * diagnostic string when invalid, undefined when valid. */
export function validateAssignmentRange(assignment: RcMixerAssignment): string | undefined {
  if (assignment.lowPwm < 800 || assignment.lowPwm > 2200) {
    return 'Low PWM must be between 800 and 2200.'
  }
  if (assignment.highPwm < 800 || assignment.highPwm > 2200) {
    return 'High PWM must be between 800 and 2200.'
  }
  if (assignment.lowPwm > assignment.highPwm) {
    return 'Low PWM cannot exceed High PWM.'
  }
  return undefined
}
