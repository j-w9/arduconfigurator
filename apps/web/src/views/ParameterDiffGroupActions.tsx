// Per-group actions on a parameter-diff group header, shared by the Parameters
// tab's review grids and the Snapshots restore preview.
//
// Both surfaces render the same group header — title, count, then stage/drop
// buttons pinned to the trailing edge — and both had their own copy of that
// markup, its testids, and its disabled logic. Sharing it keeps the two review
// surfaces behaving identically, which matters because an operator moves between
// them doing the same job.
//
// Dumb presentational component: it takes labels and callbacks and owns no state.

import type { ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

export interface ParameterDiffGroupAction {
  label: string
  /** Appended to `parameter-diff-` for the data-testid. */
  testId: string
  onClick: () => void
  disabled?: boolean
  title?: string
  tone?: 'primary' | 'secondary'
}

export interface ParameterDiffGroupActionsProps {
  actions: readonly ParameterDiffGroupAction[]
}

export function ParameterDiffGroupActions({ actions }: ParameterDiffGroupActionsProps): ReactElement | null {
  const visible = actions.filter((action) => action !== undefined)
  if (visible.length === 0) {
    return null
  }

  return (
    <div className="parameter-diff-actions parameter-diff-actions--group">
      {visible.map((action) => (
        <button
          key={action.testId}
          type="button"
          data-testid={action.testId}
          style={buttonStyle(action.tone)}
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
