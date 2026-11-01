// Setup-flow + ESC-calibration helpers, extracted from App.tsx as part of its
// decomposition. Pure helpers for ESC-calibration labels/instructions, mapping
// a setup section to its panel anchor / nav view / quick action, and deriving a
// setup section's status from its criteria. No React, no app state.

import { deriveEscSetupSummary } from '@arduconfig/ardupilot-core'
import type { AppViewId } from '@arduconfig/param-metadata'

import type { SetupFlowActionDescriptor, SetupFlowCriterion } from './app-types'

// DOM element ids for the Outputs/Setup-wizard scroll + action targets.
export const OUTPUTS_ORIENTATION_TARGET_ID = 'outputs-orientation-check'
export const OUTPUTS_ORIENTATION_BUTTON_ID = 'outputs-orientation-start'
export const OUTPUTS_BENCH_TARGET_ID = 'outputs-bench-lab'
export const OUTPUTS_MOTOR_START_BUTTON_ID = 'outputs-motor-verification-start'
export const OUTPUTS_MOTOR_TEST_BUTTON_ID = 'outputs-motor-test-run'
export const OUTPUTS_MOTOR_CONFIRM_BUTTON_ID = 'outputs-motor-confirm'
/** The spin-threshold wizard launcher on Motors ▸ Motor Setup (the Motor Range step's target). */
export const OUTPUTS_SPIN_WIZARD_ID = 'outputs-spin-thresholds'
/**
 * The single props-off / area-clear acknowledgement on the Motors tab.
 *
 * It used to sit inside the Test panel; on the one-page Motors layout there is
 * one ack for the whole page, pinned at the top, and the Test panel is a
 * sticky column beside it. Anything that tells the operator to acknowledge
 * before spinning needs to be able to put them in front of it.
 */
export const MOTORS_SAFETY_ACK_ID = 'motors-safety-ack'
export const SETUP_WIZARD_PRIMARY_ACTION_ID = 'setup-wizard-primary-action'
export const SETUP_WIZARD_NEXT_STEP_ID = 'setup-wizard-next-step'

export function escCalibrationPathLabel(path: ReturnType<typeof deriveEscSetupSummary>['calibrationPath']): string {
  switch (path) {
    case 'analog-calibration':
      return 'Analog ESC calibration'
    case 'digital-protocol':
      return 'Digital protocol review'
    default:
      return 'Manual ESC review'
  }
}

export function escCalibrationInstructions(escSetup: ReturnType<typeof deriveEscSetupSummary>): string[] {
  switch (escSetup.calibrationPath) {
    case 'analog-calibration':
      return [
        'Props off and USB unplugged, then run the all-at-once ESC calibration.',
        'Then reconnect, check the PWM range and re-check motor order.'
      ]
    case 'digital-protocol':
      // Digital protocols (DShot) need no ESC endpoint-calibration steps, so
      // there's nothing actionable to list here.
      return []
    default:
      return [
        'This ESC setup is not one the wizard knows. Check the protocol and motor range by hand.',
        'Sign off once the protocol, PWM range and spin thresholds make sense.'
      ]
  }
}

export function panelAnchorForSetupSection(sectionId: string): { panelId: string; panelLabel: string } {
  switch (sectionId) {
    case 'link':
      return { panelId: 'setup-panel-link', panelLabel: 'Vehicle Link' }
    case 'ports':
      return { panelId: 'setup-panel-ports', panelLabel: 'Ports' }
    // Frame class and type are edited in Setup ▸ Airframe & Powertrain (the
    // Motors tab no longer carries them).
    case 'airframe':
      return { panelId: 'setup-panel-airframe', panelLabel: 'Airframe' }
    case 'outputs':
      return { panelId: 'setup-panel-outputs', panelLabel: 'Motors' }
    case 'motor-range':
      return { panelId: 'setup-panel-outputs', panelLabel: 'Motors' }
    case 'readiness':
    case 'maiden':
    case 'hover':
    case 'filters':
    case 'autotune':
    case 'initial-tune':
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
    case 'accelerometer':
    case 'level':
    case 'compass':
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
    case 'radio':
      return { panelId: 'setup-panel-rc', panelLabel: 'Receiver' }
    // Modes and Failsafe each own a tab with its own anchor, and both anchors
    // already existed and were referenced by nothing. Modes sent the operator to
    // the Receiver view and Failsafe to the Config tab's power section -- neither
    // of which is where the step's parameters are edited. Same class of silent
    // breakage the power mapping below documents.
    // Flight modes are on the Receiver tab only (Setup dropped its copy).
    case 'modes':
      return { panelId: 'receiver-section-flight-modes', panelLabel: 'Flight Modes' }
    case 'failsafe':
      return { panelId: 'setup-panel-failsafe', panelLabel: 'Failsafe' }
    case 'power':
      return { panelId: 'setup-panel-power', panelLabel: 'Power' }
    default:
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
  }
}

