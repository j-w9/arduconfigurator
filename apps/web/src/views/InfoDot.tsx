import type { ReactElement, ReactNode } from 'react'

import { wikiTopicUrl, type WikiTopic } from '../view-models/param-docs'

export interface InfoDotProps {
  /** Accessible label naming what the tooltip documents (e.g. "About PID gains"). */
  label: string
  /** Tooltip body — plain text or inline nodes; opens on hover/focus. */
  children: ReactNode
  /** Optional stable hook for tests. */
  testId?: string
  /** Widen the tip for longer card/section guidance (vs the terse tab detail). */
  wide?: boolean
  /**
   * Optional deep link into our own wiki's topic page for this concept. Only a
   * key of WIKI_TOPIC_PATHS is accepted — no free-form href — so a destination
   * cannot be invented at a call site and every link stays covered by the
   * page/anchor assertions in tests/wiki-topic-links.test.mjs.
   */
  wikiTopic?: WikiTopic
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
export function InfoDot({ label, children, testId, wide = false, wikiTopic }: InfoDotProps): ReactElement {
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
          overlaps, and every text-only dot in the app must keep behaving
          exactly as it does today. */}
      <span
        className={`receiver-info-tip${wide ? ' receiver-info-tip--wide' : ''}${wikiTopic ? ' receiver-info-tip--linked' : ''}`}
        role="tooltip"
      >
        {children}
        {wikiTopic ? (
          // Plain external anchor, and it must stay one. Pulling wiki content
          // into the SPA poisoned the app shell once (a P1 production bug) —
          // that rule holds even though the wiki is on our own origin.
          <a
            className="receiver-info-wiki"
            href={wikiTopicUrl(wikiTopic)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={testId ? `${testId}-wiki` : undefined}
          >
            Read this in the wiki ↗
          </a>
        ) : null}
      </span>
    </span>
  )
}
