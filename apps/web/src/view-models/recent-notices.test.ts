import { describe, expect, it } from 'vitest'

import { buildRecentNotices } from './recent-notices'

describe('buildRecentNotices', () => {
  it('coalesces identical messages into one row with a count', () => {
    const model = buildRecentNotices([
      { severity: 'warning', text: 'Bad AHRS' },
      { severity: 'warning', text: 'Bad AHRS' },
      { severity: 'warning', text: 'Bad AHRS' }
    ])
    expect(model.distinctCount).toBe(1)
    expect(model.totalCount).toBe(3)
    const notice = model.groups[0].notices[0]
    expect(notice).toMatchObject({ text: 'Bad AHRS', count: 3 })
  })

  it('keeps same text at different severities as distinct rows', () => {
    const model = buildRecentNotices([
      { severity: 'info', text: 'GPS' },
      { severity: 'warning', text: 'GPS' }
    ])
    expect(model.distinctCount).toBe(2)
  })

  it('splits into Warnings & Critical (warning+error) and Info groups', () => {
    const model = buildRecentNotices([
      { severity: 'info', text: 'EKF ready' },
      { severity: 'warning', text: 'Low battery' },
      { severity: 'error', text: 'Compass fail' }
    ])
    const attention = model.groups.find((group) => group.key === 'attention')
    const info = model.groups.find((group) => group.key === 'info')
    expect(attention?.label).toBe('Warnings & Critical')
    expect(attention?.tone).toBe('danger') // an error is present
    expect(attention?.notices.map((n) => n.text)).toEqual(['Compass fail', 'Low battery']) // error first
    expect(info?.notices.map((n) => n.text)).toEqual(['EKF ready'])
    // Attention group is listed before Info.
    expect(model.groups[0].key).toBe('attention')
  })

  it('orders coalesced notices by recency within a severity', () => {
    const model = buildRecentNotices([
      { severity: 'warning', text: 'older', receivedAtMs: 100 },
      { severity: 'warning', text: 'newer', receivedAtMs: 200 }
    ])
    expect(model.groups[0].notices.map((n) => n.text)).toEqual(['newer', 'older'])
  })

  it('is empty (no groups) for no entries', () => {
    const model = buildRecentNotices([])
    expect(model.groups).toEqual([])
    expect(model.distinctCount).toBe(0)
    expect(model.tone).toBe('neutral')
  })

  it('overall tone is warning when only warnings are present', () => {
    const model = buildRecentNotices([{ severity: 'warning', text: 'x' }])
    expect(model.tone).toBe('warning')
  })
})
