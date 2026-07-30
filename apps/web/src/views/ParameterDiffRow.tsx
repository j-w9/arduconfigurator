// Shared row pieces for the two parameter-diff review surfaces (the Parameters
// tab's grids and the Snapshots restore preview).
//
// Scope note — deliberately NOT a single shared "diff row" component. The two
// CHANGED rows differ in substance, not decoration: the Parameters row carries a
// bulk-select checkbox and an inline editor so a staged value can be nudged in
// place, while the Snapshots row shows a read-only current→next pair with
// stage/drop. Collapsing those into one component means a prop per difference,
// which is harder to follow than the two straightforward blocks it replaces.
//
// What IS shared is extracted here: the identity cell every row renders
// identically, and the INVALID row, which really was near-duplicate markup on
// both sides — and is where the last divergence bug lived (one surface
// string-matched the validator's prose to decide whether Override applied while
// the other read the flag).

import type { ReactNode } from 'react'

import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'

export interface ParameterDiffIdentityProps {
  draft: ParameterDraftEntry
}

/** The `id` + human label cell, first column of every diff row on both surfaces. */
export function ParameterDiffIdentity({ draft }: ParameterDiffIdentityProps) {
  return (
    <span>
      <strong>{draft.id}</strong>
      <small>{draft.label}</small>
    </span>
  )
}

export interface ParameterDiffInvalidRowProps {
  draft: ParameterDraftEntry
  /** Row actions (Override / Drop). Supplied by the surface, since the handlers
   *  and their gating differ; the row shape does not.
   *
   *  Optional: the provisioning-profile preview lists blocked values with no
   *  per-row action at all. The wrapper is omitted entirely in that case rather
   *  than rendered empty, so the row does not occupy a fourth grid column it
   *  has no content for. */
  actions?: ReactNode
  /** Extra testid on the row itself, when a surface needs to target it. */
  testId?: string
}

/**
 * One invalid draft: what it is, the value that failed, and why.
 *
 * `rawValue` rather than a formatted number on purpose — an invalid draft may
 * not BE a number ("Enter a numeric value…"), so formatting it would either
 * throw away what the operator typed or render NaN.
 */
export function ParameterDiffInvalidRow({ draft, actions, testId }: ParameterDiffInvalidRowProps) {
  return (
    <div className="parameter-diff-item" data-testid={testId}>
      <ParameterDiffIdentity draft={draft} />
      <span className="parameter-diff-values">{draft.rawValue || 'Empty draft'}</span>
      <span className="parameter-diff-delta">{draft.reason ?? 'Invalid value'}</span>
      {actions ? <div className="parameter-diff-actions">{actions}</div> : null}
    </div>
  )
}
