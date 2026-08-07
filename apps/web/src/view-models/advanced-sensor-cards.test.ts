import { describe, expect, it } from 'vitest'

import {
  ADVANCED_SENSOR_FRESHNESS_MS,
  buildAdvancedSensorCards,
  buildOpticalFlowCard,
  buildRangefinderCard,
  type AdvancedSensorCardsInput
} from './advanced-sensor-cards'

const NOW = 1_700_000_000_000

function input(overrides: {
  connected?: boolean
  rangefinderType?: number | undefined
  flowType?: number | undefined
  rangefinder?: Record<string, unknown>
  opticalFlow?: Record<string, unknown>
}): AdvancedSensorCardsInput {
  return {
    connected: overrides.connected ?? true,
    rangefinderType: 'rangefinderType' in overrides ? overrides.rangefinderType : undefined,
    flowType: 'flowType' in overrides ? overrides.flowType : undefined,
    nowMs: NOW,
    liveVerification: {
      rangefinder: { verified: false, ...(overrides.rangefinder ?? {}) },
      opticalFlow: { verified: false, ...(overrides.opticalFlow ?? {}) }
    } as unknown as AdvancedSensorCardsInput['liveVerification']
  }
}

/** A rangefinder that is configured and streaming a good reading. */
const reportingRangefinder = {
  verified: true,
  lastSeenAtMs: NOW - 200,
  sensorId: 0,
  distanceM: 1.42,
  minDistanceM: 0.2,
  maxDistanceM: 7,
  orientation: 25,
  sensorType: 0,
  signalQuality: 87
}

describe('advanced sensor cards — the absent case', () => {
  // "Only show those boxes if setup. Anything above GPS and compass I'm
  // calling advanced." An unconfigured sensor gets NO card, not a card of
  // zeroes — a zeroed card is the dead end the operator was already stuck in.
  it('drops the rangefinder card when RNGFND1_TYPE is 0', () => {
    expect(buildRangefinderCard(input({ rangefinderType: 0 }))).toBeUndefined()
  })

  it('drops the flow card when FLOW_TYPE is 0', () => {
    expect(buildOpticalFlowCard(input({ flowType: 0 }))).toBeUndefined()
  })

  // undefined is "the parameter has not synced yet", which is NOT the same as
  // "the sensor is off" — claiming either way before the table lands would be
  // a guess shown as a fact.
  it('drops both cards while the parameters have not synced', () => {
    expect(buildAdvancedSensorCards(input({}))).toEqual([])
  })

  it('drops both cards while disconnected even if the params say configured', () => {
    expect(
      buildAdvancedSensorCards(input({ connected: false, rangefinderType: 100, flowType: 6 }))
    ).toEqual([])
  })
})

describe('rangefinder card', () => {
  it('shows the live distance as the emphasised headline row when reporting', () => {
    const card = buildRangefinderCard(input({ rangefinderType: 100, rangefinder: reportingRangefinder }))
    expect(card?.state).toBe('reporting')
    expect(card?.tone).toBe('success')
    const distance = card?.rows.find((row) => row.label === 'Distance')
    expect(distance?.value).toBe('1.42 m')
    expect(distance?.emphasis).toBe(true)
    expect(card?.rows.find((row) => row.label === 'Signal')?.value).toBe('87%')
    expect(card?.rows.find((row) => row.label === 'Range')?.value).toBe('0.20 – 7.00 m')
    expect(card?.rows.find((row) => row.label === 'Facing')?.value).toBe('Down')
  })

  // The load-bearing state: configured, nothing ever arrived. This is the one
  // that told a real operator their hand-soldered wires were crossed.
  it('reports configured-but-silent on the face of the card, not just in the detail', () => {
    const card = buildRangefinderCard(input({ rangefinderType: 100 }))
    expect(card?.state).toBe('silent')
    expect(card?.tone).toBe('danger')
    expect(card?.badge).toBe('no data')
    expect(card?.headline).toContain('No data received')
    expect(card?.rows.find((row) => row.label === 'Distance')?.value).toBe('No data')
    expect(card?.rows.find((row) => row.label === 'Last data')?.value).toBe('never')
  })

  // A sensor that reported and then stopped is a different fault from one that
  // never reported — both are plausible with a marginal solder joint.
  it('distinguishes "stopped reporting" from "never reported"', () => {
    const card = buildRangefinderCard(
      input({
        rangefinderType: 100,
        rangefinder: { ...reportingRangefinder, lastSeenAtMs: NOW - (ADVANCED_SENSOR_FRESHNESS_MS + 9000) }
      })
    )
    expect(card?.state).toBe('stalled')
    expect(card?.tone).toBe('danger')
    expect(card?.badge).toBe('data stopped')
    expect(card?.headline).toContain('was reporting, then stopped')
    expect(card?.rows.find((row) => row.label === 'Last data')?.value).toBe('12 s ago')
  })

  // A stale distance left on screen looks exactly like a working sensor,
  // which is the single worst outcome for this feature.
  it('never shows a stale distance once the stream goes quiet', () => {
    const card = buildRangefinderCard(
      input({
        rangefinderType: 100,
        rangefinder: { ...reportingRangefinder, lastSeenAtMs: NOW - (ADVANCED_SENSOR_FRESHNESS_MS + 1) }
      })
    )
    expect(card?.rows.find((row) => row.label === 'Distance')?.value).toBe('No data')
  })

  // ArduPilot's signal_quality sentinels: 0 = driver does not report quality,
  // 1 = invalid signal. Rendering 0 as "0%" would libel a working lidar.
  it('treats signal_quality 0 as "not reported", not as 0%', () => {
    const card = buildRangefinderCard(
      input({ rangefinderType: 100, rangefinder: { ...reportingRangefinder, signalQuality: 0 } })
    )
    expect(card?.state).toBe('reporting')
    expect(card?.rows.find((row) => row.label === 'Signal')?.value).toBe('Not reported by driver')
  })

  it('flags signal_quality 1 as an invalid signal while still showing the distance', () => {
    const card = buildRangefinderCard(
      input({ rangefinderType: 100, rangefinder: { ...reportingRangefinder, signalQuality: 1 } })
    )
    expect(card?.state).toBe('degraded')
    expect(card?.tone).toBe('warning')
    expect(card?.rows.find((row) => row.label === 'Signal')?.value).toBe('Invalid signal')
    expect(card?.rows.find((row) => row.label === 'Distance')?.value).toBe('1.42 m')
  })
})

