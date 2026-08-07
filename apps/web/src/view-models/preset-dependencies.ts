// Dependency classification for operator-authored parameter-group presets.
//
// A preset lifted off one aircraft is a footgun on another: SERIAL3_PROTOCOL=23
// is correct only while the receiver is on UART3, BATT_LOW_VOLT=21.0 is a 6S
// number that will fly a 4S pack into the ground, and ATC_RAT_RLL_P is a
// statement about one airframe's mass and props. The Presets library shipped in
// param-metadata never had this problem — every curated preset was hand-written
// with a `compatibility` block by someone who knew what it touched. User presets
// are captured off a live aircraft in one click, so the knowledge has to be
// recovered from the parameter ids instead.
//
// This module is the recovery step. It is deliberately pure and has no React,
// no runtime, and no storage in it, because it is the part that stands between
// a careless preset and somebody's aircraft; it needs to be unit-testable to
// death (see preset-dependencies.test.ts).
//
// Two halves:
//   - detectPresetDependencies() runs at CREATE time against the selection and
//     the source aircraft's live values. It produces pre-ticked questions plus
//     the context worth recording (which UART, how many cells, which frame).
//   - evaluatePresetDependencies() runs at APPLY time against the target
//     aircraft and turns the recorded context into concrete warnings.
//
// Deliberate non-goal: nothing here ever returns 'blocked'. Every rule below is
// a heuristic over parameter names, and a heuristic must not be able to veto a
// write the operator has reviewed. 'blocked' stays reserved for the curated
// metadata presets' explicit `compatibility.frameClasses` gate, which is an
// assertion by a human author rather than a guess. Warnings that are wrong are
// annoying; blocks that are wrong make the feature unusable and teach operators
// to route around it.

import { parameterImportExclusionCategory } from '@arduconfig/ardupilot-core'

export type PresetDependencyClassId =
  | 'serial-port'
  | 'battery-pack'
  | 'frame'
  | 'airframe-tune'
  | 'output-mapping'
  | 'sensor-hardware'
  | 'can-bus'
  | 'calibration'

/** What a preset recorded about the aircraft it was captured from. */
export interface PresetDependencyContext {
  /** SERIALn indices the captured values belong to, ascending. */
  serialPorts?: number[]
  /** Cell count of the pack the voltage thresholds were set for. */
  batteryCells?: number
  /** FRAME_CLASS on the source aircraft. */
  frameClass?: number
  /** FRAME_TYPE on the source aircraft. */
  frameType?: number
}

export interface PresetDependencyClassDescriptor {
  id: PresetDependencyClassId
  label: string
  /** The question put to the operator in the create dialog. */
  question: string
  /** Why the answer matters — rendered under the question. */
  rationale: string
}

/**
 * The questions the create dialog can ask, in the order it asks them. Ordered
 * by how badly a wrong answer ends: port position and pack voltage first (they
 * silently break a link or over-discharge a pack), cosmetic-ish classes last.
 */
export const PRESET_DEPENDENCY_CLASSES: readonly PresetDependencyClassDescriptor[] = [
  {
    id: 'serial-port',
    label: 'Serial port position',
    question: 'Does this preset depend on which serial port the device is wired to?',
    rationale:
      'SERIALn values only mean anything while the device stays on UART n. On a board where it is wired to a different UART, applying these writes configures the wrong port and leaves the real one untouched.'
  },
  {
    id: 'battery-pack',
    label: 'Battery pack (4S / 6S, capacity)',
    question: 'Does this preset depend on the battery pack (cell count or capacity)?',
    rationale:
      'Voltage failsafe thresholds and capacity limits are per-pack. A 6S set of thresholds on a 4S pack never triggers; a 4S set on a 6S pack triggers immediately.'
  },
  {
    id: 'frame',
    label: 'Frame class / type',
    question: 'Does this preset set the airframe layout itself?',
    rationale:
      'FRAME_CLASS / FRAME_TYPE rewrite the motor mixer. Applying them to a differently-shaped aircraft changes which motor spins which way.'
  },
  {
    id: 'airframe-tune',
    label: 'Airframe size / props',
    question: 'Is this tune specific to the airframe size, weight, or props?',
    rationale:
      'Rate and angle gains, thrust expo, and hover throttle are measurements of one physical aircraft. They do not transfer to a different size or prop.'
  },
  {
    id: 'output-mapping',
    label: 'Motor / servo output mapping',
    question: 'Does this preset depend on how the outputs are wired?',
    rationale:
      'SERVOn_FUNCTION and the output protocol settings describe one board’s wiring loom. Applying another aircraft’s mapping can send a motor signal to a servo pin.'
  },
  {
    id: 'sensor-hardware',
    label: 'Specific sensor hardware',
    question: 'Does this preset assume specific sensor hardware is fitted?',
    rationale:
      'Rangefinder, optical-flow, GPS, proximity, and battery-monitor settings name a particular device and, for analog monitors, a particular board pin. An ARK Flow preset is wrong on a different flow sensor.'
  },
  {
    id: 'can-bus',
    label: 'CAN bus configuration',
    question: 'Does this preset depend on the CAN bus setup?',
    rationale:
      'CAN driver/protocol assignments are per-board and per-peripheral. Applying them where no CAN peripheral is fitted enables a bus with nothing on it.'
  },
  {
    id: 'calibration',
    label: 'Per-airframe calibration',
    question: 'This selection contains calibration values. Keep them?',
    rationale:
      'Compass offsets, accel scale/offsets, thermal calibration, and AHRS trims are measured on one physical board. They are never valid on another and are almost never wanted in a preset.'
  }
]

