// Setup-bench action strip — the guided-action cards (Pull Parameters,
// Reboot) at the top of the Status & Info overview, each with its live
// status badge and gate/busy blocking reason.
//
// Extracted verbatim from the overviewSlot JSX in App.tsx as part of the
// setup view decomposition. Purely presentational: the action list, snapshot,
// and busy state are passed in; dispatch is onAction. Behavior-preserving.

import type { ReactElement } from 'react'

import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { GuidedActionId } from '@arduconfig/param-metadata'

import { guidedActionBlockingReason, guidedActionButtonLabel, setupActionBusyReason } from '../guided-action-helpers'

export interface SetupBenchAction {
  actionId: GuidedActionId
  title: string
  copy: string
}

export interface SetupBenchActionsProps {
  actions: ReadonlyArray<SetupBenchAction>
  snapshot: ConfiguratorSnapshot
  busyAction: string | undefined
  onAction: (actionId: GuidedActionId) => void
}

export function SetupBenchActions({ actions, snapshot, busyAction, onAction }: SetupBenchActionsProps): ReactElement {
  return (
    <div className="setup-bench__actions">
      {actions.map((action) => {
        const actionState = snapshot.guidedActions[action.actionId]
        const actionGateReason = guidedActionBlockingReason(snapshot, action.actionId)
        const actionBusyReason = setupActionBusyReason(busyAction, action.actionId, action.title)
        const actionDisabledReason = actionBusyReason ?? actionGateReason
        const actionEnabled = actionDisabledReason === undefined
        const actionTone =
          actionState.status === 'failed'
            ? 'danger'
            : actionState.status === 'succeeded'
              ? 'success'
              : actionState.status === 'requested' || actionState.status === 'running'
                ? 'warning'
                : 'neutral'

        return (
          <article
            key={action.actionId}
            className={`setup-bench-action${
              actionState.status === 'failed'
                ? ' is-danger'
                : actionState.status === 'succeeded'
                  ? ' is-success'
                  : actionState.status === 'requested' || actionState.status === 'running'
                    ? ' is-active'
                    : ''
            }`}
          >
            <div className="setup-bench-action__button">
              <button
                type="button"
                style={
                  actionEnabled
                    ? buttonStyle(action.actionId === 'reboot-autopilot' ? 'secondary' : 'primary')
                    : {
                        ...buttonStyle('secondary'),
                        opacity: 0.62,
                        cursor: 'not-allowed'
                      }
                }
                onClick={() => onAction(action.actionId)}
                disabled={!actionEnabled}
                title={actionDisabledReason}
              >
                {guidedActionButtonLabel(action.actionId, snapshot, busyAction)}
              </button>
            </div>
            <div className="setup-bench-action__copy">
              <strong>{action.title}</strong>
              <p>{actionState.summary ?? action.copy}</p>
              {actionState.status === 'idle' && actionDisabledReason ? (
                <p className="setup-bench-action__blocked-reason">{actionDisabledReason}</p>
              ) : null}
            </div>
            <div className="setup-bench-action__status">
              <StatusBadge tone={actionState.status === 'idle' && actionDisabledReason ? 'warning' : actionTone}>
                {actionState.status === 'idle' && actionDisabledReason ? 'blocked' : actionState.status}
              </StatusBadge>
            </div>
          </article>
        )
      })}
    </div>
  )
}
