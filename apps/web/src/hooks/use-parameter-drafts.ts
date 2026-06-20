import { useCallback, useState } from 'react'

/**
 * The parameter-draft model: a map of parameter id → the staged
 * (string) value the operator has typed but not yet written to the
 * vehicle. Empty when there are no pending edits.
 */
export type ParameterDraftValues = Record<string, string>

export interface ParameterDrafts {
  /** The current staged edits, keyed by parameter id. */
  editedValues: ParameterDraftValues

  /** Stage (or overwrite) a single parameter's draft value. */
  setDraft: (paramId: string, value: string) => void
  /** Drop the draft for one parameter; a no-op if it has none. */
  clearDraft: (paramId: string) => void
  /** Drop the drafts for a set of parameters in one update. */
  clearDrafts: (paramIds: readonly string[]) => void
  /** Discard every staged edit. */
  clearAllDrafts: () => void
  /** Merge a map of drafts on top of the current edits (new keys win). */
  mergeDrafts: (drafts: ParameterDraftValues) => void
  /** Replace the entire draft map (e.g. restoring a snapshot/profile). */
  replaceDrafts: (drafts: ParameterDraftValues) => void
  /**
   * Escape hatch for edits that must be computed from the previous map
   * (bitmask toggles, linked roll/pitch tuning, etc.). Equivalent to the
   * functional form of `setEditedValues`.
   */
  updateDrafts: (
    updater: (existing: ParameterDraftValues) => ParameterDraftValues
  ) => void
}

/**
 * Owns the parameter-draft model extracted from App.tsx.
 *
 * The named operations encode the exact map mutations the App handlers
 * and per-view JSX previously performed inline, so the extraction was a
 * series of behavior-preserving rewrites. `updateDrafts` is the escape
 * hatch for the few edits (bitmask toggles, linked roll/pitch tuning)
 * that must compute the next map from the previous one; nothing outside
 * this hook touches the raw `useState` setter.
 */
export function useParameterDrafts(): ParameterDrafts {
  const [editedValues, setEditedValues] = useState<ParameterDraftValues>({})

  const setDraft = useCallback((paramId: string, value: string) => {
    setEditedValues((existing) => ({ ...existing, [paramId]: value }))
  }, [])

  const clearDraft = useCallback((paramId: string) => {
    setEditedValues((existing) => {
      if (!(paramId in existing)) {
        return existing
      }

      const next = { ...existing }
      delete next[paramId]
      return next
    })
  }, [])

  const clearDrafts = useCallback((paramIds: readonly string[]) => {
    setEditedValues((existing) => {
      const next = { ...existing }
      paramIds.forEach((paramId) => {
        delete next[paramId]
      })
      return next
    })
  }, [])

  const clearAllDrafts = useCallback(() => {
    setEditedValues({})
  }, [])

  const mergeDrafts = useCallback((drafts: ParameterDraftValues) => {
    setEditedValues((existing) => ({ ...existing, ...drafts }))
  }, [])

  const replaceDrafts = useCallback((drafts: ParameterDraftValues) => {
    setEditedValues(drafts)
  }, [])

  const updateDrafts = useCallback(
    (updater: (existing: ParameterDraftValues) => ParameterDraftValues) => {
      setEditedValues(updater)
    },
    []
  )

  return {
    editedValues,
    setDraft,
    clearDraft,
    clearDrafts,
    clearAllDrafts,
    mergeDrafts,
    replaceDrafts,
    updateDrafts
  }
}
