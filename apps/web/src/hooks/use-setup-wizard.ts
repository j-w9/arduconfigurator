// Setup-wizard view-state, extracted from App.tsx as another decomposition
// slice. Four useState hooks the Setup view owns end-to-end: which section
// the wizard is on, whether the Setup tab is in overview vs wizard mode,
// the next-focus target the wizard wants to scroll to, and the per-section
// confirmation records that gate the wizard's progression.
//
// The initial section / mode default to the `?guidedSetupStep=` shortcut
// when present (Vite-DEV / localhost only). The caller passes the resolved
// shortcut so this hook stays decoupled from the URL/env-gate logic that
// produces it.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { SetupConfirmationRecord, SetupMode } from '../app-types'

export interface UseSetupWizardResult {
  /** ID of the section currently active in the Setup wizard (undefined = none). */
  selectedSetupSectionId: string | undefined
  setSelectedSetupSectionId: Dispatch<SetStateAction<string | undefined>>
  /** Which Setup-tab layout the user is on — overview cards or the guided wizard. */
  setupMode: SetupMode
  setSetupMode: Dispatch<SetStateAction<SetupMode>>
  /**
   * After a section change, the wizard wants to scroll/focus to a specific
   * target (e.g. the first failing criterion). Cleared after the focus
   * effect runs.
   */
  pendingSetupWizardFocusId: string | undefined
  setPendingSetupWizardFocusId: Dispatch<SetStateAction<string | undefined>>
  /** Per-section operator confirmations (outcome + signature + timestamp). */
  setupConfirmations: Record<string, SetupConfirmationRecord>
  setSetupConfirmations: Dispatch<SetStateAction<Record<string, SetupConfirmationRecord>>>
}

export function useSetupWizard(initialShortcutSectionId: string | undefined): UseSetupWizardResult {
  const [selectedSetupSectionId, setSelectedSetupSectionId] = useState<string | undefined>(
    initialShortcutSectionId
  )
  const [setupMode, setSetupMode] = useState<SetupMode>(() =>
    initialShortcutSectionId ? 'wizard' : 'overview'
  )
  const [pendingSetupWizardFocusId, setPendingSetupWizardFocusId] = useState<string | undefined>()
  const [setupConfirmations, setSetupConfirmations] = useState<Record<string, SetupConfirmationRecord>>({})

  return {
    selectedSetupSectionId,
    setSelectedSetupSectionId,
    setupMode,
    setSetupMode,
    pendingSetupWizardFocusId,
    setPendingSetupWizardFocusId,
    setupConfirmations,
    setSetupConfirmations
  }
}
