// Per-view sub-task overrides — operator-pinned sub-task selection on
// the Receiver and Outputs tabs. Two useState hooks; both reset to
// `undefined` (no pin) so the view's auto-routing default applies.
// Tuning's sub-task override lives in useTuningWorkbench because it
// pairs with the Tuning workbench scale-multiplier state.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { OutputTaskId } from '../app-types'
import type { ReceiverTaskId } from '../views/Receiver'

export interface UseViewTaskOverridesResult {
  receiverTaskOverride: ReceiverTaskId | undefined
  setReceiverTaskOverride: Dispatch<SetStateAction<ReceiverTaskId | undefined>>
  outputTaskOverride: OutputTaskId | undefined
  setOutputTaskOverride: Dispatch<SetStateAction<OutputTaskId | undefined>>
}

export function useViewTaskOverrides(): UseViewTaskOverridesResult {
  const [receiverTaskOverride, setReceiverTaskOverride] = useState<ReceiverTaskId | undefined>()
  const [outputTaskOverride, setOutputTaskOverride] = useState<OutputTaskId | undefined>()

  return {
    receiverTaskOverride,
    setReceiverTaskOverride,
    outputTaskOverride,
    setOutputTaskOverride
  }
}
