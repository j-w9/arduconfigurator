import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildOutputReviewDraftSummaries } from './output-review-draft-summaries'

// buildOutputReviewDraftSummaries only carries each entry through untouched and
// tags it; a minimal entry (just an id) is enough to assert grouping/order.
function entry(id: string): ParameterDraftEntry {
  return { id } as unknown as ParameterDraftEntry
}

describe('buildOutputReviewDraftSummaries', () => {
  it('flattens the four scopes in order with the right task id + group label', () => {
    const summaries = buildOutputReviewDraftSummaries({
      outputAssignmentDraftEntries: [entry('SERVO1_FUNCTION')],
      outputReviewDraftEntries: [entry('MOT_PWM_TYPE')],
      outputNotificationDraftEntries: [entry('NTF_LED_TYPES')],
      outputAdditionalDraftEntries: [entry('SERVO_GPIO_MASK')]
    })

    expect(summaries.map((summary) => [summary.taskId, summary.groupLabel, summary.entry.id])).toEqual([
      ['motor-setup', 'Motor setup', 'SERVO1_FUNCTION'],
      ['esc-protocol', 'ESC & protocol', 'MOT_PWM_TYPE'],
      ['peripherals', 'Peripherals & alerts', 'NTF_LED_TYPES'],
      ['peripherals', 'Additional output settings', 'SERVO_GPIO_MASK']
    ])
  })

  it('keeps every entry (no dedupe) and preserves within-scope order', () => {
    const summaries = buildOutputReviewDraftSummaries({
      outputAssignmentDraftEntries: [entry('A1'), entry('A2')],
      outputReviewDraftEntries: [],
      outputNotificationDraftEntries: [],
      outputAdditionalDraftEntries: []
    })
    expect(summaries).toHaveLength(2)
    expect(summaries.map((summary) => summary.entry.id)).toEqual(['A1', 'A2'])
    expect(summaries.every((summary) => summary.taskId === 'motor-setup')).toBe(true)
  })

  it('returns an empty list when all scopes are empty', () => {
    expect(
      buildOutputReviewDraftSummaries({
        outputAssignmentDraftEntries: [],
        outputReviewDraftEntries: [],
        outputNotificationDraftEntries: [],
        outputAdditionalDraftEntries: []
      })
    ).toEqual([])
  })
})
