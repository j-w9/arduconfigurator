import type { ReactNode } from 'react'
import { Panel } from '@arduconfig/ui-kit'

export type ReceiverStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

/** The five former sub-tabs. They are sections of one page now; the ids stay
 *  because the guided wizard routes to them (`setReceiverTaskOverride`) and
 *  the jump links carry them as test ids. `functions` shares the Channels
 *  section with `endpoints`: a channel's function and its endpoints are
 *  columns of the same row. */
export type ReceiverTaskId = 'mapping' | 'endpoints' | 'flight-modes' | 'functions' | 'advanced'

export interface ReceiverTaskCard {
  id: ReceiverTaskId
  label: string
  value: string
  detail: string
  tone: ReceiverStatusTone
}

/** The DOM id of a section, for the wizard's deep links and the jump row. */
export function receiverSectionElementId(taskId: ReceiverTaskId): string {
  return `receiver-section-${taskId === 'functions' ? 'endpoints' : taskId}`
}

/** Jump links, in page order. One per section that has a box of its own. */

export interface ReceiverViewProps {
  taskCards: readonly ReceiverTaskCard[]
  activeTaskId: ReceiverTaskId
  activeTask: ReceiverTaskCard
  onSelectTask: (taskId: ReceiverTaskId) => void
  /** Live RC status badge, on the jump row's left. */
  statusSlot?: ReactNode
  /** One line: the RCMAP picks and the guided mapping; grows while a capture runs. */
  mapSlot: ReactNode
  /** The channel-direction check: the reacting craft beside the four verdict rows. */
  directionSlot: ReactNode
  /** One row per reported channel: function, live bar, reverse, endpoints. */
  channelsSlot: ReactNode
  /** Mode channel, the six slots, the arm switch. */
  flightModesSlot: ReactNode
  /** RSSI, RC options, protocols, input rate — collapsed by default. */
  advancedSlot: ReactNode
  helpDockSlot?: ReactNode
}

/**
 * The Receiver tab as one page, the way Motors is one page: the five former
 * sub-tabs dissolve into bands of a page grid. The old tab strip is a row of
 * small jump links (same `receiver-task-nav` / `receiver-tab-*` hooks), which
 * is what a phone-length page needs and what the tests and the wizard's deep
 * links already drive.
 */
export function ReceiverView(props: ReceiverViewProps) {
  const { mapSlot, directionSlot, channelsSlot, flightModesSlot, advancedSlot, helpDockSlot } = props

  // No jump row and no status badge on the title line: every band is on the
  // page, and the live channel count is the table itself. The wizard's deep
  // links still land on the bands' ids through the section's scroll handler.
  return (
    <div id="setup-panel-rc">
      <Panel title="Receiver">
        <div className="telemetry-stack telemetry-stack--receiver receiver-page">
          {mapSlot}
          {directionSlot}

          {channelsSlot}
          {flightModesSlot}
          {advancedSlot}

          {helpDockSlot}
        </div>
      </Panel>
    </div>
  )
}
