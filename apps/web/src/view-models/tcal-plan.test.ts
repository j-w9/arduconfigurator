import { describe, expect, it } from 'vitest'

import { latestTcalMessage, tcalOutcome, tcalStopWrites, tcalStartWrites, tcalTargetCheck } from './tcal-plan'

describe('tcalStartWrites', () => {
  it('writes every target before any enable, and the baro enable last', () => {
    expect(tcalStartWrites([1, 2], 45, true).map((w) => `${w.paramId}=${w.paramValue}`)).toEqual([
      'INS_TCAL1_TMAX=45',
      'INS_TCAL2_TMAX=45',
      'INS_TCAL1_ENABLE=2',
      'INS_TCAL2_ENABLE=2',
      'TCAL_ENABLED=2'
    ])
  })

  it('never writes TMIN — the learn overwrites it with where it started', () => {
    expect(tcalStartWrites([1, 2, 3], 50, false).some((w) => w.paramId.endsWith('TMIN'))).toBe(false)
  })

  it('stop keeps what is saved (1), or turns thermal cal off (0)', () => {
    expect(tcalStopWrites([1, 3], 'keep')).toEqual([
      { paramId: 'INS_TCAL1_ENABLE', paramValue: 1 },
      { paramId: 'INS_TCAL3_ENABLE', paramValue: 1 }
    ])
    expect(tcalStopWrites([2], 'off')).toEqual([{ paramId: 'INS_TCAL2_ENABLE', paramValue: 0 }])
  })
})

describe('tcalTargetCheck', () => {
  it('blocks a target less than 10 °C above the board', () => {
    expect(tcalTargetCheck(40, 33).problem).toContain('at least 10 °C of rise')
    expect(tcalTargetCheck(45, 33).problem).toBeUndefined()
  })

  it('blocks a target outside the param range', () => {
    expect(tcalTargetCheck(90, 20).problem).toBeDefined()
    expect(tcalTargetCheck(Number.NaN, 20).problem).toBeDefined()
  })

  it('a high target is a note, not a block: it ends when warming stalls', () => {
    const check = tcalTargetCheck(70, 25)
    expect(check.problem).toBeUndefined()
    expect(check.note).toContain('10 minutes after the temperature stops rising')
  })
})

describe('latestTcalMessage', () => {
  it('finds the newest TCAL line in the newest-first list', () => {
    const found = latestTcalMessage([
      { severity: 'info', text: 'Parameter X updated.' },
      { severity: 'warning', text: 'TCAL[1]: completed calibration tmin=24.0 tmax=45.0' },
      { severity: 'warning', text: 'TCAL[1]: started calibration t=24.0C tmax=45.0C' }
    ])
    expect(found?.text).toContain('completed')
  })
})

describe('tcalOutcome', () => {
  const entry = (text: string) => ({ severity: 'warning' as const, text, receivedAtMs: 0 })
  it('reads finished from the completion message once nothing is learning', () => {
    expect(tcalOutcome([entry('TCAL[1]: completed calibration tmin=36.1 tmax=75.0')], false)).toBe('finished')
  })
  it('reads failed from a failed fit', () => {
    expect(tcalOutcome([entry('TCAL[2]: failed fit')], false)).toBe('failed')
  })
  it('says nothing while an IMU is still learning', () => {
    expect(tcalOutcome([entry('TCAL[1]: completed calibration tmin=36.1 tmax=75.0')], true)).toBeUndefined()
  })
  it('says nothing for a start message or no message', () => {
    expect(tcalOutcome([entry('TCAL[1]: started calibration t=30.0C tmax=75.0C')], false)).toBeUndefined()
    expect(tcalOutcome([], false)).toBeUndefined()
  })
})
