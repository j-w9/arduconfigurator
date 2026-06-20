// Ports-tab view state, extracted from App.tsx as another decomposition
// slice. Four useState hooks the Ports view owns end-to-end:
//
//   showAllOutputAssignments     toggle to expose all servo outputs (default false)
//   showAllSerialPorts           toggle to expose all serial slots — defaults
//                                TRUE so the Ports tab matches Mission Planner's
//                                "show every UART the FC exposes" behaviour. Users
//                                can still click "Show Active Ports" to collapse
//                                to the focused (configured-protocol-only) view
//                                when they have a complex board and want to
//                                hide noise.
//   customSerialBaudInputs       per-port operator-typed custom baud rates
//   expandedSerialOptionsPortNumber  which port's "Options" detail is open
//
// Default-flip rationale (showAllSerialPorts: false → true): a user reported
// SERIAL6 / UART4 on a MatekH743 never appeared in the Ports tab until they
// set the type to "USER / ESC TELEMETRY" in MP. Our "active first" filter
// was hiding any port whose protocol was 0 (None) or -1 (Disabled) — which
// is exactly the state of a port the operator hasn't configured yet. They
// could click "Show All N Ports" to surface it, but they had no way to know
// the port existed. MP's "show every UART always" matches the operator's
// hardware mental model (the board has N UARTs; show me all N).

import { useState, type Dispatch, type SetStateAction } from 'react'

export interface UsePortsViewResult {
  showAllOutputAssignments: boolean
  setShowAllOutputAssignments: Dispatch<SetStateAction<boolean>>
  showAllSerialPorts: boolean
  setShowAllSerialPorts: Dispatch<SetStateAction<boolean>>
  customSerialBaudInputs: Record<string, string>
  setCustomSerialBaudInputs: Dispatch<SetStateAction<Record<string, string>>>
  /** Port number whose SERIALn_OPTIONS detail row is currently expanded, or undefined when all are collapsed. */
  expandedSerialOptionsPortNumber: number | undefined
  setExpandedSerialOptionsPortNumber: Dispatch<SetStateAction<number | undefined>>
}

export function usePortsView(): UsePortsViewResult {
  const [showAllOutputAssignments, setShowAllOutputAssignments] = useState(false)
  const [showAllSerialPorts, setShowAllSerialPorts] = useState(true)
  const [customSerialBaudInputs, setCustomSerialBaudInputs] = useState<Record<string, string>>({})
  const [expandedSerialOptionsPortNumber, setExpandedSerialOptionsPortNumber] = useState<number | undefined>()

  return {
    showAllOutputAssignments,
    setShowAllOutputAssignments,
    showAllSerialPorts,
    setShowAllSerialPorts,
    customSerialBaudInputs,
    setCustomSerialBaudInputs,
    expandedSerialOptionsPortNumber,
    setExpandedSerialOptionsPortNumber
  }
}
