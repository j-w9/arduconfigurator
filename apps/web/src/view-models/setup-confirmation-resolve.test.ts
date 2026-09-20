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

  it('keeps a confirmation for a section that defines no signature', () => {
    // This assertion used to expect the opposite, and it was encoding a
    // deadlock rather than protecting against one.
    //
    // buildSetupConfirmationSignatures only defines signatures for the Copter
    // section ids. The generic ids every other vehicle declares — 'sensors',
    // 'verify', 'drive', 'frame', 'controls' — have none, so dropping the
    // record on `signature === undefined` threw their sign-offs away the
    // instant they were made: the criterion stayed pending, the step could
    // never complete, and the sequential lock stranded the whole flow behind
    // it. A Plane could not get past step 3 of 8.
    //
    // `undefined` means "this section has no signature defined" (see the
    // input's own docs), not "the signature failed" — and a section with
    // nothing to compare against has nothing that can make its sign-off stale.
    expect(
      resolveSetupConfirmationRecord({
        record,
        signature: undefined,
        parameterSyncComplete: true
      })
    ).toEqual(record)
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