const CLASS_BY_ID = new Map(PRESET_DEPENDENCY_CLASSES.map((entry) => [entry.id, entry]))

export function presetDependencyClass(id: PresetDependencyClassId): PresetDependencyClassDescriptor {
  const descriptor = CLASS_BY_ID.get(id)
  if (!descriptor) {
    // Unreachable for the union above, but a stored preset from a future
    // version could carry a class this build does not know. Degrade to a
    // generic question rather than crashing the Presets tab.
    return { id, label: id, question: `Does this preset depend on ${id}?`, rationale: '' }
  }
  return descriptor
}

const SERIAL_PORT_PATTERN = /^SERIAL(\d+)_/

/** The SERIALn index a param belongs to, or undefined if it is not a port param. */
export function serialPortIndexOf(paramId: string): number | undefined {
  const match = SERIAL_PORT_PATTERN.exec(paramId)
  return match ? Number(match[1]) : undefined
}

// One param belongs to exactly one class: the rules are evaluated in order and
// the first match wins. Overlaps are real (MOT_BAT_VOLT_MAX is both a MOT_ and
// a battery param), and counting a param twice would make the dialog's "(n
// params)" counts lie about how much of the selection each answer covers.
const CLASS_MATCHERS: readonly { id: PresetDependencyClassId; matches: (paramId: string) => boolean }[] = [
  // Calibration first and unconditionally: whatever else a per-board offset
  // looks like, it is a calibration value and belongs in the class whose
  // recommended answer is "take it out".
  { id: 'calibration', matches: (id) => parameterImportExclusionCategory(id) === 'calibration' },
  // SERIALn_ only — SERIAL_PASS1/PASS2/PASSTIMO have no digit after SERIAL and
  // are a debug bridge, not a port configuration, so they must not drag the
  // whole port-remap question in.
  { id: 'serial-port', matches: (id) => SERIAL_PORT_PATTERN.test(id) },
  {
    id: 'battery-pack',
    matches: (id) =>
      /^BATT\d*_(LOW_VOLT|CRT_VOLT|ARM_VOLT|CAPACITY|LOW_MAH|CRT_MAH|ARM_MAH)$/.test(id) ||
      /^MOT_BAT_(VOLT_MAX|VOLT_MIN|CURR_MAX|CURR_TC)$/.test(id)
  },
  { id: 'frame', matches: (id) => id === 'FRAME_CLASS' || id === 'FRAME_TYPE' },
  {
    id: 'airframe-tune',
    matches: (id) =>
      /^ATC_(RAT_(RLL|PIT|YAW)_|ANG_(RLL|PIT|YAW)_|ACCEL_[RPY]_MAX$|INPUT_TC$|THR_MIX_)/.test(id) ||
      /^MOT_(THST_EXPO|THST_HOVER|SPIN_MIN|SPIN_ARM|SPIN_MAX|HOVER_LEARN)$/.test(id) ||
      /^INS_(GYRO_FILTER|ACCEL_FILTER)$/.test(id) ||
      /^PSC_/.test(id)
  },
  {
    id: 'output-mapping',
    matches: (id) =>
      /^SERVO\d+_/.test(id) || /^SERVO_(BLH_|DSHOT_|RATE$|32_ENABLE$)/.test(id) || /^MOT_PWM_/.test(id)
  },
  {
    id: 'sensor-hardware',
    matches: (id) =>
      /^RNGFND\d+_/.test(id) ||
      /^FLOW_/.test(id) ||
      /^GPS\d*_/.test(id) ||
      /^PRX\d*_/.test(id) ||
      /^ARSPD\d*_/.test(id) ||
      /^EFI\d*_/.test(id) ||
      /^BARO\d*_(PROBE_EXT|EXT_BUS|PRIMARY)$/.test(id) ||
      /^BATT\d*_(MONITOR|VOLT_PIN|CURR_PIN|VOLT_MULT|AMP_PERVLT|AMP_OFFSET|I2C_ADDR|I2C_BUS|SERIAL_NUM)$/.test(id) ||
      /^COMPASS_(TYPEMASK|DISBLMSK|DEV_ID\d*|PRIO\d_ID|EXTERN\w*)$/.test(id)
  },
  { id: 'can-bus', matches: (id) => /^CAN_/.test(id) }
]

