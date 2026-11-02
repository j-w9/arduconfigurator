import type { ReactNode } from 'react'
import { Panel } from '@arduconfig/ui-kit'

export interface SnapshotsViewProps {
  hiddenInputsSlot?: ReactNode
  /** "Reset to Defaults" control, near the top where the operator already is
   *  when deciding they want a clean slate. */
  resetToDefaultsSlot?: ReactNode
  libraryFormSlot: ReactNode
  selectedSnapshotSlot: ReactNode
  provisioningFormSlot: ReactNode
  provisioningPreviewSlot: ReactNode
}

export function SnapshotsView(props: SnapshotsViewProps) {
  const {
    hiddenInputsSlot,
    resetToDefaultsSlot,
    libraryFormSlot,
    selectedSnapshotSlot,
    provisioningFormSlot,
    provisioningPreviewSlot,
  } = props

  return (
    <section className="grid one-up snapshots-page" id="setup-panel-snapshots">
      <Panel
        title="Snapshots"
      >
        <div className="telemetry-stack snapshots-page__stack">
          {hiddenInputsSlot}

          {resetToDefaultsSlot ? (
            <div className="snapshots-page__reset" data-testid="snapshots-reset-row">
              {resetToDefaultsSlot}
            </div>
          ) : null}

          <section className="snapshots-slab snapshots-slab--library">
            {libraryFormSlot}

            <div className="snapshots-workspace">
              {selectedSnapshotSlot}
            </div>
          </section>

          <section className="snapshot-selected provisioning-section snapshots-slab snapshots-slab--provisioning">
            {provisioningFormSlot}

            <div className="snapshots-workspace">
              {provisioningPreviewSlot}
            </div>
          </section>
        </div>
      </Panel>
    </section>
  )
}
