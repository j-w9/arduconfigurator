import type { ReactNode } from 'react'
import { Panel } from '@arduconfig/ui-kit'

export type SetupMode = 'overview' | 'wizard'

export interface SetupViewProps {
  mode: SetupMode
  actionsSlot?: ReactNode
  overviewSlot: ReactNode
  wizardSlot: ReactNode
}

export function SetupView(props: SetupViewProps) {
  const { mode, actionsSlot, overviewSlot, wizardSlot } = props

  return (
    <section className="grid one-up">
      <Panel
        title={mode === 'wizard' ? 'Guided Setup' : 'Setup'}
        subtitle={
          mode === 'wizard'
            ? 'Work one setup step at a time with a single active task, clear evidence, and explicit next actions.'
            : undefined
        }
        actions={mode === 'wizard' ? actionsSlot : undefined}
      >
        <div className="setup-command-center">
          {mode === 'overview' ? overviewSlot : wizardSlot}
        </div>
      </Panel>
    </section>
  )
}
