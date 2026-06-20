import { useState, type Dispatch, type SetStateAction } from 'react'

import { type StatusTone } from '../status-tone'

/** A transient banner shown in the parameter editor. */
export interface ParameterNotice {
  tone: StatusTone
  text: string
}

/**
 * The post-write advisory shown after staged parameters are applied:
 * how many changed and whether a reboot / parameter refresh is needed.
 */
export interface ParameterFollowUp {
  requiresReboot: boolean
  refreshRequired: boolean
  changedCount: number
  text: string
}

export interface ParameterFeedback {
  parameterSearch: string
  setParameterSearch: Dispatch<SetStateAction<string>>
  selectedParameterId: string | undefined
  setSelectedParameterId: Dispatch<SetStateAction<string | undefined>>
  parameterNotice: ParameterNotice | undefined
  setParameterNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  parameterFollowUp: ParameterFollowUp | undefined
  setParameterFollowUp: Dispatch<SetStateAction<ParameterFollowUp | undefined>>
}

/**
 * Owns the parameter-editor feedback state extracted from App.tsx: the
 * search box, the currently selected parameter, the transient notice
 * banner, and the post-apply follow-up advisory.
 *
 * Verbatim state move — same initial values and setter semantics as the
 * four `useState` calls it replaces, so behavior is unchanged. The five
 * per-section save/restore notices (snapshot / provisioning / tuning /
 * preset / session) are a separate banner concern and intentionally
 * stay in App; they reuse the {@link ParameterNotice} type re-exported
 * here.
 */
export function useParameterFeedback(): ParameterFeedback {
  const [parameterSearch, setParameterSearch] = useState('')
  const [selectedParameterId, setSelectedParameterId] = useState<string>()
  const [parameterNotice, setParameterNotice] = useState<ParameterNotice>()
  const [parameterFollowUp, setParameterFollowUp] = useState<ParameterFollowUp>()

  return {
    parameterSearch,
    setParameterSearch,
    selectedParameterId,
    setSelectedParameterId,
    parameterNotice,
    setParameterNotice,
    parameterFollowUp,
    setParameterFollowUp
  }
}
