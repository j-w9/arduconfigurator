import type { ReactElement, ReactNode } from 'react'

export interface InfoDotProps {
  /** Accessible label naming what the tooltip documents (e.g. "About PID gains"). */
  label: string
  /** Tooltip body — plain text or inline nodes; opens on hover/focus. */
  children: ReactNode
  /** Optional stable hook for tests. */
  testId?: string
  /** Widen the tip for longer card/section guidance (vs the terse tab detail). */
  wide?: boolean
}

/**
 * The small circled "i" affordance first used on the Tuning tab strip, lifted
 * into a shared component so card- and field-level guidance across the tuning
 * surfaces can hide long always-on help behind one hover/focus instead of
 * dumping a wall of text into the layout. Reuses the shared
 * `.receiver-info-dot` / `.receiver-info-tip` styles — theme-safe (token-based,
 * light + dark) and opens downward so it clears the workspace's overflow clip.
 * `tabIndex={0}` makes the tip keyboard-reachable via the CSS `:focus-visible`
 * rule.
 */
export function InfoDot({ label, children, testId, wide = false }: InfoDotProps): ReactElement {
  return (
    <span
      className="receiver-info-dot"
      tabIndex={0}
      role="note"
      aria-label={label}
      data-testid={testId}
    >
      i
      <span className={`receiver-info-tip${wide ? ' receiver-info-tip--wide' : ''}`} role="tooltip">
        {children}
      </span>
    </span>
  )
}
