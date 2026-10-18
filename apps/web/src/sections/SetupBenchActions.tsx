// Vehicle actions on Status & Info: Sync Parameters, Reboot (and whatever the
// host adds, e.g. Flash firmware) as large buttons and nothing else -- the
// button says what it does and what it is doing ("Syncing…"). A line appears
// under one only when it failed; why a button is greyed out is its tooltip.
// Presentational: the action list, snapshot and busy state are passed in;
// dispatch is onAction.

import type { ReactElement, ReactNode } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { GuidedActionId } from '@arduconfig/param-metadata'

import { guidedActionBlockingReason, setupActionBusyReason } from '../guided-action-helpers'

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
  /** Buttons after the guided actions (a link to another tab, say). */
  extra?: ReactNode
}

/** Under Sync Parameters: how far the sync got, and the parameter count. */
function ParameterSyncLine({ snapshot }: { snapshot: ConfiguratorSnapshot }): ReactNode {
  const { status, downloaded, total } = snapshot.parameterStats
  if (total <= 0 && downloaded <= 0) return null
  const count = `${downloaded}/${total} parameters`
  return (
    <p className={`setup-bench__status${status === 'complete' ? ' is-complete' : ''}`} data-testid="status-bench-sync-status">
      {status === 'complete' ? `Complete · ${count}` : count}
    </p>
  )
}

/** The button's own words: the action, or what it is doing right now. */
function benchButtonLabel(action: SetupBenchAction, status: string, busy: boolean): string {
  const working = busy || status === 'requested' || status === 'running'
  if (action.actionId === 'request-parameters') return working ? 'Syncing…' : 'Sync Parameters'
  if (action.actionId === 'reboot-autopilot') return working ? 'Rebooting…' : 'Reboot'
  return working ? `${action.title}…` : action.title
}

export function SetupBenchActions({ actions, snapshot, busyAction, onAction, extra }: SetupBenchActionsProps): ReactElement {
  return (
    <div className="setup-bench__buttons">
      {actions.map((action) => {
        const actionState = snapshot.guidedActions[action.actionId]
        const actionDisabledReason =
          setupActionBusyReason(busyAction, action.actionId, action.title) ?? guidedActionBlockingReason(snapshot, action.actionId)
        const failed = actionState.status === 'failed'
        return (
          <div key={action.actionId} className="setup-bench__button-cell">
            <button
              type="button"
              className={`setup-bench__button${failed ? ' is-failed' : ''}`}
              style={buttonStyle(action.actionId === 'reboot-autopilot' ? 'secondary' : 'primary')}
              onClick={() => onAction(action.actionId)}
              disabled={actionDisabledReason !== undefined}
              title={actionDisabledReason ?? action.copy}
              data-testid={`status-bench-${action.actionId}`}
            >
              {benchButtonLabel(action, actionState.status, busyAction === action.actionId)}
            </button>
            {failed && actionState.summary ? (
              <p className="setup-bench__failed">{actionState.summary}</p>
            ) : action.actionId === 'request-parameters' ? (
              <ParameterSyncLine snapshot={snapshot} />
            ) : null}
          </div>
        )
      })}
      {extra}
    </div>
  )
}
