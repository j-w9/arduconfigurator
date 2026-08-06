import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/**
 * Status & Info "advanced sensor" cards: rangefinder and optical flow.
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator ask was blunt: "I'd like to see rangefinder and optical flow so
 * as a user I know they are working and reporting data. Right now I'm not sure
 * how to do that besides look at logs or go back to MP." Two follow-ups
 * sharpened it:
 *
 *   1. Real measurements, not adjectives. "Configured" and "healthy" are what
 *      the app already said, and they are exactly what did NOT answer the
 *      question. Each card's primary content is the live number.
 *   2. Only show the card if the sensor is set up. GPS and compass are the
 *      baseline and stay unconditional; rangefinder and flow are advanced, so
 *      an unconfigured sensor gets no card at all rather than a card full of
 *      zeroes.
 *
 * And a field report pinned down which state actually earns its keep: an
 * operator with a DroneCAN flow sensor, hand-soldered because the connector
 * would not fit, had the wires crossed. The sensor was configured; no data
 * arrived; the card said so; that told them the solder job was wrong. So
 * "configured but no data" is load-bearing and must never be able to render
 * as anything resembling a working sensor — and it must be legible on the
 * face of the card, because in that report it was only discoverable on hover.
 *
 * THE STATES
 * ----------
 * `absent`    — not configured. The caller drops the card entirely.
 * `silent`    — configured, nothing has EVER arrived. Wiring/bus/driver fault.
 * `stalled`   — configured, data arrived and then stopped. A different fault
 *               from `silent` (an intermittent joint, a sensor browning out),
 *               and one the operator explicitly wanted distinguished.
 * `degraded`  — data IS arriving, but the sensor says its own reading is not
 *               usable (flow quality 0, rangefinder signal_quality 1). The
 *               wiring is proven good; the sensor cannot see. Showing the
 *               number is the point: quality 0 is a diagnosis, not a blank.
 * `reporting` — data arriving and usable.
 *
 * Everything here is pure: values in, view model out, no snapshot mutation and
 * no clock of its own (`nowMs` is injected), so the state machine above is
 * unit-tested directly rather than through the runtime.
 */

/** Tone vocabulary shared with `StatusBadge` in ui-kit. */
export type AdvancedSensorTone = 'success' | 'warning' | 'danger'

export type AdvancedSensorState = 'silent' | 'stalled' | 'degraded' | 'reporting'

export interface AdvancedSensorReadout {
  label: string
  /** Already-formatted display value. Never a bare "0" standing in for
   * "no reading" — callers get the literal string "No data" instead. */
  value: string
  /** Optional per-row emphasis; the headline measurement row sets this so the
   * number the operator came for is visually first among equals. */
  emphasis?: boolean
}

export interface AdvancedSensorCardViewModel {
  id: 'rangefinder' | 'optical-flow'
  title: string
  state: AdvancedSensorState
  tone: AdvancedSensorTone
  /** Short badge text. Colour carries the state at a glance; this carries it
   * for everyone else, because colour is never the only signal. */
  badge: string
  /** The at-a-glance headline printed on the FACE of the card. For a fault
   * state this is the fault, in plain words — not a tooltip. */
  headline: string
  /** Longer diagnostic detail. Safe to put in a title/tooltip because the
   * headline above already carries the actionable part. */
  detail: string
  rows: AdvancedSensorReadout[]
  testId: string
}

/**
 * How long a sensor may go quiet before the card stops trusting the last
 * reading. Both streams are requested at 5 Hz (LIVE_TELEMETRY_REQUESTS), so
 * 3 s is ~15 missed messages: far past a dropped frame or a busy link, well
 * short of leaving a stale number on screen while an operator stares at it.
 */
export const ADVANCED_SENSOR_FRESHNESS_MS = 3000

/**
 * AP_OpticalFlow.h `Type` / the FLOW_TYPE @Values block in
 * AP_OpticalFlow.cpp. Transcribed from source rather than memory — note 6 is
 * DroneCAN (HereFlow) and 10 is SITL, which is easy to get backwards.
 */
