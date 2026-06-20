// Receiver-tab UI detail toggles — two boolean toggles that expose
// optional verbose sections of the Receiver view. Both default `false`
// so the Receiver page stays compact unless the operator drills in.

import { useState, type Dispatch, type SetStateAction } from 'react'

export interface UseReceiverDetailTogglesResult {
  /** Per-channel detail rows beneath the mapping grid. */
  showReceiverChannelDetails: boolean
  setShowReceiverChannelDetails: Dispatch<SetStateAction<boolean>>
  /** RC mapping-session diagnostics panel (axis confidence, raw min/max). */
  showReceiverMappingDiagnostics: boolean
  setShowReceiverMappingDiagnostics: Dispatch<SetStateAction<boolean>>
}

export function useReceiverDetailToggles(): UseReceiverDetailTogglesResult {
  const [showReceiverChannelDetails, setShowReceiverChannelDetails] = useState(false)
  const [showReceiverMappingDiagnostics, setShowReceiverMappingDiagnostics] = useState(false)

  return {
    showReceiverChannelDetails,
    setShowReceiverChannelDetails,
    showReceiverMappingDiagnostics,
    setShowReceiverMappingDiagnostics
  }
}
