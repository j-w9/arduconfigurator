import { describe, expect, it } from 'vitest'

import { bootloaderFlashOutcome, buildCanNodeMessages, canLogEntryFromValue, type CanNodeLogEntry } from './can-node-messages'

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
