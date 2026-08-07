import { describe, expect, it } from 'vitest'

import {
  WIKI_PARAMETER_FIRMWARE,
  WIKI_PARAMETER_QUERY_KEY,
  WIKI_PARAMETER_REFERENCE_URL,
  parameterWikiUrl,
} from './param-docs'

describe('parameterWikiUrl', () => {
  // The other half of this contract is asserted against the REAL generated
  // reference in tests/wiki-parameter-reference.test.mjs: that
  // parameters/index.html is a page the generator emits, that the search script
  // reads this query key, and that an exact name resolves to a group page and
  // an anchor that both exist. This file pins the app-side derivation only.
  it('addresses a parameter by name against the reference', () => {
    expect(parameterWikiUrl('ATC_INPUT_TC')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=ATC_INPUT_TC`)
    expect(parameterWikiUrl('BATT_MONITOR')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=BATT_MONITOR`)
    expect(parameterWikiUrl('COMPASS_DISBLMSK')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=COMPASS_DISBLMSK`)
  })

  it('keeps digits in place for indexed families', () => {
    expect(parameterWikiUrl('SERVO1_FUNCTION')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=SERVO1_FUNCTION`)
    expect(parameterWikiUrl('INS_HNTC2_MODE')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=INS_HNTC2_MODE`)
  })

  it('names parameters whose family page is NOT derivable from the name', () => {
    // The reason the link is name-addressed rather than page-addressed: Copter's
    // top-level parameters all live on group-copter, and ARSPD_ lands on the
    // suffixed group-arspd-2 because ARSPD took group-arspd first. Neither is
    // recoverable from the id, so the app must not try.
    expect(parameterWikiUrl('ACRO_RP_EXPO')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=ACRO_RP_EXPO`)
    expect(parameterWikiUrl('ARSPD_TYPE')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=ARSPD_TYPE`)
  })

  it('falls back to the bare reference rather than inventing a lookup', () => {
    // Composed / non-ArduPilot-shaped ids: landing on the reference is better
    // than sending the search page after a name that cannot exist.
    expect(parameterWikiUrl('')).toBe(WIKI_PARAMETER_REFERENCE_URL)
    expect(parameterWikiUrl('uavcan.node.id')).toBe(WIKI_PARAMETER_REFERENCE_URL)
    expect(parameterWikiUrl('NET_IPADDR0 / NET_IPADDR1')).toBe(WIKI_PARAMETER_REFERENCE_URL)
    // A parameter the reference simply doesn't carry (fork-only) still gets a
    // well-formed link — the reference itself reports the miss, and never a
    // broken anchor.
    expect(parameterWikiUrl('OSD_MSG_ABBR')).toBe(`${WIKI_PARAMETER_REFERENCE_URL}?param=OSD_MSG_ABBR`)
  })

  it('never emits a URL off the wiki reference page', () => {
    for (const id of ['ATC_INPUT_TC', 'javascript:alert(1)', '../../evil', 'A?x=1#y']) {
      expect(parameterWikiUrl(id).startsWith(WIKI_PARAMETER_REFERENCE_URL)).toBe(true)
    }
    // Query-encoded, so a hostile id can neither add a parameter nor a fragment.
    expect(parameterWikiUrl('A%26b')).toBe(WIKI_PARAMETER_REFERENCE_URL)
  })

  it('states the firmware the reference documents', () => {
    // Surfaced in the link label so a 4.6 operator is told before the click, not
    // after. tests/wiki-parameter-reference.test.mjs pins it to the generator.
    expect(WIKI_PARAMETER_FIRMWARE).toBe('ArduCopter 4.7')
    expect(WIKI_PARAMETER_QUERY_KEY).toBe('param')
  })
})
