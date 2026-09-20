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
              {/* The rail stays quiet on purpose: badges live in the
                  active-view header, not here. Two exceptions earn their space.
                  Guided Setup carries its "beta" under-development flag, and
                  Snapshots shows DRIFT — but only when there is drift to show
                  ("3 diff", "2 invalid"; never "5 saved"). That drift used to
                  be an Active Baseline panel above this rail, which said more
                  than it needed to and duplicated the Snapshots tab; the one
                  thing it did that the tab cannot is tell you about drift while
                  you are somewhere else, and this keeps exactly that. */}
              {(view.id === 'guided-setup' ||
                (view.id === 'snapshots' && /\d+\s+(diff|invalid)/.test(view.badge ?? ''))) &&
              view.badge ? (
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
