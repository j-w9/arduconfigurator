// Pure builder for the AI Assistant's parameter-change proposal card.
//
// Reuses the exact validation the manual Parameters diff grid uses
// (deriveParameterDraftEntries): each proposed value is fed through the same
// range / enum / not-present / no-op checks, so an AI proposal is held to the
// identical bar as a hand-typed edit. The model's per-change `reason` is merged
// in for display. No React, no runtime — unit-tested directly.

import type {
  ConfiguratorSnapshot,
  ParameterBatchWriteProgress,
  ParameterState
} from '@arduconfig/ardupilot-core'
import { deriveParameterDraftEntries, type ParameterDraftStatus } from '@arduconfig/ardupilot-core'
import type { ProposedChange } from '@arduconfig/ai-assistant'

export interface ProposalReviewEntry {
  id: string
  label: string
  unit?: string
  currentValue?: number
  nextValue?: number
  delta?: number
  status: ParameterDraftStatus
  /** Validation reason from the draft engine (why invalid / unchanged). */
  reason?: string
  /** The model's justification for this change, shown to the human. */
  why?: string
}

export interface ProposalReview {
  entries: ProposalReviewEntry[]
  stagedCount: number
  invalidCount: number
  unchangedCount: number
  /** True when there is at least one real change and nothing invalid — the
   *  same rule the manual grid uses (canApplyAllDraftParameters). */
  canApply: boolean
}

/** Validate + shape an AI proposal for display and apply-gating. */
export function buildProposalReview(
  parameters: readonly ParameterState[],
  changes: readonly ProposedChange[]
): ProposalReview {
  // Last write wins if the model lists a param twice; also carries the reason.
  const draftValues: Record<string, string> = {}
  const reasonById = new Map<string, string>()
  for (const change of changes) {
    draftValues[change.paramId] = String(change.value)
    if (change.reason) reasonById.set(change.paramId, change.reason)
  }

  const draftEntries = deriveParameterDraftEntries([...parameters], draftValues)
  const entries: ProposalReviewEntry[] = draftEntries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    unit: entry.definition?.unit,
    currentValue: entry.currentValue,
    nextValue: entry.nextValue,
    delta: entry.delta,
    status: entry.status,
    reason: entry.reason,
    why: reasonById.get(entry.id)
  }))

  const stagedCount = entries.filter((entry) => entry.status === 'staged').length
  const invalidCount = entries.filter((entry) => entry.status === 'invalid').length
  const unchangedCount = entries.filter((entry) => entry.status === 'unchanged').length

  return {
    entries,
    stagedCount,
    invalidCount,
    unchangedCount,
    canApply: stagedCount > 0 && invalidCount === 0
  }
}

/** A staged proposal through its lifecycle, owned by the hook and rendered by
 *  the view. Lives here (not in the hook) so the presentational view can consume
 *  it without importing the stateful hook. */
export interface PendingProposal {
  summary?: string
  changes: ProposedChange[]
  review: ProposalReview
  status: 'pending' | 'applying' | 'applied' | 'error'
  progress?: ParameterBatchWriteProgress
  result?: { applied: number; unconfirmed: number; rolledBack: number }
  error?: string
}

/** Why a write can't happen right now, independent of the proposal's validity.
 *  Mirrors the runtime's own preconditions so Apply is disabled proactively
 *  (runtime.setParameters also enforces these and we catch+report). */
export function resolveWriteBlockReason(inputs: {
  connectionKind: ConfiguratorSnapshot['connection']['kind']
  armed: boolean
  syncStatus: ConfiguratorSnapshot['parameterStats']['status']
}): string | undefined {
  if (inputs.connectionKind !== 'connected') {
    return 'Connect a vehicle before applying changes.'
  }
  if (inputs.armed) {
    return 'Vehicle is armed — disarm before applying parameter changes.'
  }
  if (inputs.syncStatus !== 'complete') {
    return 'Wait for the parameter download to finish before applying.'
  }
  return undefined
}
