// Testing helpers for the guided-Setup flow + the expert-only view check.
//
// `isExpertOnlyView` answers "should this tab only render under Expert
// product-mode?" Currently only the raw Parameters tab qualifies, but
// the predicate exists so callsites are stable if more expert tabs are
// added.
//
// The other two helpers honour a `?guidedSetupStep=<sectionId>` query
// parameter that lets a dev/CI flow jump straight to a Setup section
// for screenshotting, e2e composition, or manual repro. It is GATED to
// localhost / 127.0.0.1 / Vite DEV builds — never honoured on a
// production deployment so an external link cannot bypass the wizard.

import type { AppViewId } from '@arduconfig/param-metadata'

const GUIDED_SETUP_STEP_QUERY_KEY = 'guidedSetupStep'

/** Tabs that only render under Expert product-mode. */
export function isExpertOnlyView(viewId: AppViewId): boolean {
  return viewId === 'parameters'
}

/**
 * Are we in a context where the dev shortcut is safe to honour? Always
 * false on a production host so a crafted `?guidedSetupStep=` link
 * cannot bypass the guided flow on a real deployment.
 */
export function canUseGuidedSetupTestingShortcut(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const host = window.location.hostname
  return import.meta.env.DEV || host === 'localhost' || host === '127.0.0.1'
}

/**
 * Resolve `?guidedSetupStep=<id>` against the actual set of sections
 * available right now, returning the matching id (case-insensitive) or
 * `undefined` if the gate is off, the param is missing, or the id is
 * unknown. The returned id is always one of `availableSectionIds`, so
 * the caller can safely select it without re-checking membership.
 */
export function readGuidedSetupShortcutSectionId(availableSectionIds: readonly string[]): string | undefined {
  if (!canUseGuidedSetupTestingShortcut() || availableSectionIds.length === 0) {
    return undefined
  }

  try {
    const params = new URLSearchParams(window.location.search)
    const requestedSectionId = params.get(GUIDED_SETUP_STEP_QUERY_KEY)?.trim().toLowerCase()
    if (!requestedSectionId) {
      return undefined
    }

    return availableSectionIds.find((sectionId) => sectionId.toLowerCase() === requestedSectionId)
  } catch {
    return undefined
  }
}