export interface DetectedPresetDependency {
  classId: PresetDependencyClassId
  /** Params from the selection that put this class on the list, in selection order. */
  paramIds: string[]
  /** One-line summary the dialog shows beside the question. */
  detail: string
  /** What was recovered off the source aircraft. Empty when nothing applies. */
  context: PresetDependencyContext
}

export interface DetectPresetDependenciesResult {
  dependencies: DetectedPresetDependency[]
  /** Selected params the metadata marks reboot-required. Not a question — a note. */
  rebootRequiredParamIds: string[]
  /** Selected params no rule claimed. Reported so the dialog can say how much is unclassified. */
  unclassifiedParamIds: string[]
}

export interface DetectPresetDependenciesInput {
  paramIds: readonly string[]
  /** Live value on the source aircraft, for context capture. */
  readParameter: (paramId: string) => number | undefined
  /** Metadata reboot-required flag, for the note. */
  isRebootRequired?: (paramId: string) => boolean
}

/**
 * Classify a selection into dependency questions.
 *
 * Every returned dependency is meant to arrive PRE-TICKED in the dialog. The
 * operator's job is to untick the ones that do not apply, which is a far
 * smaller job than filling an empty questionnaire — and, importantly, the
 * failure mode of not touching the dialog at all is an over-cautious preset
 * rather than an unlabelled one.
 */
export function detectPresetDependencies(input: DetectPresetDependenciesInput): DetectPresetDependenciesResult {
  const { paramIds, readParameter, isRebootRequired } = input

  const byClass = new Map<PresetDependencyClassId, string[]>()
  const unclassifiedParamIds: string[] = []
  for (const paramId of paramIds) {
    const matcher = CLASS_MATCHERS.find((rule) => rule.matches(paramId))
    if (!matcher) {
      unclassifiedParamIds.push(paramId)
      continue
    }
    const bucket = byClass.get(matcher.id)
    if (bucket) {
      bucket.push(paramId)
    } else {
      byClass.set(matcher.id, [paramId])
    }
  }

  // Emit in PRESET_DEPENDENCY_CLASSES order, not selection order, so the dialog
  // asks the most consequential questions first regardless of how the operator
  // happened to tick rows.
  const dependencies = PRESET_DEPENDENCY_CLASSES.flatMap((descriptor): DetectedPresetDependency[] => {
    const matched = byClass.get(descriptor.id)
    if (!matched || matched.length === 0) {
      return []
    }
    const context = captureContext(descriptor.id, matched, readParameter)
    return [{ classId: descriptor.id, paramIds: matched, detail: describeDetection(descriptor.id, matched, context), context }]
  })

  return {
    dependencies,
    rebootRequiredParamIds: isRebootRequired ? paramIds.filter((paramId) => isRebootRequired(paramId)) : [],
    unclassifiedParamIds
  }
}

function captureContext(
  classId: PresetDependencyClassId,
  paramIds: readonly string[],
  readParameter: (paramId: string) => number | undefined
): PresetDependencyContext {
  switch (classId) {
    case 'serial-port': {
      const ports = [...new Set(paramIds.map(serialPortIndexOf).filter((port): port is number => port !== undefined))]
      ports.sort((left, right) => left - right)
      return { serialPorts: ports }
    }
    case 'battery-pack': {
      const cells = inferBatteryCellCount(readParameter)
      return cells === undefined ? {} : { batteryCells: cells }
    }
    case 'frame':
    case 'airframe-tune': {
      // A tune is only meaningful next to the airframe it was measured on, so
      // both the layout class and the tune class record it.
      const frameClass = roundedParameter(readParameter, 'FRAME_CLASS')
      const frameType = roundedParameter(readParameter, 'FRAME_TYPE')
      const context: PresetDependencyContext = {}
      if (frameClass !== undefined) context.frameClass = frameClass
      if (frameType !== undefined) context.frameType = frameType
      return context
    }
    default:
      return {}
  }
}

