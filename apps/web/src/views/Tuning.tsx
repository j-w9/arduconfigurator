import type { ReactNode } from 'react'
import { Panel, StatusBadge } from '@arduconfig/ui-kit'

export type TuningStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type TuningTaskId = 'rates' | 'pid-gains' | 'filters' | 'profiles' | 'review'

export interface TuningTaskCard {
  id: TuningTaskId
  label: string
  value: string
  detail: string
  tone: TuningStatusTone
}

export interface TuningViewProps {
  taskCards: readonly TuningTaskCard[]
  activeTaskId: TuningTaskId
  activeTask: TuningTaskCard
  onSelectTask: (taskId: TuningTaskId) => void
  taskBodySlot: ReactNode
  overviewSlot: ReactNode
  noticeSlot?: ReactNode
}

export function TuningView(props: TuningViewProps) {
  const { taskCards, activeTaskId, onSelectTask, taskBodySlot, overviewSlot, noticeSlot } = props

  return (
    <section className="grid one-up tuning-page">
      <Panel
        title="Tuning"
        subtitle="Curated ArduPilot rate, gain, and filter tuning."
      >
        <div className="telemetry-stack telemetry-stack--tuning">
          {noticeSlot}

          <div className="tuning-workspace tuning-workspace--task-deck">
            <div className="tuning-workspace__task tuning-task-deck">
              <div className="tab-strip" data-testid="tuning-task-nav">
                {taskCards.map((task) => (
                  <button
                    key={`tuning-task-nav:${task.id}`}
                    type="button"
                    data-testid={`tuning-tab-${task.id}`}
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

            <div className="tuning-workspace__overview tuning-overview">{overviewSlot}</div>
          </div>
        </div>
      </Panel>
    </section>
  )
}
