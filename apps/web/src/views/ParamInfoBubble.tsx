import type { ReactElement } from 'react'

import { parameterWikiUrl } from '../view-models/param-docs'

export interface ParamInfoBubbleProps {
  /** Raw ArduPilot parameter id, e.g. `ATC_INPUT_TC`. */
  paramId: string
  /** Friendly label the surface shows instead of the id, for the button's accessible name. */
  label: string
  /** Plain-text ArduPilot description, when the metadata carries one. */
  description?: string
  /** Stable per-surface hook, e.g. `tuning-info-ATC_INPUT_TC`. */
  testId: string
}

/**
 * The per-parameter "i" affordance, shared by every surface that shows a
 * friendly label in place of the raw parameter name (Config, Networking,
 * curated Tuning). Hover or focus reveals the raw id, the ArduPilot
 * description, and a deep link into the parameter reference.
 *
 * Previously each surface inlined this markup and rendered it ONLY when the
 * metadata carried a description — so a curated card like Tuning ▸ Pilot ▸
 * "Stick Feel Smoothing" could show a friendly name with no way at all to find
 * out it means ATC_INPUT_TC. The id and the wiki link exist for every
 * parameter, so the bubble now always renders and the description is the
 * optional part.
 *
 * The wiki link is a plain external anchor and must stay one: an earlier
 * version pulled wiki content in-app and it poisoned the PWA shell (a P1
 * production bug). Never navigate the SPA to it, never fetch or embed it.
 */
export function ParamInfoBubble({ paramId, label, description, testId }: ParamInfoBubbleProps): ReactElement {
  return (
    <span className="config-section__info-wrap">
      <button
        type="button"
        className="config-section__info"
        data-testid={testId}
        // Include the raw id in the accessible name: a screen-reader user gets
        // the same "which parameter is this really?" answer sighted users get
        // from opening the bubble.
        aria-label={`About ${label} (${paramId})`}
      >
        i
      </button>
      {/* Kept as the button's next sibling — surfaces' e2e checks and the
          `.config-section__info:focus-visible + …` CSS both rely on that. */}
      <span className="config-section__info-tip" role="tooltip">
        <span className="config-section__info-param">{paramId}</span>
        {description ? <span className="config-section__info-text">{description}</span> : null}
        <a
          className="config-section__info-wiki"
          href={parameterWikiUrl(paramId)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`param-wiki-${paramId}`}
        >
          ArduPilot wiki ↗
        </a>
      </span>
    </span>
  )
}