const FLOW_TYPE_LABELS: Record<number, string> = {
  1: 'PX4Flow',
  2: 'Pixart',
  3: 'Bebop',
  4: 'CXOF',
  5: 'MAVLink',
  6: 'DroneCAN',
  7: 'MSP',
  8: 'UPFLOW',
  10: 'SITL'
}

/** MAV_SENSOR_ORIENTATION values ArduPilot actually uses for rangefinders. */
const RANGEFINDER_ORIENTATION_LABELS: Record<number, string> = {
  0: 'Forward',
  2: 'Right',
  4: 'Back',
  6: 'Left',
  24: 'Up',
  25: 'Down'
}

/** MAV_DISTANCE_SENSOR. */
const DISTANCE_SENSOR_TYPE_LABELS: Record<number, string> = {
  0: 'Laser',
  1: 'Ultrasound',
  2: 'Infrared',
  3: 'Radar'
}

export interface AdvancedSensorCardsInput {
  connected: boolean
  liveVerification: ConfiguratorSnapshot['liveVerification']
  /**
   * RNGFND1_TYPE, falling back to the pre-4.5 unnumbered RNGFND_TYPE.
   * `undefined` means the parameter is not in the synced table yet — which is
   * NOT the same as 0, and must not render a card claiming the sensor is off.
   */
  rangefinderType: number | undefined
  /** FLOW_TYPE. Any non-zero value counts, including the CAN-attached
   * variants — a card that only recognised directly-wired sensors would have
   * hidden the exact DroneCAN fault this feature was built to catch. */
  flowType: number | undefined
  nowMs: number
}

function formatAge(lastSeenAtMs: number | undefined, nowMs: number): string {
  if (lastSeenAtMs === undefined) {
    return 'never'
  }
  const ageMs = Math.max(0, nowMs - lastSeenAtMs)
  if (ageMs < 1000) {
    return 'just now'
  }
  if (ageMs < 60000) {
    return `${Math.round(ageMs / 1000)} s ago`
  }
  return `${Math.round(ageMs / 60000)} min ago`
}

/**
 * Resolves `silent` vs `stalled` vs "data is live". Shared by both cards so
 * the two can never drift into disagreeing about what silence means.
 */
function resolveLiveness(
  lastSeenAtMs: number | undefined,
  nowMs: number
): { fresh: boolean; state: 'silent' | 'stalled' | undefined } {
  if (lastSeenAtMs === undefined) {
    return { fresh: false, state: 'silent' }
  }
  if (nowMs - lastSeenAtMs > ADVANCED_SENSOR_FRESHNESS_MS) {
    return { fresh: false, state: 'stalled' }
  }
  return { fresh: true, state: undefined }
}

function formatMetres(value: number | undefined): string {
  return value === undefined ? 'No data' : `${value.toFixed(2)} m`
}

