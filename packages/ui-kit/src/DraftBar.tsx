import type { ReactElement, ReactNode } from 'react'

import { buttonStyle } from './index.js'

// The staged-changes bar: "N staged changes — Write all / Discard". Editing
// stages a draft rather than writing it; this is the one place to write the
// whole set, or to throw it away. Lifted out of apps/web so a second product
// stages and writes the same way instead of drawing its own bar.
//
// Presentational only: the caller owns the drafts, counts them, decides whether
// a write may start and does the write. Styled by `.parameter-draft-bar*` in
// this package's styles.css. `floating` is apps/web's chip pinned bottom-right
// of the viewport; `inline` puts the same bar in flow, e.g. in a panel header.

export interface DraftBarReboot {
  /** A completed write left the device needing a restart. Shown only while
   *  nothing is staged or invalid: the reboot then becomes the bar's single
   *  prominent action, in the spot the write button just occupied. */
  pending: boolean
  title?: ReactNode
  message: ReactNode
  buttonLabel: ReactNode
  onRequest: () => void
}

export interface DraftBarProps {
  /** Values staged and ready to write. */
  stagedCount: number
  /** Staged values that cannot be written. Write stays disabled while any exist. */
  invalidCount?: number
  /** How the invalid count reads. Default "N invalid". */
  invalidLabel?: (count: number) => ReactNode
  /** Secondary text after the counts, e.g. which categories the changes touch. */
  detail?: ReactNode
  /** Something is in flight: every button is disabled. */
  busy: boolean
  /** The caller's own precondition for writing — connected, a compatible set. */
  canWrite?: boolean
  /** Write button text. Default "Write all"; pass progress while writing. */
  writeLabel?: ReactNode
  /** Tooltip on the write button, e.g. why it is disabled. */
  writeTitle?: string
  onWrite: () => void
  onDiscard: () => void
  /** A "Show changes" button, for a page with somewhere to review them. */
  onShowChanges?: () => void
  reboot?: DraftBarReboot
  /** Extra actions, rendered before the bar's own buttons. */
  children?: ReactNode
  placement?: 'floating' | 'inline'
  /** Prefixed to every data-testid, e.g. 'global-' gives 'global-draft-bar'. */
  testIdPrefix?: string
}

export function DraftBar(props: DraftBarProps): ReactElement {
  const {
    stagedCount,
    invalidCount = 0,
    invalidLabel = (count: number) => `${count} invalid`,
    detail,
    busy,
    canWrite = true,
    writeLabel = 'Write all',
    writeTitle,
    onWrite,
    onDiscard,
    onShowChanges,
    reboot,
    children,
    placement = 'floating',
    testIdPrefix = ''
  } = props
  const testId = (name: string): string => `${testIdPrefix}${name}`
  const placementClass = placement === 'inline' ? ' parameter-draft-bar--inline' : ''

  if (reboot?.pending && stagedCount === 0 && invalidCount === 0) {
    return (
      <div className={`parameter-draft-bar parameter-draft-bar--reboot${placementClass}`} data-testid={testId('draft-bar')}>
        <div className="parameter-draft-bar__summary">
          <strong data-testid={testId('reboot-required')}>{reboot.title ?? 'Reboot required'}</strong>
          <small>{reboot.message}</small>
        </div>
        <div className="parameter-draft-bar__actions">
          <button
            type="button"
            data-testid={testId('draft-reboot')}
            style={buttonStyle('primary')}
            onClick={reboot.onRequest}
            disabled={busy}
          >
            {reboot.buttonLabel}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className={`parameter-draft-bar${placementClass}`} data-testid={testId('draft-bar')}>
      <div className="parameter-draft-bar__summary">
        <strong data-testid={testId('draft-count')}>
          {stagedCount} staged change{stagedCount === 1 ? '' : 's'}
        </strong>
        {invalidCount > 0 ? <span className="parameter-draft-bar__invalid">{invalidLabel(invalidCount)}</span> : null}
        {detail ? <small>{detail}</small> : null}
      </div>
      <div className="parameter-draft-bar__actions">
        {children}
        {onShowChanges ? (
          <button type="button" data-testid={testId('draft-show')} style={buttonStyle()} onClick={onShowChanges}>
            Show changes
          </button>
        ) : null}
        <button
          type="button"
          data-testid={testId('draft-write')}
          style={buttonStyle('primary')}
          onClick={onWrite}
          disabled={busy || !canWrite || stagedCount === 0 || invalidCount > 0}
          title={writeTitle}
        >
          {writeLabel}
        </button>
        <button
          type="button"
          data-testid={testId('draft-discard')}
          style={buttonStyle()}
          onClick={onDiscard}
          // Nothing to discard is a button that does nothing. apps/web hides the
          // whole bar in that state, so this changes nothing there.
          disabled={busy || (stagedCount === 0 && invalidCount === 0)}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
