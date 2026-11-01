// Guided-setup wizard detail panel — the "What to do" copy, the
// accelerometer pose guide (accelerometer step only), and any blocking-reason
// copy.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational over the selected section
// descriptor and the live snapshot.
//
// The completion-criteria checklist and the live-evidence pills used to live
// here, at the bottom of the LEFT column. That is why every step scrolled: the
// left column carried the task card, the copy, the criteria AND the evidence
// while the right column held only a short action card, so the page was as tall
// as the tallest single column instead of the taller of two balanced ones. They
// now render in SetupWizardAside — "left = what you do, right = where you
// stand" — which is the one layout rule every step follows. The criteria are
// still shown (same data-testid, same open-when-incomplete behaviour); only the
// column they sit in changed.

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
  /** The "read the first flight's log" card, rendered on the maiden step only. */
  maidenFlightSlot?: ReactNode
  /** Hover-throttle learning + the throttle-controller card, on the hover step only. */
  hoverSlot?: ReactNode
  /** The notch-from-hover-log card, on the filters step only. */
  filtersSlot?: ReactNode
  /** The autotune flight card and the after-the-tune card, on the autotune step only. */
  autotuneSlot?: ReactNode
  /** The Initial Tune form, on the initial-tune step only. */
  initialTuneSlot?: ReactNode
}

export function SetupWizardDetail({
  selectedSetupSection,
  snapshot,
  compassLocationSlot,
  maidenFlightSlot,
  hoverSlot,
  filtersSlot,
  autotuneSlot,
  initialTuneSlot
}: SetupWizardDetailProps): ReactElement {
  // The criteria list is what actually gates the step, but it lived inside a
  // collapsed <details> and the header only showed "2/5 criteria" — never WHICH
  // one was unmet. That is the mechanical reason a blocked step reads as
  // "unclear what's wanted". Name the first unmet criterion up front; the full
  // list is one column over in the aside.
  return (
    <div className="setup-wizard__detail">
      {/* The work: whatever the step does on this page. Rendered only when
          there is something, so a step without work stays one column. */}
      {(selectedSetupSection.id === 'compass' && compassLocationSlot) ||
      (selectedSetupSection.id === 'maiden' && maidenFlightSlot) ||
      (selectedSetupSection.id === 'hover' && hoverSlot) ||
      (selectedSetupSection.id === 'filters' && filtersSlot) ||
      (selectedSetupSection.id === 'autotune' && autotuneSlot) ||
      (selectedSetupSection.id === 'initial-tune' && initialTuneSlot) ||
      selectedSetupSection.id === 'accelerometer' ? (
        <div className="setup-wizard__work">
          {selectedSetupSection.id === 'compass' && compassLocationSlot ? (
            <div className="setup-wizard__compass-location" data-testid="setup-wizard-compass-location">
              {compassLocationSlot}
            </div>
          ) : null}

          {selectedSetupSection.id === 'maiden' && maidenFlightSlot ? (
            <div className="setup-wizard__maiden-log" data-testid="setup-wizard-maiden-log">
              {maidenFlightSlot}
            </div>
          ) : null}

          {selectedSetupSection.id === 'hover' && hoverSlot ? (
            <div className="setup-wizard__hover" data-testid="setup-wizard-hover">
              {hoverSlot}
            </div>
          ) : null}

          {selectedSetupSection.id === 'filters' && filtersSlot ? (
            <div className="setup-wizard__filters" data-testid="setup-wizard-filters">
              {filtersSlot}
            </div>
          ) : null}

          {selectedSetupSection.id === 'initial-tune' && initialTuneSlot ? (
            <div className="setup-wizard__initial-tune" data-testid="setup-wizard-initial-tune">
              {initialTuneSlot}
            </div>
          ) : null}

          {selectedSetupSection.id === 'autotune' && autotuneSlot ? (
            <div className="setup-wizard__autotune" data-testid="setup-wizard-autotune">
              {autotuneSlot}
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
        </div>
      ) : null}
    </div>
  )
}
