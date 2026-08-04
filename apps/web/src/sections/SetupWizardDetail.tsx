// Guided-setup wizard detail panel — the "What to do" copy, the
// accelerometer pose guide (accelerometer step only), the completion-criteria
// checklist, the live-evidence pills, and any blocking-reason copy.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational over the selected section
// descriptor and the live snapshot. Behavior-preserving.

import type { ReactElement, ReactNode } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { AccelerometerPoseGuide } from '../accelerometer-pose-guide'
import { accelerometerPoseFromAction } from '../guided-action-helpers'
import type { SetupFlowSectionDescriptor } from '../app-types'

export interface SetupWizardDetailProps {
  selectedSetupSection: SetupFlowSectionDescriptor
  snapshot: ConfiguratorSnapshot
  /** "Set location (no GPS)" control, rendered on the compass step only.
   *  Compass calibration needs the EKF to have a position to finish yaw
   *  alignment, so without a fix it starts and then never progresses. The
   *  control needs the runtime (it streams synthetic GPS_INPUT), which this
   *  presentational component must not import — hence a slot. */
  compassLocationSlot?: ReactNode
}

export function SetupWizardDetail({
  selectedSetupSection,
  snapshot,
  compassLocationSlot
}: SetupWizardDetailProps): ReactElement {
  // The criteria list is what actually gates the step, but it lived inside a
  // collapsed <details> and the header only showed "2/5 criteria" — never WHICH
  // one was unmet. That is the mechanical reason a blocked step reads as
  // "unclear what's wanted". Name the first unmet criterion up front, and leave
  // the full list open whenever the step is not complete.
  const nextUnmetCriterion = selectedSetupSection.criteria.find((criterion) => !criterion.met)
  const stepComplete = selectedSetupSection.status === 'complete'

  return (
    <div className="setup-wizard__detail">
      <div>
        <h4>What to do</h4>
        <p>{selectedSetupSection.detail}</p>
      </div>

      {nextUnmetCriterion ? (
        <p className="setup-wizard__next-criterion" data-testid="setup-wizard-next-criterion">
          <strong>Still needed:</strong> {nextUnmetCriterion.label}
        </p>
      ) : null}

      {selectedSetupSection.id === 'compass' && compassLocationSlot ? (
        <div className="setup-wizard__compass-location" data-testid="setup-wizard-compass-location">
          {compassLocationSlot}
        </div>
      ) : null}

      {selectedSetupSection.id === 'accelerometer' ? (
        <AccelerometerPoseGuide
          currentPose={accelerometerPoseFromAction(snapshot)}
          rollDeg={snapshot.liveVerification.attitudeTelemetry.rollDeg}
          pitchDeg={snapshot.liveVerification.attitudeTelemetry.pitchDeg}
          attitudeVerified={snapshot.liveVerification.attitudeTelemetry.verified}
        />
      ) : null}

      <details className="setup-flow__criteria" data-testid="setup-wizard-criteria" open={!stepComplete}>
        <summary>
          <strong>Completion Criteria</strong>
          <span className="setup-flow__criteria-count">
            {selectedSetupSection.criteriaMetCount}/{selectedSetupSection.criteria.length} done
          </span>
        </summary>
        <ul>
          {selectedSetupSection.criteria.map((criterion) => (
            <li key={criterion.label} className={criterion.met ? 'is-met' : undefined}>
              <span>{criterion.met ? 'Complete' : 'Pending'}</span>
              <span>{criterion.label}</span>
            </li>
          ))}
        </ul>
      </details>

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
