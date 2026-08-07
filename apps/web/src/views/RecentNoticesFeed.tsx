// The Recent Notices feed — the FC's STATUSTEXT stream, severity-grouped.
//
// Rendered twice over from the same props shape: inline in the Status & Info
// bench (collapsed and compact by default, because that page is already long),
// and inside a popped-out child window (Mission Planner / DroneCAN-GUI style)
// so the operator can park the feed beside the app while working elsewhere in
// the UI. The popout is a React portal into the opener's tree — one runtime,
// one transport, one snapshot — so this component never needs to know which
// window it is in beyond how much vertical room it may take.
//
// Presentational only: the coalesced model, the filter text, and every handler
// come from App.tsx.

import type { ReactElement } from 'react'

import { StatusBadge } from '@arduconfig/ui-kit'

import type { RecentNoticesModel } from '../view-models/recent-notices'

export interface RecentNoticesFeedProps {
  /** Coalesced + severity-grouped notices (already filtered by the caller). */
  notices: RecentNoticesModel
  /** Prefix for every data-testid, so the inline copy and the popped-out copy
   *  never collide in the DOM (both live in the same React tree). */
  testIdPrefix: string
  /** Prefix for per-notice rows. Kept separate from testIdPrefix because the
   *  inline panel's row hooks (`setup-notice-*`) predate this component and are
   *  already asserted on in the e2e suite. */
  entryTestIdPrefix: string
  /** Expert-mode text filter. Undefined hides the search box entirely. */
  filterValue?: string
  onFilterChange?: (value: string) => void
  /** False disables Copy all / Clear all (nothing has arrived yet). */
  hasEntries: boolean
  copied: boolean
  onCopyAll: () => void
  onClearAll: () => void
  /** Expand-in-place: undefined in the popout, where the window IS the room. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Pop-out control. Undefined in the popped-out copy itself. */
  poppedOut?: boolean
  onTogglePopout?: () => void
  /** True when the browser blocked the last window.open, so we can say so
   *  rather than looking like a dead button. */
  popoutBlocked?: boolean
  /** Popped-out windows have their own scrollport, so the list must not carry
   *  its own max-height there. */
  variant: 'inline' | 'popout'
}

export function RecentNoticesFeed({
  notices,
  testIdPrefix,
  entryTestIdPrefix,
  filterValue,
  onFilterChange,
  hasEntries,
  copied,
  onCopyAll,
  onClearAll,
  expanded,
  onToggleExpanded,
  poppedOut,
  onTogglePopout,
  popoutBlocked,
  variant
}: RecentNoticesFeedProps): ReactElement {
  // Inline: bounded box, taller when expanded. Popout: the window's own scroll
  // is the bound, so no max-height at all.
  const listClassName = [
    'setup-gui-box__status-list',
    variant === 'inline' ? 'setup-gui-box__status-list--scroll' : 'setup-gui-box__status-list--window',
    variant === 'inline' && expanded ? 'setup-gui-box__status-list--expanded' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {/* Controls live in the body (normal flow), not the floating titlebar
          pill — the pill grows tall when the count badge wraps and would cover
          them. */}
      <div className="setup-gui-box__notice-controls">
        {filterValue !== undefined && onFilterChange ? (
          <input
            type="search"
            data-testid={`${testIdPrefix}-search`}
            className="setup-gui-box__notice-filter-input"
            placeholder="Filter notices…"
            value={filterValue}
            onChange={(event) => onFilterChange(event.target.value)}
            aria-label="Filter recent notices"
          />
        ) : null}
        {onToggleExpanded ? (
          <button
            type="button"
            className="setup-gui-box__icon-button"
            data-testid={`${testIdPrefix}-expand`}
            onClick={onToggleExpanded}
            aria-expanded={expanded === true}
            title={expanded ? 'Shrink the notice list back to the compact height' : 'Show more notices without leaving the page'}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        ) : null}
        {onTogglePopout ? (
          <button
            type="button"
            className="setup-gui-box__icon-button"
            data-testid={`${testIdPrefix}-popout`}
            // Straight off the click: window.open only survives a popup blocker
            // inside the user-activation window, so this must never be deferred
            // into an effect or an await.
            onClick={onTogglePopout}
            title={poppedOut ? 'Close the notices window' : 'Open the notices in their own window'}
          >
            {poppedOut ? 'Close window' : 'Pop out'}
          </button>
        ) : null}
        <button
          type="button"
          className="setup-gui-box__icon-button"
          data-testid={`${testIdPrefix}-copy-all`}
          onClick={onCopyAll}
          disabled={!hasEntries}
          title="Copy all notices to clipboard"
          aria-label="Copy all notices to clipboard"
        >
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button
          type="button"
          className="setup-gui-box__icon-button"
          data-testid={`${testIdPrefix}-clear-all`}
          onClick={onClearAll}
          disabled={!hasEntries}
          title="Clear all notices (local display only — the FC keeps sending new ones)"
          aria-label="Clear all notices"
        >
          Clear all
        </button>
      </div>

      {popoutBlocked ? (
        <p className="setup-gui-box__popout-blocked" data-testid={`${testIdPrefix}-popout-blocked`}>
          Your browser blocked the notices window. Allow pop-ups for this site and try again.
        </p>
      ) : null}

      {poppedOut ? (
        <p className="setup-gui-box__popped-out" data-testid={`${testIdPrefix}-popped-out`}>
          Notices are open in their own window — still live, and still listed here.
        </p>
      ) : null}

      <div className={listClassName} data-testid={`${testIdPrefix}-list`}>
        {notices.groups.length === 0 ? <span className="setup-gui-box__empty">No status text yet</span> : null}
        {notices.groups.map((group) => (
          <div
            key={group.key}
            className={`setup-gui-box__status-group setup-gui-box__status-group--${group.key}`}
            data-testid={`${testIdPrefix}-group-${group.key}`}
          >
            <header className="setup-gui-box__status-group-header">
              <strong>{group.label}</strong>
              <span>{group.notices.length}</span>
            </header>
            {group.notices.map((notice) => (
              <div
                key={`${notice.severity}-${notice.text}`}
                className={`setup-gui-box__status-entry is-${notice.severity}`}
                data-testid={`${entryTestIdPrefix}-${group.key}`}
              >
                <strong>{notice.severity}</strong>
                {/* Full text, always wrapped — a notice the operator cannot read
                    is a notice the FC did not send. No truncation, no tooltip. */}
                <span className="setup-gui-box__status-text">{notice.text}</span>
                {notice.count > 1 ? (
                  <span
                    className="setup-gui-box__status-count"
                    data-testid={`${entryTestIdPrefix}-count`}
                    title={`${notice.count} occurrences`}
                  >
                    ×{notice.count}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

/** Titlebar badge text for a notices panel (shared by the inline panel and the
 *  popped-out window so both report the same counts). */
export function recentNoticesBadge(notices: RecentNoticesModel): ReactElement {
  return (
    <StatusBadge tone={notices.tone}>
      {notices.distinctCount > 0
        ? `${notices.distinctCount} notice${notices.distinctCount === 1 ? '' : 's'}${
            notices.totalCount > notices.distinctCount ? ` · ${notices.totalCount} total` : ''
          }`
        : 'quiet'}
    </StatusBadge>
  )
}
