import { describe, expect, it } from 'vitest'

import { buildStaleLinkNotice } from './stale-link-notice'

const vehicle = {
  firmware: 'ArduPilot' as const,
  vehicle: 'ArduCopter' as const,
  systemId: 1,
  componentId: 1,
  armed: false,
  flightMode: 'Stabilize',
  systemStatus: 'standby' as const
}

const at = Date.UTC(2026, 6, 24, 12, 0, 0)

describe('buildStaleLinkNotice', () => {
  it('names the vehicle and flags an unfinished download as resumable', () => {
    const notice = buildStaleLinkNotice({ sinceMs: at, vehicle, downloaded: 120, total: 1320 })
    expect(notice.headline).toBe('Link lost — showing the last data received')
    expect(notice.detail).toContain('ArduCopter · 120/1320 parameters received (incomplete)')
    expect(notice.resumable).toBe(true)
    expect(notice.hint).toContain('resumes the download where it stopped')
  })

  it('does not promise a resume when the table had already finished', () => {
    const notice = buildStaleLinkNotice({ sinceMs: at, vehicle, downloaded: 1320, total: 1320 })
    expect(notice.detail).toContain('1320/1320 parameters received')
    expect(notice.detail).not.toContain('incomplete')
    expect(notice.resumable).toBe(false)
    expect(notice.hint).not.toContain('resumes the download')
  })

  it('omits an unknown vehicle rather than printing "Unknown"', () => {
    const notice = buildStaleLinkNotice({
      sinceMs: at,
      vehicle: { ...vehicle, vehicle: 'Unknown' },
      downloaded: 3,
      total: 10
    })
    expect(notice.detail).not.toContain('Unknown')
    expect(notice.detail).toMatch(/^3\/10 parameters received/)
  })

  it('avoids a bogus "0/0" when the FC never reported a count', () => {
    const notice = buildStaleLinkNotice({ sinceMs: at, vehicle, downloaded: 7, total: 0 })
    expect(notice.detail).toContain('7 parameters received')
    expect(notice.detail).not.toContain('/0')
    expect(notice.resumable).toBe(false)
  })

  it('singularises a lone parameter and survives a bogus timestamp', () => {
    const notice = buildStaleLinkNotice({ sinceMs: Number.NaN, vehicle, downloaded: 1, total: 0 })
    expect(notice.detail).toContain('1 parameter received')
    expect(notice.detail).toContain('link lost')
  })
})
