import { describe, expect, it } from 'vitest'

import {
  bootloaderFlashOutcome,
  buildCanNodeMessages,
  canLogEntriesFromStatusTexts,
  canLogEntryFromValue,
  mergeCanNodeLogs,
  type CanNodeLogEntry
} from './can-node-messages'

const text = (s: string) => Array.from(new TextEncoder().encode(s))

describe('node messages', () => {
  it('reads a decoded LogMessage', () => {
    expect(canLogEntryFromValue({ level: { value: 2 }, source: text('GPS'), text: text('No fix ') }, 124, 5)).toEqual({
      atMs: 5,
      nodeId: 124,
      level: 'warning',
      source: 'GPS',
      text: 'No fix'
    })
    expect(canLogEntryFromValue({ level: { value: 1 }, source: [], text: [] }, 1, 1)).toBeUndefined()
  })

  it('folds repeats, puts warnings and errors first, hides debug unless asked, and filters', () => {
    const entries: CanNodeLogEntry[] = [
      { atMs: 1, nodeId: 124, level: 'info', source: '', text: 'Booted' },
      { atMs: 2, nodeId: 124, level: 'warning', source: '', text: 'No fix' },
      { atMs: 3, nodeId: 124, level: 'warning', source: '', text: 'No fix' },
      { atMs: 4, nodeId: 50, level: 'error', source: '', text: 'Overcurrent' },
      { atMs: 5, nodeId: 50, level: 'debug', source: '', text: 'stack 512' }
    ]
    const model = buildCanNodeMessages(entries)
    expect(model.attention.map((entry) => [entry.text, entry.count])).toEqual([
      ['Overcurrent', 1],
      ['No fix', 2]
    ])
    expect(model.info.map((entry) => entry.text)).toEqual(['Booted'])
    expect(buildCanNodeMessages(entries, { showDebug: true }).info).toHaveLength(2)
    expect(buildCanNodeMessages(entries, { nodeId: 50 }).total).toBe(1)
    expect(buildCanNodeMessages(entries, { filter: 'fix' }).total).toBe(2)
  })

  it('recognises AP_Periph\'s bootloader-flash answers', () => {
    expect(bootloaderFlashOutcome('Flash bootloader OK\n')).toMatchObject({ ok: true })
    expect(bootloaderFlashOutcome('Bootloader unchanged')).toMatchObject({ ok: true })
    expect(bootloaderFlashOutcome('Flash bootloader FAILED')).toMatchObject({ ok: false })
    expect(bootloaderFlashOutcome('Bootloader not signed')).toMatchObject({ ok: false })
    expect(bootloaderFlashOutcome('GPS: u-blox 1')).toBeUndefined()
  })
})

describe('lines the autopilot relays', () => {
  it('reads "CAN[n] text" status texts as node lines, once when the bus delivered them too', () => {
    const relayed = canLogEntriesFromStatusTexts([
      { severity: 'info', text: 'CAN[50] Bootloader unchanged', receivedAtMs: 2000 },
      { severity: 'warning', text: 'PreArm: Compass not calibrated', receivedAtMs: 2100 },
      { severity: 'info', text: 'CAN[124] GPS ok', receivedAtMs: 1000 }
    ])
    expect(relayed).toEqual([
      { atMs: 2000, nodeId: 50, level: 'info', source: '', text: 'Bootloader unchanged' },
      { atMs: 1000, nodeId: 124, level: 'info', source: '', text: 'GPS ok' }
    ])
    const fromBus = [{ atMs: 1100, nodeId: 124, level: 'debug' as const, source: '', text: 'GPS ok' }]
    const merged = mergeCanNodeLogs(fromBus, relayed)
    expect(merged.map((entry) => entry.text)).toEqual(['GPS ok', 'Bootloader unchanged'])
    expect(mergeCanNodeLogs(fromBus, relayed, 5000)).toBe(fromBus)
    expect(bootloaderFlashOutcome(merged[1].text)?.message).toMatch(/^Bootloader unchanged/)
  })
})
