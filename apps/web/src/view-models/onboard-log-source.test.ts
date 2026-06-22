import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot, MavftpDirectoryEntry } from '@arduconfig/ardupilot-core'

import {
  mavftpEntriesToLogItems,
  parseMavftpLogId,
  selectOnboardLogSource
} from './onboard-log-source'

function snapshotWithFtp(ftpSupported: boolean | undefined): ConfiguratorSnapshot {
  return {
    hardware: { board: ftpSupported === undefined ? undefined : { ftpSupported } }
  } as unknown as ConfiguratorSnapshot
}

function entry(name: string, sizeBytes?: number): MavftpDirectoryEntry {
  return { name, path: `/APM/LOGS/${name}`, kind: 'file', sizeBytes }
}

describe('parseMavftpLogId', () => {
  it('reads the zero-padded log number from the filename', () => {
    expect(parseMavftpLogId('00000007.BIN', 0)).toBe(7)
    expect(parseMavftpLogId('00000042.BIN', 0)).toBe(42)
  })

  it('handles short un-padded names', () => {
    expect(parseMavftpLogId('3.BIN', 9)).toBe(3)
  })

  it('falls back to a 1-based index when there are no leading digits', () => {
    expect(parseMavftpLogId('LOG.BIN', 4)).toBe(5)
  })
})

describe('selectOnboardLogSource', () => {
  it('prefers MAVFTP when the board reports FTP support', () => {
    expect(selectOnboardLogSource(snapshotWithFtp(true))).toBe('mavftp')
  })

  it('falls back to MAVLink when FTP is unsupported or unknown', () => {
    expect(selectOnboardLogSource(snapshotWithFtp(false))).toBe('mavlink')
    expect(selectOnboardLogSource(snapshotWithFtp(undefined))).toBe('mavlink')
  })
})

describe('mavftpEntriesToLogItems', () => {
  it('maps entries to log items sorted by parsed id and carries path + name', () => {
    const items = mavftpEntriesToLogItems([entry('00000002.BIN', 528), entry('00000001.BIN', 600)])
    expect(items.map((item) => item.log.id)).toEqual([1, 2])
    expect(items[0]).toEqual({
      log: { id: 1, sizeBytes: 600, timeUtc: 0 },
      path: '/APM/LOGS/00000001.BIN',
      name: '00000001.BIN'
    })
  })

  it('defaults a missing size to 0', () => {
    const [item] = mavftpEntriesToLogItems([entry('00000001.BIN')])
    expect(item.log.sizeBytes).toBe(0)
  })

  it('dedupes an entry repeated across a listing pagination boundary', () => {
    // Real SITL repeated the first entry across a chunk boundary; keep one.
    const items = mavftpEntriesToLogItems([
      entry('00000001.BIN', 430080),
      entry('00000001.BIN', 430080),
      entry('00000002.BIN', 528384)
    ])
    expect(items.map((item) => item.path)).toEqual(['/APM/LOGS/00000001.BIN', '/APM/LOGS/00000002.BIN'])
  })
})
