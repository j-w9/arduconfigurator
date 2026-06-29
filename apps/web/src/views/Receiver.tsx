import type { ReactNode } from 'react'
import { Panel, StatusBadge } from '@arduconfig/ui-kit'

export type ReceiverStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type ReceiverTaskId = 'mapping' | 'endpoints' | 'flight-modes' | 'advanced' | 'review'

export interface ReceiverTaskCard {
  id: ReceiverTaskId
  label: string
  value: string
  detail: string
  tone: ReceiverStatusTone
}

export interface ReceiverViewProps {
  taskCards: readonly ReceiverTaskCard[]
  activeTaskId: ReceiverTaskId
  activeTask: ReceiverTaskCard
  onSelectTask: (taskId: ReceiverTaskId) => void
  liveMonitorSlot: ReactNode
  taskBodySlot: ReactNode
  helpDockSlot?: ReactNode
}

export function ReceiverView(props: ReceiverViewProps) {
  const { taskCards, activeTaskId, activeTask, onSelectTask, liveMonitorSlot, taskBodySlot, helpDockSlot } = props

  return (
    <div id="setup-panel-rc">
      <Panel title="Receiver">
        <div className="telemetry-stack telemetry-stack--receiver">
          <div className="receiver-summary-grid">
            {taskCards.map((task) => (
              <button
                key={task.id}
                type="button"
                data-testid={`receiver-summary-${task.id}`}
                className={`receiver-summary-card${task.id === activeTaskId ? ' is-active' : ''}`}
                onClick={() => onSelectTask(task.id)}
              >
                <div className="receiver-summary-card__header">
                  <span>
                    {task.label}{' '}
                    <span className="receiver-info-dot" aria-label={task.detail}>
                      i
                      <span className="receiver-info-tip" role="tooltip">{task.detail}</span>
                    </span>
                  </span>
                  <StatusBadge tone={task.tone}>{task.value}</StatusBadge>
                </div>
              </button>
            ))}
          </div>

          <div className="receiver-workspace receiver-workspace--task-deck">
            <div className="receiver-workspace__live receiver-monitor">{liveMonitorSlot}</div>

            <div className="receiver-workspace__config receiver-task-deck">
              <div className="receiver-task-deck__header">
                <div>
                  <h3>
                    {activeTask.label}{' '}
                    <span className="receiver-info-dot" aria-label={activeTask.detail}>
                      i
                      <span className="receiver-info-tip" role="tooltip">{activeTask.detail}</span>
                    </span>
                  </h3>
                </div>
                <StatusBadge tone={activeTask.tone}>{activeTask.value}</StatusBadge>
              </div>

              <div className="receiver-task-nav" data-testid="receiver-task-nav">
                {taskCards.map((task) => (
                  <button
                    key={`task-nav:${task.id}`}
                    type="button"
                    className={`receiver-task-nav__button${task.id === activeTaskId ? ' is-active' : ''}`}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <span>{task.label}</span>
                    <small>{task.value}</small>
                  </button>
                ))}
              </div>

              {taskBodySlot}
            </div>
          </div>

          {helpDockSlot}
        </div>
      </Panel>
    </div>
  )
}
