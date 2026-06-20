// Output-view staged/invalid draft summaries, grouped by task card.
//
// Part of the App.tsx view-model decomposition. Flattens the four Output-view
// draft-entry scopes (motor setup, ESC & protocol, peripherals, additional)
// into one labeled list tagged with the owning task card. Pure derivation
// lifted verbatim from the App.tsx useMemo. App.tsx keeps the same memo deps.
// Behavior-preserving.

import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import type { OutputTaskId } from '../app-types'

export interface OutputReviewDraftSummary {
  taskId: OutputTaskId
  groupLabel: string
  entry: ParameterDraftEntry
}

export interface OutputReviewDraftSummaryInputs {
  outputAssignmentDraftEntries: ParameterDraftEntry[]
  outputReviewDraftEntries: ParameterDraftEntry[]
  outputNotificationDraftEntries: ParameterDraftEntry[]
  outputAdditionalDraftEntries: ParameterDraftEntry[]
}

export function buildOutputReviewDraftSummaries(
  inputs: OutputReviewDraftSummaryInputs
): OutputReviewDraftSummary[] {
  const {
    outputAssignmentDraftEntries,
    outputReviewDraftEntries,
    outputNotificationDraftEntries,
    outputAdditionalDraftEntries
  } = inputs

  return [
      ...outputAssignmentDraftEntries.map((entry) => ({
        taskId: 'motor-setup' as const,
        groupLabel: 'Motor setup',
        entry
      })),
      ...outputReviewDraftEntries.map((entry) => ({
        taskId: 'esc-protocol' as const,
        groupLabel: 'ESC & protocol',
        entry
      })),
      ...outputNotificationDraftEntries.map((entry) => ({
        taskId: 'peripherals' as const,
        groupLabel: 'Peripherals & alerts',
        entry
      })),
      ...outputAdditionalDraftEntries.map((entry) => ({
        taskId: 'peripherals' as const,
        groupLabel: 'Additional output settings',
        entry
      }))
  ]
}
