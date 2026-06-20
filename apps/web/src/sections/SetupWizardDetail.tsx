// Guided-setup wizard detail panel — the "What to do" copy, the
// accelerometer pose guide (accelerometer step only), the completion-criteria
// checklist, the live-evidence pills, and any blocking-reason copy.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational over the selected section
// descriptor and the live snapshot. Behavior-preserving.

import type { ReactElement } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { AccelerometerPoseGuide } from '../accelerometer-pose-guide'
import { accelerometerPoseFromAction } from '../guided-action-helpers'
import type { SetupFlowSectionDescriptor } from '../app-types'

export interface SetupWizardDetailProps {
  selectedSetupSection: SetupFlowSectionDescriptor
  snapshot: ConfiguratorSnapshot
}

export function SetupWizardDetail({ selectedSetupSection, snapshot }: SetupWizardDetailProps): ReactElement {
  return (
    <div className="setup-wizard__detail">
      <div>
        <h4>What to do</h4>
        <p>{selectedSetupSection.detail}</p>
      </div>

      {selectedSetupSection.id === 'accelerometer' ? (
        <AccelerometerPoseGuide
          currentPose={accelerometerPoseFromAction(snapshot)}
          rollDeg={snapshot.liveVerification.attitudeTelemetry.rollDeg}
          pitchDeg={snapshot.liveVerification.attitudeTelemetry.pitchDeg}
          attitudeVerified={snapshot.liveVerification.attitudeTelemetry.verified}
        />
      ) : null}

      <div className="setup-flow__criteria">
        <strong>Completion Criteria</strong>
        <ul>
          {selectedSetupSection.criteria.map((criterion) => (
            <li key={criterion.label} className={criterion.met ? 'is-met' : undefined}>
              <span>{criterion.met ? 'Complete' : 'Pending'}</span>
              <span>{criterion.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {selectedSetupSection.evidence.length > 0 ? (
        <div className="setup-wizard__evidence">
          <strong>Live Evidence</strong>
          <div className="config-pills">
            {selectedSetupSection.evidence.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      ) : null}

      {selectedSetupSection.blockingReason ? <p className="setup-flow__blocking-copy">{selectedSetupSection.blockingReason}</p> : null}
    </div>
  )
}
