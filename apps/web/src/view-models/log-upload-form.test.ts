import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { buildLogUploadFormModel } from './log-upload-form'

const TODAY = '2026-08-08'

function snapshot(): ConfiguratorSnapshot {
  return {
    vehicle: { vehicle: 'ArduCopter' },
    hardware: { board: { firmwareVersion: '4.7.0 (beta)', boardType: 5810 } }
  } as unknown as ConfiguratorSnapshot
}

function formFor(dateLabel: string) {
  return buildLogUploadFormModel({
    snapshot: snapshot(),
    log: { id: 3, nameLabel: '00000003.BIN', dateLabel },
    todayIso: TODAY
  })
}

describe('buildLogUploadFormModel flight date', () => {
  it('takes the date the log actually carries', () => {
    expect(formFor('2026-07-14 09:31').flightDate).toBe('2026-07-14')
  })

  it('falls back to today when the listing carries no date at all', () => {
    // MAVFTP listings have no timestamp, so the source shows a dash.
    expect(formFor('—').flightDate).toBe(TODAY)
  })

  it('rejects the FAT epoch a board with no clock stamps on its logs', () => {
    // A board that never got a GPS lock or a GCS time push writes 1980-01-01.
    // It is a well-formed date, so a shape check accepts it and files the
    // flight 46 years in the past.
    expect(formFor('1980-01-01 00:00').flightDate).toBe(TODAY)
  })

  it('rejects any other implausibly old stamp, not just the exact epoch', () => {
    expect(formFor('1980-06-12 13:00').flightDate).toBe(TODAY)
    expect(formFor('2000-01-01 00:00').flightDate).toBe(TODAY)
  })

  it('still accepts genuinely old flights from after ArduPilot existed', () => {
    // The guard must not throw away a real archived log the operator is
    // uploading deliberately.
    expect(formFor('2015-04-02 11:20').flightDate).toBe('2015-04-02')
  })
})

describe('buildLogUploadFormModel autofill', () => {
  it('attaches the vehicle, firmware and board so the log files correctly', () => {
    const form = formFor('2026-07-14 09:31')
    expect(form.metadata.vehicle).toBe('ArduCopter')
    expect(form.metadata.firmwareVersion).toBe('4.7.0 (beta)')
    expect(form.metadata.boardName).toContain('5810')
    expect(form.metadata.fileName).toBe('00000003.BIN')
    expect(form.metadata.onboardLogId).toBe(3)
  })

  it('names a log the FC gave no filename for, rather than sending a bare number', () => {
    const form = buildLogUploadFormModel({
      snapshot: snapshot(),
      log: { id: 7, dateLabel: '—' },
      todayIso: TODAY
    })
    expect(form.metadata.fileName).toBe('log-7.bin')
  })
})
