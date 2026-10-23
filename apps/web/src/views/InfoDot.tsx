import type { ReactElement, ReactNode } from 'react'

import { InfoDot as KitInfoDot, type InfoDotLink } from '@arduconfig/ui-kit'

import { WIKI_PARAMETER_FIRMWARE, parameterWikiUrl, wikiTopicUrl, type WikiTopic } from '../view-models/param-docs'

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
  /**
   * Raw ArduPilot parameter id. When set, the tip ends with a link into the
   * parameter reference for that id (test id `param-wiki-<ID>`), the way the
   * old per-field bubble did. A plain external anchor, like the topic link.
   */
  paramId?: string
}

/**
 * ArduConfigurator's info dot: ui-kit's `InfoDot`, with links restricted to this
 * app's wiki. The dot itself — markup, classes, hover/focus behaviour — lives in
 * `@arduconfig/ui-kit`; what stays here is the rule that a link can only be a
 * wiki topic or a parameter id, never a free-form href.
 */
export function InfoDot({ label, children, testId, wide = false, wikiTopic, paramId }: InfoDotProps): ReactElement {
  const links: InfoDotLink[] = []
  if (wikiTopic) {
    links.push({
      href: wikiTopicUrl(wikiTopic),
      label: 'Read this in the wiki ↗',
      testId: testId ? `${testId}-wiki` : undefined
    })
  }
  if (paramId) {
    // The dot usually sits inside the field's <label>. A click on this anchor
    // still opens the reference in a new tab; the label's own activation only
    // focuses the field's control, which is harmless. Named for the documented
    // firmware: the reference is generated from the pinned Copter metadata, and
    // a 4.6 board can differ.
    links.push({
      href: parameterWikiUrl(paramId),
      // JSX, not a template string: three text nodes, as when this anchor was
      // drawn here. One node kerns across the parentheses differently.
      label: <>Parameter reference ({WIKI_PARAMETER_FIRMWARE}) ↗</>,
      testId: `param-wiki-${paramId}`
    })
  }
  return (
    <KitInfoDot label={label} testId={testId} wide={wide} links={links}>
      {children}
    </KitInfoDot>
  )
}
