// Deriving the parameter-reference URL for a raw parameter id.
//
// Operators told us the friendly labels hide the thing they actually have to
// search for: "Maybe I know this exists, but I don't know it as Stick Feel
// Smoothing." Showing the raw id (ATC_INPUT_TC) next to a deep link into the
// parameter reference closes that gap, and makes the eventual step into Expert
// mode / the raw Parameters tab far less of a cliff.
//
// The link points at OUR wiki (arduconfigurator.com/wiki), not ardupilot.org.
// We ship the same upstream metadata (wiki/data/apm.pdef.Copter-4.7.json, pinned
// from ArduPilot/ParameterRepository) rendered as one page per parameter FAMILY
// plus a search page, because upstream publishes all 5689 Copter parameters as a
// single HTML document that is genuinely unloadable on a phone — which is the
// device an operator has in the field. Same content, same source, usable.

/**
 * The wiki's parameter reference. This page IS the search page (see
 * wiki/tools/generate_parameter_reference.py — the index carries the search box
 * itself), which is what lets us address a parameter by NAME rather than having
 * to know which family page it lives on.
 */
export const WIKI_PARAMETER_REFERENCE_URL = 'https://arduconfigurator.com/wiki/parameters/index.html'

/**
 * Query key the reference's search page reads on load (wiki/_static/parameter-search.js).
 * Kept here so the producer and consumer of the contract sit next to each other.
 */
export const WIKI_PARAMETER_QUERY_KEY = 'param'

/**
 * The firmware the reference documents, surfaced in the link label.
 *
 * VERSION CAVEAT, disclosed rather than ignored: the reference is generated from
 * the pinned Copter-4.7 metadata, so on a 4.6 board a range or a value list can
 * differ from what the aircraft actually implements. The repo's established
 * version-gating (applyArducopter47CatalogOverrides) can't help here — it keys
 * on the detected FLIGHT_SW_VERSION, but there is no 4.6 reference to fall back
 * to, and ParamInfoBubble is a dumb view with no firmware prop. So the honest
 * fix is to say which version you are about to read, before the click; every
 * destination page also carries its own "ArduCopter 4.7 only" warning.
 *
 * tests/wiki-parameter-reference.test.mjs pins this string to the `firmware`
 * field the generator writes into parameter-index.json, so regenerating the
 * reference for a new release cannot silently leave this label stale.
 */
export const WIKI_PARAMETER_FIRMWARE = 'ArduCopter 4.7'

/**
 * Only ids that look like real ArduPilot parameter names get a lookup.
 * Anything else (a synthetic/composed id, a DroneCAN node param with dots)
 * falls back to the bare reference rather than sending the search page after a
 * name that cannot exist.
 */
const ARDUPILOT_PARAM_ID = /^[A-Z][A-Z0-9_]*$/

/**
 * Deep link into the wiki's parameter reference for `paramId`.
 *
 * The scheme is name-addressed on purpose. The reference is paginated by FAMILY
 * (`parameters/group-<slug>.html#param-<id lowercased, _ → ->`, e.g.
 * `group-atc.html#param-atc-input-tc`), and which family page a parameter lands
 * on is NOT derivable from its name: 424 of 5688 parameters resolve to the wrong
 * page under a longest-prefix rule — everything Copter defines at top level
 * (ACRO_*, PILOT_*, …) lives on `group-copter.html`, and families that differ
 * only by a trailing underscore get a numeric suffix (ARSPD_ → `group-arspd-2`).
 * The alternatives were both worse than this one: shipping the generated
 * name→page map is ~5700 rows of duplicated build output in the app bundle, and
 * it goes silently WRONG (a link to a 404) the first time the wiki is
 * regenerated for a new release without the app being rebuilt in lockstep.
 *
 * So the app names the parameter and the wiki resolves it against its own index
 * at load time — the side that owns the page layout is the side that maps names
 * to pages. An exact match jumps straight to that parameter's section; a name
 * the reference doesn't carry (fork-only params like OSD_MSG_ABBR, or a newer
 * firmware's additions) just stays on the reference and says so. Either way
 * there is no invented fragment and no dead link.
 *
 * The reference is the Copter set: this configurator is Copter-first, and most
 * of these are shared library parameters that read the same on any vehicle.
 */
export function parameterWikiUrl(paramId: string): string {
  if (!ARDUPILOT_PARAM_ID.test(paramId)) {
    return WIKI_PARAMETER_REFERENCE_URL
  }
  return `${WIKI_PARAMETER_REFERENCE_URL}?${WIKI_PARAMETER_QUERY_KEY}=${encodeURIComponent(paramId)}`
}

/**
 * Root of our own wiki (the Sphinx build that ships into the app bundle at
 * /wiki — see .github/workflows/web-deploy.yml).
 *
 * The parameter reference above is one page of it; the wiki also carries
 * hand-written topic pages (Tuning, Config, Lua, CAN/DroneCAN, Networking,
 * Files, Logs & Inspectors, and the First Time Setup walkthroughs). Those are
 * what the app's NON-parameter "i" bubbles — the ones that explain a card or a
 * workflow rather than a single parameter — can point at.
 */
export const WIKI_BASE_URL = 'https://arduconfigurator.com/wiki'

/**
 * Wiki destinations for concept-level "i" bubbles, as `page.html#anchor`
 * relative to WIKI_BASE_URL.
 *
 * Every entry here is asserted against the wiki sources by
 * tests/wiki-topic-links.test.mjs: the page must exist and the anchor must be
 * the docutils slug of a real heading on it. That test is the whole reason this
 * map is centralised rather than each bubble carrying its own string — a
 * concept link that 404s teaches operators the "i" is unreliable, and renaming
 * a wiki heading is exactly the silent way that happens.
 *
 * ONLY topics with a genuinely matching page belong here. Where the wiki has
 * nothing to say about a surface, the bubble stays text-only — an approximate
 * destination is worse than none.
 */
export const WIKI_TOPIC_PATHS = {
  /** Tuning ▸ Pilot: stick feel, acro rates/expo, accel limits, Loiter/AltHold. */
  tuningPilot: 'tuning.html#pilot',
  /** Tuning ▸ PID Gains: the per-axis rate controllers. */
  tuningPidGains: 'tuning.html#attitude-controllers-pid-gains',
  /** Tuning ▸ Filters: rate-controller filtering and the notch set. */
  tuningFilters: 'tuning.html#filters',
  /** Tuning ▸ Autotune: running the on-vehicle tune and its configuration. */
  tuningAutotune: 'tuning.html#autotune',
  /** Lua ▸ how scripts get onto the vehicle and what the catalog is. */
  luaInstallingScripts: 'lua.html#installing-scripts',
  /** Receiver ▸ binding an ELRS / CRSF receiver from the configurator. */
  receiverBind: 'first-time-setup/receiver.html#bind-elrs-crsf',
  /**
   * Modes ▸ Fiber, a fork-only mode. The bubble that points here is rendered
   * only when the connected vehicle actually reports Fiber, so a stock build
   * never links to it.
   */
  flightModesFiber: 'first-time-setup/flight-modes.html#fiber-mode'
} as const

export type WikiTopic = keyof typeof WIKI_TOPIC_PATHS

/** Absolute URL for a concept-level wiki topic. */
export function wikiTopicUrl(topic: WikiTopic): string {
  return `${WIKI_BASE_URL}/${WIKI_TOPIC_PATHS[topic]}`
}