function roundedParameter(readParameter: (paramId: string) => number | undefined, paramId: string): number | undefined {
  const value = readParameter(paramId)
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value)
}

const LIPO_CELL_MAX_VOLTS = 4.2
/**
 * Widest per-cell error we will still call a clean multiple. 0.15 V/cell is
 * enough to absorb an operator who set MOT_BAT_VOLT_MAX to a round 25.0 on 6S
 * (4.167/cell) while still refusing to round 4S and 5S into each other, whose
 * MOT_BAT_VOLT_MAX values are 4.2 V apart.
 */
const CELL_INFERENCE_TOLERANCE_VOLTS = 0.15

/**
 * Recover the pack's cell count from the parameters, or give up.
 *
 * MOT_BAT_VOLT_MAX is the only parameter on a Copter that is conventionally set
 * to a whole number of cells times the full-charge cell voltage, so it is the
 * one honest source. It defaults to 0 (thrust compensation disabled), and
 * plenty of aircraft never set it — hence `undefined` rather than a guess. The
 * create dialog turns `undefined` into the operator's own answer, which is
 * exactly the "4S or 6S?" question the feature exists to ask.
 */
export function inferBatteryCellCount(readParameter: (paramId: string) => number | undefined): number | undefined {
  const voltMax = readParameter('MOT_BAT_VOLT_MAX')
  if (voltMax === undefined || !Number.isFinite(voltMax) || voltMax <= 0) {
    return undefined
  }
  const cells = Math.round(voltMax / LIPO_CELL_MAX_VOLTS)
  if (cells < 2 || cells > 14) {
    return undefined
  }
  // Refuse anything that is not close to a clean multiple: a value that sits
  // between two cell counts is more likely a hand-tuned limit than a pack
  // description, and reporting a confident wrong number is worse than silence.
  if (Math.abs(voltMax - cells * LIPO_CELL_MAX_VOLTS) > CELL_INFERENCE_TOLERANCE_VOLTS * cells) {
    return undefined
  }
  return cells
}

function describeDetection(
  classId: PresetDependencyClassId,
  paramIds: readonly string[],
  context: PresetDependencyContext
): string {
  const count = `${paramIds.length} parameter${paramIds.length === 1 ? '' : 's'}`
  switch (classId) {
    case 'serial-port': {
      const ports = context.serialPorts ?? []
      return ports.length === 0
        ? count
        : `${count} on ${ports.map((port) => `SERIAL${port}`).join(', ')}`
    }
    case 'battery-pack':
      return context.batteryCells === undefined
        ? `${count} — cell count could not be read from MOT_BAT_VOLT_MAX, so state it below`
        : `${count}, captured on a ${context.batteryCells}S pack`
    case 'frame':
    case 'airframe-tune':
      return context.frameClass === undefined
        ? count
        : `${count}, captured on FRAME_CLASS ${context.frameClass}${context.frameType === undefined ? '' : ` / FRAME_TYPE ${context.frameType}`}`
    default:
      return count
  }
}

// ---------------------------------------------------------------------------
// Apply time
// ---------------------------------------------------------------------------

/** A dependency as it is stored on a saved preset. */
export interface PresetDependencyRecord {
  classId: PresetDependencyClassId
  paramIds: readonly string[]
  context?: PresetDependencyContext
}

export interface PresetDependencyEvaluation {
  /** Never 'blocked' — see the module header. */
  status: 'ready' | 'caution'
  reasons: string[]
}

/**
 * Turn a preset's recorded dependencies into warnings about THIS aircraft.
 *
 * Where a recorded context can be compared against the target (cell count,
 * frame class) the warning names both numbers, because "check your battery
 * settings" is advice an operator learns to click past and "saved on 6S, this
 * aircraft reads 4S" is not. Where nothing can be compared, the warning states
 * the dependency plainly and stops — it does not invent a comparison.
 */
