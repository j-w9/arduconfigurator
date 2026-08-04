import { describe, expect, it } from 'vitest'

import type { SetupConfirmationRecord } from '../app-types'
import { resolveSetupConfirmationRecord } from './setup-confirmation-resolve'

const record: SetupConfirmationRecord = {
  signature: '{"accId":123,"offsets":[1,2,3]}',
  confirmedAtMs: 1_700_000_000_000,
  outcome: 'complete'
}

describe('resolveSetupConfirmationRecord', () => {
  it('keeps a confirmation whose signature still matches', () => {
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: record.signature,
        parameterSyncComplete: true
      })
    ).toEqual(record)
  })

  it('drops a confirmation once the configuration it signed off has changed', () => {
    // The whole point of signatures: a re-run calibration or a changed airframe
    // must stop counting as reviewed.
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: '{"accId":456,"offsets":[9,9,9]}',
        parameterSyncComplete: true
      })
    ).toBeUndefined()
  })

  it('drops a confirmation for a section that has no signature at all', () => {
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: undefined,
        parameterSyncComplete: true
      })
    ).toBeUndefined()
  })

  it('returns nothing when the operator never confirmed the section', () => {
    expect(
      resolveSetupConfirmationRecord({
        record: undefined,
        signature: record.signature,
        parameterSyncComplete: true
      })
    ).toBeUndefined()
  })

  // The regression this module exists for. Mid-sync the signature is built from
  // parameters that have not arrived, so it can never match what was stored.
  // Invalidating on that mismatch regressed every section at once and resumed
  // the wizard at "Continue to Airframe" on every reconnect.
  it('holds the stored confirmation while parameters are still syncing', () => {
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: '{"accId":null,"offsets":[null,null,null]}',
        parameterSyncComplete: false
      })
    ).toEqual(record)
  })

  it('holds the stored confirmation mid-sync even with no signature yet', () => {
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: undefined,
        parameterSyncComplete: false
      })
    ).toEqual(record)
  })

  it('re-validates once the sync completes, so a genuine mismatch still drops', () => {
    const staleSignature = '{"accId":456,"offsets":[9,9,9]}'
    expect(
      resolveSetupConfirmationRecord({ record, signature: staleSignature, parameterSyncComplete: false })
    ).toEqual(record)
    expect(
      resolveSetupConfirmationRecord({ record, signature: staleSignature, parameterSyncComplete: true })
    ).toBeUndefined()
  })
})
