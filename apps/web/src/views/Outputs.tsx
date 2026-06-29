import type { ReactNode } from 'react'
import { Panel, StatusBadge } from '@arduconfig/ui-kit'

export type OutputsStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export type OutputsTaskId =
  | 'motor-setup'
  | 'direction-test'
  | 'esc-protocol'
  | 'servo-mapping'
  | 'peripherals'
  | 'review'

export interface OutputsTaskCard {
  id: OutputsTaskId
  label: string
  value: string
  detail: string
  tone: OutputsStatusTone
}

export interface OutputsViewProps {
  taskCards: readonly OutputsTaskCard[]
  activeTaskId: OutputsTaskId
  activeTask: OutputsTaskCard
  onSelectTask: (taskId: OutputsTaskId) => void
  /** Sticky sidebar with frame summary + current output map. Pass
   *  `undefined` to render the task body full-width (used by the
   *  Servos tab — the per-channel mapping table needs the whole
   *  workspace and the overview is redundant with the table). */
  overviewSlot?: ReactNode
  taskBodySlot: ReactNode
  reviewDockSlot?: ReactNode
  /** Panel title — defaults to "Outputs" but Motors/Servos nav tabs
   *  each pass their own so the heading matches the tab the user
   *  clicked into. */
  title?: string
  subtitle?: string
}

export function OutputsView(props: OutputsViewProps) {
  const {
    taskCards,
    activeTaskId,
    onSelectTask,
    overviewSlot,
    taskBodySlot,
    reviewDockSlot,
    title = 'Outputs',
    subtitle = 'Review frame geometry, output assignments, and key motor/peripheral settings before any output testing.'
  } = props

  return (
    <div id="setup-panel-outputs">
      <Panel title={title} subtitle={subtitle}>
        {/* Top tab selector: the tasks sit in a row of tabs; the active task's
            body renders once below them. (Replaced the old expand-in-place
            accordion.) */}
        <div className={`outputs-tabs-layout${overviewSlot ? '' : ' outputs-tabs-layout--full'}`}>
          <div className="tab-strip" data-testid="outputs-task-nav" role="tablist">
            {taskCards.map((task) => {
              const isActive = task.id === activeTaskId
              return (
                <button
                  key={task.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`outputs-summary-${task.id}`}
                  className={`tab-strip__tab${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectTask(task.id)}
                >
                  <span className="tab-strip__tab-title">{task.label}</span>
                  <StatusBadge tone={task.tone}>{task.value}</StatusBadge>
                </button>
              )
            })}
          </div>

          <div className="outputs-tab-body" data-testid={`outputs-task-body-${activeTaskId}`}>
            {taskBodySlot}
          </div>

          {overviewSlot ? (
            <aside className="outputs-tabs__overview outputs-overview">{overviewSlot}</aside>
          ) : null}

          {reviewDockSlot}
        </div>
      </Panel>
    </div>
  )
}