export function evaluatePresetDependencies(
  dependencies: readonly PresetDependencyRecord[],
  readTargetParameter: (paramId: string) => number | undefined
): PresetDependencyEvaluation {
  const reasons: string[] = []

  for (const dependency of dependencies) {
    const context = dependency.context ?? {}
    switch (dependency.classId) {
      case 'serial-port': {
        const ports = context.serialPorts ?? []
        reasons.push(
          ports.length === 0
            ? 'This preset configures serial ports; confirm the device is on the same UART here.'
            : `Saved for ${ports.map((port) => `SERIAL${port}`).join(', ')}. If the device is on a different UART on this board, remap the port before applying.`
        )
        break
      }
      case 'battery-pack': {
        const savedCells = context.batteryCells
        const targetCells = inferBatteryCellCount(readTargetParameter)
        if (savedCells !== undefined && targetCells !== undefined && savedCells !== targetCells) {
          reasons.push(
            `Saved for a ${savedCells}S pack; this aircraft reads as ${targetCells}S. The voltage thresholds in this preset will be wrong.`
          )
        } else if (savedCells !== undefined && targetCells === undefined) {
          reasons.push(
            `Saved for a ${savedCells}S pack. This aircraft does not report a cell count (MOT_BAT_VOLT_MAX is unset), so it cannot be checked.`
          )
        } else if (savedCells === undefined) {
          reasons.push('This preset contains battery thresholds and no recorded cell count. Check them against the pack you fly.')
        }
        break
      }
      case 'frame':
      case 'airframe-tune': {
        const savedFrameClass = context.frameClass
        const targetFrameClass = roundedParameter(readTargetParameter, 'FRAME_CLASS')
        const noun = dependency.classId === 'frame' ? 'This preset rewrites the frame layout' : 'This tune was measured on one airframe'
        if (savedFrameClass !== undefined && targetFrameClass !== undefined && savedFrameClass !== targetFrameClass) {
          reasons.push(`${noun}: saved on FRAME_CLASS ${savedFrameClass}, this aircraft is FRAME_CLASS ${targetFrameClass}.`)
        } else {
          reasons.push(`${noun}; it does not transfer to a different size, weight, or prop.`)
        }
        break
      }
      case 'output-mapping':
        reasons.push('This preset sets motor/servo output mapping, which follows this board’s wiring. Verify with props off.')
        break
      case 'sensor-hardware':
        reasons.push('This preset assumes specific sensor hardware is fitted and wired the same way.')
        break
      case 'can-bus':
        reasons.push('This preset changes CAN bus configuration; confirm the same peripherals are on the bus here.')
        break
      case 'calibration':
        reasons.push('This preset still contains per-board calibration values, which are never valid on another board.')
        break
      default:
        reasons.push(`This preset declares a dependency on ${dependency.classId}.`)
        break
    }
  }

  return { status: reasons.length === 0 ? 'ready' : 'caution', reasons }
}

// ---------------------------------------------------------------------------
// Serial-port remap
// ---------------------------------------------------------------------------

export interface PresetSerialRemapResult<T extends { paramId: string }> {
  values: T[]
  /** Ids that were rewritten, as `from -> to` pairs, for the confirmation copy. */
  remapped: { from: string; to: string }[]
  /** Rewritten ids that do not exist on the target — the remap would be a no-op for these. */
  missingOnTarget: string[]
}

/**
 * Rewrite a preset's SERIALn_* ids from one port index to another.
 *
 * The transform itself is exact and total: SERIAL3_PROTOCOL -> SERIAL4_PROTOCOL
 * is a string substitution on ids the preset already owns, so there is no
 * inference to get wrong. What cannot be inferred is whether the operator WANTS
 * it, which is why this is driven by an explicit port choice in the UI and
 * defaults to no remap.
 *
 * `knownParamIds` is the target aircraft's parameter set. Ids that would not
 * exist after the remap are reported rather than silently dropped: a board with
 * four UARTs has no SERIAL6_PROTOCOL, and a remap that quietly produced writes
 * to a nonexistent param would look like it worked.
 */
export function remapPresetSerialPort<T extends { paramId: string }>(
  values: readonly T[],
  fromPort: number,
  toPort: number,
  knownParamIds?: ReadonlySet<string>
): PresetSerialRemapResult<T> {
  if (fromPort === toPort) {
    return { values: [...values], remapped: [], missingOnTarget: [] }
  }

  const remapped: { from: string; to: string }[] = []
  const missingOnTarget: string[] = []
  const next = values.map((entry) => {
    if (serialPortIndexOf(entry.paramId) !== fromPort) {
      return entry
    }
    const paramId = entry.paramId.replace(SERIAL_PORT_PATTERN, `SERIAL${toPort}_`)
    remapped.push({ from: entry.paramId, to: paramId })
    if (knownParamIds && !knownParamIds.has(paramId)) {
      missingOnTarget.push(paramId)
    }
    return { ...entry, paramId }
  })

  return { values: next, remapped, missingOnTarget }
}
