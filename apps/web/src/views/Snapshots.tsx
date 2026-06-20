import type { ReactNode } from 'react'
import { Panel } from '@arduconfig/ui-kit'

export interface SnapshotsViewProps {
  snapshotsCount: number
  profilesCount: number
  activeDiffCount: number
  hiddenInputsSlot?: ReactNode
  libraryFormSlot: ReactNode
  selectedSnapshotSlot: ReactNode
  provisioningFormSlot: ReactNode
  provisioningPreviewSlot: ReactNode
}

export function SnapshotsView(props: SnapshotsViewProps) {
  const {
    snapshotsCount,
    profilesCount,
    activeDiffCount,
    hiddenInputsSlot,
    libraryFormSlot,
    selectedSnapshotSlot,
    provisioningFormSlot,
    provisioningPreviewSlot,
  } = props

  return (
    <section className="grid one-up snapshots-page">
      <Panel
        title="Snapshots"
        subtitle="Trusted baselines and provisioning profiles."
      >
        <div className="telemetry-stack snapshots-page__stack">
          {hiddenInputsSlot}

          <div className="snapshots-page__hero">
            <div className="snapshots-page__hero-copy">
              <span className="snapshots-page__eyebrow">Configuration Baselines</span>
              <h3>Local libraries for restore and batch provisioning</h3>
              <p>Capture trusted baselines, build reusable provisioning profiles, and apply only the verified diff back to a live vehicle.</p>
            </div>
            <div className="snapshots-page__hero-metrics">
              <div className="snapshots-page__hero-metric">
                <span>Snapshots</span>
                <strong>{snapshotsCount}</strong>
              </div>
              <div className="snapshots-page__hero-metric">
                <span>Profiles</span>
                <strong>{profilesCount}</strong>
              </div>
              <div className="snapshots-page__hero-metric">
                <span>Active diff</span>
                <strong>{activeDiffCount}</strong>
              </div>
            </div>
          </div>

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