describe('optical flow card', () => {
  it('shows quality and flow rates when reporting', () => {
    const card = buildOpticalFlowCard(
      input({
        flowType: 6,
        opticalFlow: {
          verified: true,
          lastSeenAtMs: NOW - 100,
          sensorId: 0,
          quality: 184,
          flowRateX: 0.021,
          flowRateY: -0.014,
          groundDistanceM: 1.35
        }
      })
    )
    expect(card?.state).toBe('reporting')
    expect(card?.rows.find((row) => row.label === 'Quality')?.value).toBe('184 / 255')
    expect(card?.rows.find((row) => row.label === 'Flow rate X/Y')?.value).toBe('0.021 / -0.014 rad/s')
    expect(card?.rows.find((row) => row.label === 'Height (HAGL)')?.value).toBe('1.35 m')
  })

  // The reported field case: a DroneCAN sensor, configured, wires crossed.
  // FLOW_TYPE 6 must be recognised as configured — a card that only knew the
  // directly-wired variants would have hidden this exact fault.
  it('renders for a CAN-attached sensor and names the driver', () => {
    const card = buildOpticalFlowCard(input({ flowType: 6 }))
    expect(card?.state).toBe('silent')
    expect(card?.headline).toContain('No data received')
    expect(card?.rows.find((row) => row.label === 'Driver')?.value).toBe('FLOW_TYPE 6 · DroneCAN')
    expect(card?.detail).toContain('CAN')
  })

  // Quality 0 with a live stream means the wiring is GOOD and the sensor
  // cannot see. Opposite diagnosis to silence, so it must not share a state.
  it('separates "alive but tracking nothing" from "no data at all"', () => {
    const card = buildOpticalFlowCard(
      input({ flowType: 8, opticalFlow: { verified: true, lastSeenAtMs: NOW - 100, quality: 0 } })
    )
    expect(card?.state).toBe('degraded')
    expect(card?.tone).toBe('warning')
    expect(card?.rows.find((row) => row.label === 'Quality')?.value).toBe('0 / 255')
    expect(card?.detail).toContain('wiring is proven good')
  })

  it('says the height is not estimated rather than printing a fake 0 m', () => {
    const card = buildOpticalFlowCard(
      input({ flowType: 6, opticalFlow: { verified: true, lastSeenAtMs: NOW - 100, quality: 12 } })
    )
    expect(card?.rows.find((row) => row.label === 'Height (HAGL)')?.value).toBe('Not estimated')
  })
})

describe('buildAdvancedSensorCards', () => {
  it('returns only the configured sensors, rangefinder first', () => {
    const cards = buildAdvancedSensorCards(
      input({ rangefinderType: 100, flowType: 6, rangefinder: reportingRangefinder })
    )
    expect(cards.map((card) => card.id)).toEqual(['rangefinder', 'optical-flow'])
    expect(cards[0]?.state).toBe('reporting')
    expect(cards[1]?.state).toBe('silent')
  })

  it('drops just the unconfigured one', () => {
    const cards = buildAdvancedSensorCards(input({ rangefinderType: 100, flowType: 0 }))
    expect(cards.map((card) => card.id)).toEqual(['rangefinder'])
  })
})
