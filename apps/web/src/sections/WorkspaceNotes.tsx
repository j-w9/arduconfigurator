// The workspace-main notes strip, extracted from App.tsx as part of its
// decomposition. A dumb presentational component (the established sections/
// pattern): it imports no runtime / transport / MAVLink modules — App passes
// the session/follow-up notices, draft/mode flags, and the snapshot, plus the
// two guided-action callbacks. Renders null when there is nothing to show, so
// the caller no longer needs the outer visibility conditional.
//
// Behavior-neutral lift of the original inline JSX: same markup, same
// data-testid, same class names, same copy, same disabled conditions.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { buttonStyle } from '@arduconfig/ui-kit'

import { canRunGuidedAction } from '../guided-action-helpers'
import type { ParameterFollowUp, ParameterNotice } from '../hooks/use-parameter-feedback'
import { buildStaleLinkNotice } from '../view-models/stale-link-notice'

export interface WorkspaceNotesProps {
  snapshot: ConfiguratorSnapshot
  sessionNotice: ParameterNotice | undefined
  /** Reconnect action for the stale-link banner. */
  onReconnect?: () => void
  parameterFollowUp: ParameterFollowUp | undefined
  isExpertMode: boolean
  stagedParameterDraftCount: number
  busyAction: string | undefined
  onRebootAutopilot: () => void
  onPullParameters: () => void
}

export function WorkspaceNotes({
  snapshot,
  sessionNotice,
  onReconnect,
  parameterFollowUp,
  isExpertMode,
  stagedParameterDraftCount,
  busyAction,
  onRebootAutopilot,
  onPullParameters
}: WorkspaceNotesProps) {
  const staleLink = snapshot.staleLink

  if (!staleLink && !sessionNotice && !parameterFollowUp && !(!isExpertMode && stagedParameterDraftCount > 0)) {
    return null
  }

  return (
    <div className="workspace-main__notes">
      {/* Everything below the banner is a snapshot of a link that has dropped.
          It has to be unmissable: values that look live but are minutes old are
          how someone flies a stale config. */}
      {staleLink ? (
        (() => {
          const notice = buildStaleLinkNotice(staleLink)
          return (
            <div className="workspace-note workspace-note--stale" data-testid="stale-link-banner" role="status">
              <div className="workspace-note--stale__headline">
                <span className="workspace-note--stale__dot" aria-hidden="true" />
                <strong>{notice.headline}</strong>
              </div>
              <p>{notice.detail}</p>
              <small>{notice.hint}</small>
              {onReconnect ? (
                <div className="button-row">
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    data-testid="stale-link-reconnect"
                    onClick={onReconnect}
                  >
                    Reconnect
                  </button>
                </div>
              ) : null}
            </div>
          )
        })()
      ) : null}
      {sessionNotice ? (
        <div className="workspace-note workspace-note--danger" data-testid="session-connection-notice">
          <strong>Connection issue</strong>
          <p>{sessionNotice.text}</p>
        </div>
      ) : null}
      {parameterFollowUp ? (
        <div className="workspace-note workspace-note--warning">
          <strong>{parameterFollowUp.requiresReboot ? 'Reboot required' : 'Refresh required'}</strong>
          <p>
            {parameterFollowUp.text}
            {parameterFollowUp.requiresReboot ? ' One or more changes only take effect after a reboot — reboot now?' : ''}
          </p>
          {snapshot.connection.kind !== 'connected' ? (
            <small>Reconnect from the header session strip to continue.</small>
          ) : (
            <div className="button-row">
              {parameterFollowUp.requiresReboot ? (
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  data-testid="workspace-note-reboot"
                  onClick={onRebootAutopilot}
                  disabled={busyAction !== undefined || !canRunGuidedAction(snapshot, 'reboot-autopilot')}
                >
                  Reboot now
                </button>
              ) : null}
              <button
                type="button"
                style={buttonStyle()}
                onClick={onPullParameters}
                disabled={parameterFollowUp.requiresReboot || busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')}
              >
                Pull Parameters
              </button>
            </div>
          )}
        </div>
      ) : null}
      {!isExpertMode && stagedParameterDraftCount > 0 ? (
        <div className="workspace-note">
          <strong>Expert drafts hidden in Basic mode</strong>
          <p>Switch to Expert if you need to review or apply staged advanced parameter changes.</p>
        </div>
      ) : null}
    </div>
  )
}
