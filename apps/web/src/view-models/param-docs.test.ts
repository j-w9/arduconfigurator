import { describe, expect, it } from 'vitest'

import { ARDUPILOT_PARAMETER_DOCS_URL, parameterWikiUrl } from './param-docs'

describe('parameterWikiUrl', () => {
  // These expectations were checked against the live parameters.html: each of
  // these short anchors exists on the page. If ArduPilot ever changes the
  // Sphinx anchor scheme, this is the test that should fail first.
  it('derives the short Sphinx anchor for real parameter ids', () => {
    expect(parameterWikiUrl('ATC_INPUT_TC')).toBe(`${ARDUPILOT_PARAMETER_DOCS_URL}#atc-input-tc`)
    expect(parameterWikiUrl('BATT_MONITOR')).toBe(`${ARDUPILOT_PARAMETER_DOCS_URL}#batt-monitor`)
    expect(parameterWikiUrl('COMPASS_DISBLMSK')).toBe(`${ARDUPILOT_PARAMETER_DOCS_URL}#compass-disblmsk`)
  })

  it('keeps digits in place for indexed families', () => {
    expect(parameterWikiUrl('SERVO1_FUNCTION')).toBe(`${ARDUPILOT_PARAMETER_DOCS_URL}#servo1-function`)
    expect(parameterWikiUrl('INS_HNTC2_MODE')).toBe(`${ARDUPILOT_PARAMETER_DOCS_URL}#ins-hntc2-mode`)
  })

  it('falls back to the bare docs page rather than inventing an anchor', () => {
    // Composed / non-ArduPilot-shaped ids: no fragment is better than a wrong one.
    expect(parameterWikiUrl('')).toBe(ARDUPILOT_PARAMETER_DOCS_URL)
    expect(parameterWikiUrl('uavcan.node.id')).toBe(ARDUPILOT_PARAMETER_DOCS_URL)
    expect(parameterWikiUrl('NET_IPADDR0 / NET_IPADDR1')).toBe(ARDUPILOT_PARAMETER_DOCS_URL)
  })

  it('never emits a URL off the ArduPilot docs origin', () => {
    for (const id of ['ATC_INPUT_TC', 'javascript:alert(1)', '../../evil']) {
      expect(parameterWikiUrl(id).startsWith(ARDUPILOT_PARAMETER_DOCS_URL)).toBe(true)
    }
  })
})
