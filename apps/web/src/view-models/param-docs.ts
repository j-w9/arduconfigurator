// Deriving the ArduPilot wiki URL for a raw parameter id.
//
// Operators told us the friendly labels hide the thing they actually have to
// search for: "Maybe I know this exists, but I don't know it as Stick Feel
// Smoothing." Showing the raw id (ATC_INPUT_TC) next to a deep link into the
// official parameter docs closes that gap, and makes the eventual step into
// Expert mode / the raw Parameters tab far less of a cliff.
//
// The URL is DERIVED, never hand-maintained: a curated table of ~1500 anchors
// would rot the moment ArduPilot renames or adds a parameter, and every stale
// row would be a link to the wrong doc.

/** Landing page for the full ArduCopter parameter reference. */
export const ARDUPILOT_PARAMETER_DOCS_URL = 'https://ardupilot.org/copter/docs/parameters.html'

/**
 * Only ids that look like real ArduPilot parameter names get an anchor.
 * Anything else (a synthetic/composed id, a DroneCAN node param with dots)
 * falls back to the bare page rather than inventing a fragment that resolves
 * to nothing meaningful.
 */
const ARDUPILOT_PARAM_ID = /^[A-Z][A-Z0-9_]*$/

/**
 * Deep link into the ArduPilot parameter reference for `paramId`.
 *
 * The anchor scheme was verified against the live page rather than assumed:
 * parameters.html is Sphinx-generated and carries a short per-parameter id
 * alongside the long "name + description" one — e.g. ATC_INPUT_TC is both
 * `#atc-input-tc-attitude-control-input-time-constant` and `#atc-input-tc`.
 * Only the short form is derivable from the id alone, so that is what we use:
 * lowercase, underscores to hyphens.
 *
 * Two known limits, both of which degrade to "you land at the top of the
 * parameter reference" (browsers ignore a fragment that matches nothing):
 *  - Fork-only parameters (OSD_MSG_ABBR and friends) aren't in the upstream
 *    docs at all.
 *  - A handful of parameters are documented under a different name than the
 *    firmware reports — ANGLE_MAX appears as ATC_ANGLE_MAX. Special-casing
 *    those would reintroduce exactly the hand-maintained table this avoids.
 *
 * The docs are always the Copter set: this configurator is Copter-first, and
 * the views that render the link are dumb components with no vehicle prop to
 * key off. Most parameters here are shared library parameters, so the Copter
 * page is right for them regardless of vehicle.
 */
export function parameterWikiUrl(paramId: string): string {
  if (!ARDUPILOT_PARAM_ID.test(paramId)) {
    return ARDUPILOT_PARAMETER_DOCS_URL
  }
  return `${ARDUPILOT_PARAMETER_DOCS_URL}#${paramId.toLowerCase().replace(/_/g, '-')}`
}