export function buildRangefinderCard(
  input: AdvancedSensorCardsInput
): AdvancedSensorCardViewModel | undefined {
  const { rangefinderType, liveVerification, nowMs } = input
  // Absent: no card. An unconfigured rangefinder is not a fault to report,
  // it is a feature the operator has not opted into — and "advanced" boxes
  // only earn their space once they have something to say.
  if (!input.connected || rangefinderType === undefined || rangefinderType === 0) {
    return undefined
  }

  const rangefinder = liveVerification.rangefinder
  const { fresh, state: livenessState } = resolveLiveness(rangefinder.lastSeenAtMs, nowMs)
  const age = formatAge(rangefinder.lastSeenAtMs, nowMs)

  // ArduPilot's signal_quality sentinels (GCS_Common.cpp): 0 = the driver
  // does not report quality at all, 1 = it reports the signal as invalid,
  // 2..100 = a real percentage. Printing "0%" for the first case would
  // libel a perfectly good lidar, so all three branch separately.
  const quality = rangefinder.signalQuality
  const qualityText =
    !fresh || quality === undefined
      ? 'No data'
      : quality === 0
        ? 'Not reported by driver'
        : quality === 1
          ? 'Invalid signal'
          : `${quality}%`

  const state: AdvancedSensorState = livenessState
    ? livenessState
    : quality === 1
      ? 'degraded'
      : 'reporting'

  const rows: AdvancedSensorReadout[] = [
    {
      label: 'Distance',
      // The headline measurement. Suppressed the moment the stream goes
      // quiet: a distance left on screen from four seconds ago is worse than
      // no distance, because it looks like a working sensor.
      value: fresh ? formatMetres(rangefinder.distanceM) : 'No data',
      emphasis: true
    },
    { label: 'Signal', value: qualityText },
    {
      label: 'Range',
      value:
        rangefinder.minDistanceM !== undefined && rangefinder.maxDistanceM !== undefined
          ? `${rangefinder.minDistanceM.toFixed(2)} – ${rangefinder.maxDistanceM.toFixed(2)} m`
          : 'Unknown'
    },
    {
      label: 'Facing',
      value:
        rangefinder.orientation === undefined
          ? 'Unknown'
          : (RANGEFINDER_ORIENTATION_LABELS[rangefinder.orientation] ?? `Orientation ${rangefinder.orientation}`)
    },
    {
      label: 'Driver',
      value:
        rangefinder.sensorType !== undefined && DISTANCE_SENSOR_TYPE_LABELS[rangefinder.sensorType]
          ? `RNGFND1_TYPE ${rangefinderType} · ${DISTANCE_SENSOR_TYPE_LABELS[rangefinder.sensorType]}`
          : `RNGFND1_TYPE ${rangefinderType}`
    },
    { label: 'Last data', value: age }
  ]

  const headline =
    state === 'silent'
      ? 'No data received. The rangefinder is configured but has never reported.'
      : state === 'stalled'
        ? `No data for ${age.replace(' ago', '')} — it was reporting, then stopped.`
        : state === 'degraded'
          ? 'Reporting, but the sensor flags its own signal as invalid.'
          : 'Reporting live distance.'

  const detail =
    state === 'silent'
      ? `RNGFND1_TYPE is ${rangefinderType}, but no DISTANCE_SENSOR (msgid 132) message has ever arrived. ArduPilot suppresses this message entirely while the driver has no data, so this points at wiring, bus address, or a driver that needs a reboot after the type change.`
      : state === 'stalled'
        ? `DISTANCE_SENSOR (msgid 132) last arrived ${age}. An intermittent connection or a sensor dropping out mid-session looks like this; a never-connected one would read "never".`
        : state === 'degraded'
          ? 'DISTANCE_SENSOR reports signal_quality 1, ArduPilot\'s "invalid signal" sentinel — the link is fine, the return is not. Check the surface, sunlight, or the lens.'
          : `DISTANCE_SENSOR (msgid 132) is arriving from sensor id ${rangefinder.sensorId ?? 0}.`

  return {
    id: 'rangefinder',
    title: 'Rangefinder',
    state,
    tone: state === 'reporting' ? 'success' : state === 'degraded' ? 'warning' : 'danger',
    badge:
      state === 'reporting'
        ? 'reporting'
        : state === 'degraded'
          ? 'bad signal'
          : state === 'stalled'
            ? 'data stopped'
            : 'no data',
    headline,
    detail,
    rows,
    testId: 'setup-rangefinder-card'
  }
}

