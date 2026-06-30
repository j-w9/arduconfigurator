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
  const { taskCards, activeTaskId, onSelectTask, liveMonitorSlot, taskBodySlot, helpDockSlot } = props

  return (
    <div id="setup-panel-rc">
      <Panel title="Receiver">
        <div className="telemetry-stack telemetry-stack--receiver">
          <div className="receiver-workspace receiver-workspace--task-deck">
            <div className="receiver-workspace__live receiver-monitor">{liveMonitorSlot}</div>

            <div className="receiver-workspace__config receiver-task-deck">
              <div className="tab-strip" data-testid="receiver-task-nav">
                {taskCards.map((task) => (
                  <button
                    key={`task-nav:${task.id}`}
                    type="button"
                    data-testid={`receiver-tab-${task.id}`}
                    className={`tab-strip__tab${task.id === activeTaskId ? ' is-active' : ''}`}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <span className="tab-strip__tab-title">
                      {task.label}{' '}
                      <span className="receiver-info-dot" aria-hidden="true">
                        i
                        <span className="receiver-info-tip" role="tooltip">{task.detail}</span>
                      </span>
                    </span>
                    <StatusBadge tone={task.tone}>{task.value}</StatusBadge>
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
