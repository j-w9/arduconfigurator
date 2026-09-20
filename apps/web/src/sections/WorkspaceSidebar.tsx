// The workspace sidebar (tab rail). A dumb presentational component (the
// established sections/ pattern): it imports no runtime / transport / MAVLink
// modules — App passes the visible nav descriptors and an onSelectView
// callback, and this renders the rail.
//
// It is ONLY the rail now. The identity caption and the Active Baseline panel
// that used to sit above it were removed: see the comment in the body.

import type { AppViewId } from '@arduconfig/param-metadata'
import { StatusBadge } from '@arduconfig/ui-kit'

import type { AppViewDescriptor } from '../app-types'
import { viewMonogram } from '../setup-format-helpers'

export interface WorkspaceSidebarProps {
  visibleAppViews: readonly AppViewDescriptor[]
  activeViewId: AppViewId
  onSelectView: (id: AppViewId) => void
}

export function WorkspaceSidebar({ visibleAppViews, activeViewId, onSelectView }: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar__shell">
        {/* The sidebar used to open with a "Connected Tabs" caption naming the
            vehicle and transport, and an Active Baseline panel. Both were
            saying something already on screen: the header carries the vehicle,
            the battery and the transport picker, the status bar carries the
            link state, and the Snapshots NAV ITEM already badges the drift
            count ("3 diff" / "5 saved", with tone) — which was this panel's one
            job that the Snapshots tab itself does not do while you are on
            another tab. The detail lives in Snapshots. */}

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
              {/* The rail stays quiet: badges live in the active-view header, not
                  here. Guided Setup is the one exception, for its "beta"
                  under-development flag.

                  A Snapshots drift badge was tried and removed. It read as the
                  one thing the deleted Active Baseline panel did that the
                  Snapshots tab cannot — tell you about drift while you are
                  elsewhere — but a count like "94 diff" is wider than the rail
                  has room for, so it sat on top of the label. Drift is on the
                  Snapshots tab, which is where you act on it. */}
              {view.id === 'guided-setup' && view.badge ? (
                <span className="workspace-nav__badge">
                  <StatusBadge tone={view.tone}>{view.badge}</StatusBadge>
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}
