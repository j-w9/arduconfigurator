import type { ReactElement, ReactNode } from 'react'

// The small circled "i": long guidance hidden behind one hover/focus instead of
// a wall of always-on text in the layout. Lifted out of apps/web so a second
// product does not re-draw it. Styled by `.receiver-info-dot` /
// `.receiver-info-tip` in this package's styles.css — token-based, so it
// follows the theme in both modes, and the tip opens downward so it clears a
// workspace's horizontal overflow clip. `tabIndex={0}` makes the tip
// keyboard-reachable through the `:focus-visible` rule.
//
// Links are plain hrefs here. apps/web keeps its own `InfoDot` over this one
// that accepts only a key of its wiki's topic table, so a destination cannot be
// invented at one of its call sites; that guarantee belongs to the app, not to
// the kit.

export interface InfoDotLink {
  href: string
  label: ReactNode
  testId?: string
}

export interface InfoDotProps {
  /** Accessible label naming what the tooltip documents (e.g. "About PID gains").
   *  Keep it generic when the dot sits inside a field's <label>, or a query by
   *  label text matches two elements. */
  label: string
  /** Tooltip body — plain text or inline nodes; opens on hover/focus. */
  children: ReactNode
  /** Optional stable hook for tests. */
  testId?: string
  /** Widen the tip for longer card/section guidance (vs a terse field detail). */
  wide?: boolean
  /** External links appended to the tip, each opening in a new tab. */
  links?: readonly InfoDotLink[]
}

export function InfoDot({ label, children, testId, wide = false, links = [] }: InfoDotProps): ReactElement {
  const linked = links.length > 0
  return (
    <span
      className="receiver-info-dot"
      tabIndex={0}
      role="note"
      aria-label={label}
      data-testid={testId}
    >
      i
      {/* `--linked` re-enables pointer events on the tip and bridges the gap
          under the dot. Applied ONLY when there is something to click: an
          always-clickable tip would start intercepting clicks on whatever it
          overlaps, and every text-only dot must keep behaving as it does. */}
      <span
        className={`receiver-info-tip${wide ? ' receiver-info-tip--wide' : ''}${linked ? ' receiver-info-tip--linked' : ''}`}
        role="tooltip"
      >
        {children}
        {links.map((link, index) => (
          // A plain external anchor, and it must stay one. Pulling linked
          // content into a single-page app poisoned ArduConfigurator's shell
          // once (a P1 production bug), even from its own origin.
          <a
            key={`${index}:${link.href}`}
            className="receiver-info-wiki"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={link.testId}
          >
            {link.label}
          </a>
        ))}
      </span>
    </span>
  )
}
