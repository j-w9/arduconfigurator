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
        {/* Betaflight-style accordion: each task is a single card you click to
            expand in place — one selector, body shown inline, no separate
            "pick a task" nav + detached body pane. The overview rides along as
            a sticky sidebar (Motors); the Servos tab drops it for full width. */}
        <div className={`outputs-accordion-layout${overviewSlot ? '' : ' outputs-accordion-layout--full'}`}>
          <div className="outputs-accordion" data-testid="outputs-task-nav">
            {taskCards.map((task) => {
              const isActive = task.id === activeTaskId
              return (
                <section
                  key={task.id}
                  className={`outputs-accordion-card${isActive ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    data-testid={`outputs-summary-${task.id}`}
                    className="outputs-accordion-card__header"
                    aria-expanded={isActive}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <span className="outputs-accordion-card__chevron" aria-hidden="true">{isActive ? '▾' : '▸'}</span>
                    <span className="outputs-accordion-card__title">{task.label}</span>
                    <StatusBadge tone={task.tone}>{task.value}</StatusBadge>
                    <p className="outputs-accordion-card__detail">{task.detail}</p>
                  </button>
                  {isActive ? (
                    <div
                      className="outputs-accordion-card__body"
                      data-testid={`outputs-task-body-${task.id}`}
                    >
                      {taskBodySlot}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>

          {overviewSlot ? (
            <aside className="outputs-accordion__overview outputs-overview">{overviewSlot}</aside>
          ) : null}

          {reviewDockSlot}
        </div>
      </Panel>
    </div>
  )
}
