// Resolving a stored guided-Setup confirmation against the live signature.
//
// A section's confirmation is pinned to a signature of the configuration it
// signed off (see setup-confirmation-signatures.ts). When the live signature
// stops matching, the sign-off no longer counts — that is what makes a stale
// confirmation stop hiding a changed airframe or a re-run calibration.
//
// The subtlety this exists to encode: those signatures are computed FROM
// PARAMETERS (INS_ACC_ID, INS_ACCOFFS_*, AHRS_TRIM_*, FRAME_CLASS, ...). While
// a freshly connected vehicle is still streaming its parameter table, none of
// them exist yet, so the live signature is a JSON blob full of `undefined` that
// cannot match anything ever stored. Reading that as "not confirmed" regressed
// EVERY section simultaneously and resumed the wizard at step 1 — the reported
// "Continue to Airframe every time I come back", along with a completed
// accelerometer calibration reading as never done.
//
// So: a mismatch only means something once the parameters the signature is
// derived from have actually arrived. Until then the last known state stands.
//
// This is safe rather than merely convenient — parameter writes are themselves
// gated on a complete sync, so a provisionally-trusted confirmation cannot
// authorise any action during the window in which it is trusted.

import type { SetupConfirmationRecord } from '../app-types'

export interface ResolveSetupConfirmationInputs {
  /** The stored confirmation for this section, if the operator ever signed it off. */
  record: SetupConfirmationRecord | undefined
  /** The signature derived from the CURRENT snapshot, or undefined if the
   *  section has no signature defined. */
  signature: string | undefined
  /** Whether the parameter table has finished syncing. False while a freshly
   *  connected vehicle is still streaming — the window in which every
   *  parameter-derived signature is meaningless. */
  parameterSyncComplete: boolean
}

/**
 * The stored confirmation if it still counts, otherwise undefined.
 *
 * Returns the record unvalidated while the parameter sync is incomplete: the
 * comparison it would otherwise be subjected to cannot succeed yet, and
 * failing it would silently discard the operator's progress.
 */
export function resolveSetupConfirmationRecord({
  record,
  signature,
  parameterSyncComplete
}: ResolveSetupConfirmationInputs): SetupConfirmationRecord | undefined {
  if (!record) {
    return undefined
  }

  // Parameters still arriving — the signature is not yet computable from real
  // values, so hold the last known state instead of invalidating it.
  if (!parameterSyncComplete) {
    return record
  }

  if (signature === undefined || record.signature !== signature) {
    return undefined
  }

  return record
}
