import { StatusBadge } from '@arduconfig/ui-kit'
import { toneForScopedDraftReview } from '../tone-helpers'

export interface DraftReviewBadgeProps {
  staged: number
  invalid: number
}

/** Scoped draft-review pill: "N invalid" / "N staged", and nothing at all when the card is in sync. */
export function DraftReviewBadge({ staged, invalid }: DraftReviewBadgeProps) {
  if (staged === 0 && invalid === 0) {
    return null
  }
  return (
    <StatusBadge tone={toneForScopedDraftReview(staged, invalid)}>
      {invalid > 0 ? `${invalid} invalid` : `${staged} staged`}
    </StatusBadge>
  )
}