export function buildOpticalFlowCard(
  input: AdvancedSensorCardsInput
): AdvancedSensorCardViewModel | undefined {
  const { flowType, liveVerification, nowMs } = input
  if (!input.connected || flowType === undefined || flowType === 0) {
    return undefined
  }

  const flow = liveVerification.opticalFlow
  const { fresh, state: livenessState } = resolveLiveness(flow.lastSeenAtMs, nowMs)
  const age = formatAge(flow.lastSeenAtMs, nowMs)

  // OPTICAL_FLOW quality is a plain 0..255 with no sentinels: ArduPilot only
  // sends the message at all when the driver is healthy, so quality 0 means
  // "sensor is alive and cannot find anything to track" — dark room, blank
  // floor, out of focus. That is a genuinely useful answer, so it is shown as
  // a number and called out, never hidden behind a blank.
  const quality = flow.quality
  const qualityUsable = quality !== undefined && quality > 0
  const state: AdvancedSensorState = livenessState ? livenessState : qualityUsable ? 'reporting' : 'degraded'

  const rows: AdvancedSensorReadout[] = [
    {
      label: 'Quality',
      value: !fresh || quality === undefined ? 'No data' : `${quality} / 255`,
      emphasis: true
    },
    {
      label: 'Flow rate X/Y',
      value:
        fresh && flow.flowRateX !== undefined && flow.flowRateY !== undefined
          ? `${flow.flowRateX.toFixed(3)} / ${flow.flowRateY.toFixed(3)} rad/s`
          : 'No data'
    },
    {
      label: 'Height (HAGL)',
      // ArduPilot sends 0 when AHRS has no height estimate and the runtime
      // normalises that to undefined, so this says "Not estimated" rather
      // than parking the craft on the ground.
      value: fresh ? (flow.groundDistanceM !== undefined ? formatMetres(flow.groundDistanceM) : 'Not estimated') : 'No data'
    },
    {
      label: 'Driver',
      value: FLOW_TYPE_LABELS[flowType]
        ? `FLOW_TYPE ${flowType} · ${FLOW_TYPE_LABELS[flowType]}`
        : `FLOW_TYPE ${flowType}`
    },
    { label: 'Last data', value: age }
  ]

  const headline =
    state === 'silent'
      ? 'No data received. The flow sensor is configured but has never reported.'
      : state === 'stalled'
        ? `No data for ${age.replace(' ago', '')} — it was reporting, then stopped.`
        : state === 'degraded'
          ? 'Reporting, but quality is 0 — the sensor cannot track anything.'
          : 'Reporting live flow.'

  const detail =
    state === 'silent'
      ? `FLOW_TYPE is ${flowType}${FLOW_TYPE_LABELS[flowType] ? ` (${FLOW_TYPE_LABELS[flowType]})` : ''}, but no OPTICAL_FLOW (msgid 100) message has ever arrived. ArduPilot only sends this message while the driver reports healthy, so this points at wiring — on a CAN sensor, the CAN pair or the node itself — or a driver that needs a reboot after the type change.`
      : state === 'stalled'
        ? `OPTICAL_FLOW (msgid 100) last arrived ${age}. A sensor that reported and then stopped is a different fault from one that never reported: suspect an intermittent joint or a node dropping off the bus.`
        : state === 'degraded'
          ? 'OPTICAL_FLOW is arriving with quality 0, so the wiring is proven good — the sensor simply has no usable texture to track. Try more light, more surface detail, or check the focus.'
          : `OPTICAL_FLOW (msgid 100) is arriving from sensor id ${flow.sensorId ?? 0}.`

  return {
    id: 'optical-flow',
    title: 'Optical Flow',
    state,
    tone: state === 'reporting' ? 'success' : state === 'degraded' ? 'warning' : 'danger',
    badge:
      state === 'reporting'
        ? 'reporting'
        : state === 'degraded'
          ? 'no track'
          : state === 'stalled'
            ? 'data stopped'
            : 'no data',
    headline,
    detail,
    rows,
    testId: 'setup-optical-flow-card'
  }
}

/** Both advanced sensor cards, in display order, with unconfigured ones dropped. */
export function buildAdvancedSensorCards(input: AdvancedSensorCardsInput): AdvancedSensorCardViewModel[] {
  const cards: AdvancedSensorCardViewModel[] = []
  const rangefinder = buildRangefinderCard(input)
  if (rangefinder) {
    cards.push(rangefinder)
  }
  const flow = buildOpticalFlowCard(input)
  if (flow) {
    cards.push(flow)
  }
  return cards
}