export function setupPanelActionForSection(
  sectionId: string,
  panel: { panelId: string; panelLabel: string }
): SetupFlowActionDescriptor {
  switch (sectionId) {
    case 'outputs':
      // "Open Motor Verification" named a surface the Motors-tab redesign
      // retired; the anchor it targeted only renders inside the Copter-only
      // reorder panel, so on Plane the scroll gave up silently.
      return {
        kind: 'scroll',
        label: 'Open Motors',
        panelId: panel.panelId
      }
    case 'link':
      return {
        kind: 'scroll',
        label: 'Open Vehicle Link',
        panelId: panel.panelId
      }
    case 'radio':
      return {
        kind: 'scroll',
        label: 'Open Receiver',
        panelId: panel.panelId
      }
    case 'modes':
      return {
        kind: 'scroll',
        label: 'Open Flight Modes',
        panelId: panel.panelId
      }
    default:
      return {
        kind: 'scroll',
        label: `Open ${panel.panelLabel}`,
        panelId: panel.panelId
      }
  }
}

export function appViewForPanel(panelId: string): AppViewId {
  switch (panelId) {
    case 'setup-panel-link':
      return 'setup'
    // The guided wizard lives on its own 'guided-setup' tab now, so a jump to
    // the guided panel routes there (the 'setup' tab is the status dashboard).
    case 'setup-panel-guided':
      return 'guided-setup'
    case 'setup-panel-ports':
      return 'ports'
    case 'setup-panel-rc':
      return 'receiver'
    case 'setup-panel-outputs':
      // Setup panel "Outputs" focused on motor verification flow; lands
      // on the Motors nav tab. (Servos is a separate nav tab for aux
      // peripheral servo work and isn't part of the setup checklist.)
      return 'motors'
    case 'setup-panel-tuning':
      return 'tuning'
    case 'setup-panel-snapshots':
      return 'snapshots'
    case 'setup-panel-arming':
      // Arming checks are a Config category, like Power and Flight Modes.
      return 'config'
    case 'setup-panel-parameters':
      return 'parameters'
    case 'setup-panel-servos':
      // Plane/Rover/Sub outputs are the SERVOn_FUNCTION map, reviewed on the
      // Servos page -- the Motors page shows them a multirotor procedure.
      return 'servos'
    case 'setup-panel-calibration':
    case 'setup-panel-airframe':
      // Setup categories (configCategoryForPanel picks which).
      return 'config'
    case 'setup-panel-modes':
    case 'receiver-section-flight-modes':
      // Flight modes live on the Receiver tab only. Pointing this anywhere
      // else strands the guided Modes step with no visible error.
      return 'receiver'
    case 'setup-panel-failsafe':
      return 'failsafe'
    case 'setup-panel-power':
      // Power is a Config category now, not its own tab. This mapping is the
      // one that breaks silently when a surface moves: the guided Power step
      // routes through here, and pointing it at a view that no longer exists
      // strands the step with no visible error.
      return 'config'
    default:
      return 'parameters'
  }
}

/**
 * The Config CATEGORY a guided panel lives in, if it lives in one.
 *
 * Routing to the Config view is not enough on its own: ConfigView renders only
 * the active category, so a scroll to `#setup-panel-power` on a Config tab
 * sitting on Airframe finds nothing, retries eight frames, and gives up
 * silently. The caller selects the category before scrolling.
 */
export function configCategoryForPanel(panelId: string): 'power' | 'arming' | 'calibration' | 'airframe' | undefined {
  switch (panelId) {
    case 'setup-panel-airframe':
      return 'airframe'
    case 'setup-panel-calibration':
      return 'calibration'
    case 'setup-panel-power':
      return 'power'
    case 'setup-panel-arming':
      return 'arming'
    default:
      return undefined
  }
}

export function deriveSetupStatusFromCriteria(criteria: SetupFlowCriterion[]): 'attention' | 'in-progress' | 'complete' {
  if (criteria.length === 0) {
    return 'attention'
  }

  const criteriaMetCount = criteria.filter((criterion) => criterion.met).length
  if (criteriaMetCount === criteria.length) {
    return 'complete'
  }

  return criteriaMetCount === 0 ? 'attention' : 'in-progress'
}
