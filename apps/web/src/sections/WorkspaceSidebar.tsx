// The workspace sidebar (tab rail), extracted from App.tsx as part of its
// decomposition. A dumb presentational component (the established sections/
// pattern): it imports no runtime / transport / MAVLink modules — App computes
// the view model (connection/transport label, the active-baseline drift
// summary, the visible nav descriptors) and passes plain props + an
// onSelectView callback. Only the snapshot-diff *counts* are needed here, so
// App passes numbers rather than the entry arrays.
//
// Behavior-neutral lift of the original inline JSX: same markup, same
// data-testids, same class names, same copy, same conditionals.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { AppViewId } from '@arduconfig/param-metadata'
import { StatusBadge } from '@arduconfig/ui-kit'

import type { AppViewDescriptor } from '../app-types'
import type { TransportMode } from '../hooks/use-transport-selection'
import { formatSnapshotTimestamp } from '../library-helpers'
import { viewMonogram } from '../setup-format-helpers'
import type { SavedParameterSnapshot } from '../snapshot-library'

export interface WorkspaceSidebarProps {
  snapshot: ConfiguratorSnapshot
  transportMode: TransportMode
  rememberedSerialPortLabel: string | undefined
  websocketUrl: string
  webSerialSupported: boolean
  selectedSnapshot: SavedParameterSnapshot | undefined
  selectedSnapshotInvalidCount: number
  selectedSnapshotChangedCount: number
  selectedSnapshotRebootSensitiveCount: number
  savedSnapshotCount: number
  visibleAppViews: readonly AppViewDescriptor[]
  activeViewId: AppViewId
  onSelectView: (id: AppViewId) => void
}

export function WorkspaceSidebar({
  snapshot,
  transportMode,
  rememberedSerialPortLabel,
  websocketUrl,
  webSerialSupported,
  selectedSnapshot,
  selectedSnapshotInvalidCount,
  selectedSnapshotChangedCount,
  selectedSnapshotRebootSensitiveCount,
  savedSnapshotCount,
  visibleAppViews,
  activeViewId,
  onSelectView
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar__shell">
        <div className="workspace-tabrail__header">
          <span className="workspace-tabrail__eyebrow">Connected Tabs</span>
          <strong>{snapshot.connection.kind === 'connected' ? snapshot.vehicle?.vehicle ?? 'Vehicle' : 'Disconnected'}</strong>
          <small>
            {transportMode === 'web-serial' && rememberedSerialPortLabel
              ? rememberedSerialPortLabel
              : transportMode === 'websocket'
                ? websocketUrl
                : transportMode === 'demo'
                  ? 'Demo transport (Copter)'
                  : transportMode === 'demo-plane'
                    ? 'Demo transport (Plane)'
                  : webSerialSupported
                    ? 'Serial transport ready'
                    : 'Serial transport unavailable'}
          </small>
        </div>

        <details className="baseline-summary">
          <summary className="baseline-summary__header">
            <div>
              <strong>Active Baseline</strong>
              <span className="baseline-summary__text" data-testid="active-baseline-label">
                {selectedSnapshot ? selectedSnapshot.label : 'No baseline selected'}
              </span>
            </div>
            <StatusBadge tone={selectedSnapshotInvalidCount > 0 ? 'danger' : selectedSnapshotChangedCount > 0 ? 'warning' : 'neutral'}>
              {selectedSnapshotInvalidCount > 0
                ? `${selectedSnapshotInvalidCount} invalid`
                : selectedSnapshotChangedCount > 0
                  ? `${selectedSnapshotChangedCount} diff`
                  : selectedSnapshot
                    ? 'matched'
                    : `${savedSnapshotCount} saved`}
            </StatusBadge>
          </summary>
          <div className="baseline-summary__body">
          <small className="baseline-summary__desc">
            {selectedSnapshot
              ? 'Drift tracking stays visible across every tab.'
              : 'Capture or select a snapshot to track configuration drift.'}
          </small>
          <div className="baseline-summary__metrics">
            <article>
              <span>Saved</span>
              <strong>{savedSnapshotCount}</strong>
            </article>
            <article>
              <span>Drift</span>
              <strong>{selectedSnapshotChangedCount}</strong>
            </article>
            <article>
              <span>Reboot</span>
              <strong>{selectedSnapshotRebootSensitiveCount}</strong>
            </article>
            <article>
              <span>Status</span>
              <strong>{selectedSnapshot ? (selectedSnapshotChangedCount > 0 ? 'Restore' : 'Synced') : 'Idle'}</strong>
            </article>
          </div>
          <p className="baseline-summary__note">
            {selectedSnapshot
              ? `Captured ${formatSnapshotTimestamp(selectedSnapshot.capturedAt)}.`
              : 'Open Snapshots to capture a known-good baseline before larger changes.'}
          </p>
          </div>
        </details>

        <nav className="workspace-nav workspace-nav--flat" aria-label="Configurator tabs">
          {visibleAppViews.map((view) => (
            <button
              key={view.id}
              type="button"
              data-testid={`view-button-${view.id}`}
              className={`workspace-nav__item workspace-nav__item--tab${view.id === activeViewId ? ' is-active' : ''}`}
              onClick={() => onSelectView(view.id)}
            >
              <span className="workspace-nav__mark">{viewMonogram(view.id)}</span>
              <span className="workspace-nav__item-copy">
                <strong>{view.label}</strong>
              </span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}
