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
const RECEIVER_JUMP_LINKS: readonly { id: ReceiverTaskId; label: string }[] = [
  { id: 'mapping', label: 'Map' },
  { id: 'endpoints', label: 'Channels' },
  { id: 'flight-modes', label: 'Flight modes' },
  { id: 'advanced', label: 'Advanced' }
]

export interface ReceiverViewProps {
  taskCards: readonly ReceiverTaskCard[]
  activeTaskId: ReceiverTaskId
  activeTask: ReceiverTaskCard
  onSelectTask: (taskId: ReceiverTaskId) => void
  /** Live RC status badge, on the jump row's left. */
  statusSlot?: ReactNode
  /** Top band, left: the RCMAP picks and the guided mapping. */
  mapSlot: ReactNode
  /** Top band, right: the channel-direction check with its reacting craft. */
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
  const { onSelectTask, statusSlot, mapSlot, directionSlot, channelsSlot, flightModesSlot, advancedSlot, helpDockSlot } = props

  // The jump row shares the title line (the Panel's actions slot): the live
  // status beside the title, the links at the right edge, no row of its own.
  const jumpRow = (
    <div className="receiver-jump" data-testid="receiver-task-nav">
      <div className="receiver-jump__status">{statusSlot}</div>
      <nav className="receiver-jump__links" aria-label="Receiver sections">
        {RECEIVER_JUMP_LINKS.map((link) => (
          <button
            key={`task-nav:${link.id}`}
            type="button"
            className="receiver-jump__link"
            data-testid={`receiver-tab-${link.id}`}
            onClick={() => onSelectTask(link.id)}
          >
            {link.label}
          </button>
        ))}
      </nav>
    </div>
  )

  return (
    <div id="setup-panel-rc">
      <Panel title="Receiver" actions={jumpRow}>
        <div className="telemetry-stack telemetry-stack--receiver receiver-page">
          <div className="receiver-page__band receiver-page__band--top">
            {mapSlot}
            {directionSlot}
          </div>

          {channelsSlot}
          {flightModesSlot}
          {advancedSlot}

          {helpDockSlot}
        </div>
      </Panel>
    </div>
  )
}
