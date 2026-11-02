// Tuning ▸ Hover and Tuning ▸ SFD.
//
// Hover: the hover throttle, the first flight a tune depends on. Learned in the
// air, or measured from a log when the firmware's own learner will not run.
//
// SFD: SmallFastDrone fork features in one place, current and future. The
// accelerometer Z-bias (needs the fork's ACC_ZBIAS_LEARN and an accepted hover
// throttle; learned last, after the tune), baro thrust (VALT, where the
// firmware has it), and the failsafe options the fork extends, repeated here
// from the Failsafe tab on purpose so the fork's settings sit together.

import type { ReactElement } from 'react'

import {
  detectSfdBaroThrustCompensation,
  detectSfdFailsafeAltholdDrift,
  detectSfdValtMode,
  type ConfiguratorSnapshot,
  type ParameterState
} from '@arduconfig/ardupilot-core'

import { ScopedBitmaskField, ScopedSelectField, type ScopedFieldDraftMap } from '../views/ScopedField'
import { AccelZBiasCard } from './AccelZBiasCard'
import { HoverThrottleFromLogCard } from './HoverThrottleFromLogCard'
import { HoverThrottleLearnCard } from './HoverThrottleLearnCard'
import { ValtCalibrationCard, type ValtCalibrationCardProps } from './ValtCalibrationCard'

/** The fork's Z-bias learner; its presence is the Z-bias feature. */
const SFD_ZBIAS_PARAM_ID = 'ACC_ZBIAS_LEARN'

/** True when the firmware reports any SmallFastDrone fork feature. */
export function detectSfdFeatures(parameterIds: readonly string[]): boolean {
  return (
    parameterIds.includes(SFD_ZBIAS_PARAM_ID) ||
    detectSfdBaroThrustCompensation(parameterIds) ||
    detectSfdValtMode(parameterIds) ||
    detectSfdFailsafeAltholdDrift(parameterIds)
  )
}

interface FlightCardsCommonProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
  editedValues: Record<string, string>
  /** The vehicle's own logs, so a card can fit a flight without a download. */
  onboardLogs?: ValtCalibrationCardProps['onboardLogs']
}

export function HoverCalibrationCards({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft,
  editedValues,
  onboardLogs
}: FlightCardsCommonProps): ReactElement {
  return (
    <div className="calibration-grid" data-testid="calibration-grid-hover">
      <HoverThrottleLearnCard
        snapshot={snapshot}
        canApplyDraftParameters={canApplyDraftParameters}
        busyAction={busyAction}
        setDraft={setDraft}
        editedValues={editedValues}
      />
      <HoverThrottleFromLogCard
        snapshot={snapshot}
        canApplyDraftParameters={canApplyDraftParameters}
        busyAction={busyAction}
        setDraft={setDraft}
        onboardLogs={onboardLogs}
      />
    </div>
  )
}

export interface SfdTuningCardsProps extends FlightCardsCommonProps {
  /** Where the operator is signed in to a log server, shown on the VALT card. */
  logServerLabel?: string
  /** A synced parameter with the metadata the app shows for it (fork labels included). */
  parameterFor: (paramId: string) => ParameterState | undefined
  draftStatusById: ScopedFieldDraftMap
}

export function SfdTuningCards({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft,
  editedValues,
  onboardLogs,
  logServerLabel,
  parameterFor,
  draftStatusById
}: SfdTuningCardsProps): ReactElement {
  const ids = snapshot.parameters.map((parameter) => parameter.id)
  const fsOptions = parameterFor('FS_OPTIONS')
  const fsEkfAction = parameterFor('FS_EKF_ACTION')
  const onChange = (paramId: string, value: string): void => setDraft(paramId, value)
  return (
    <div className="calibration-grid" data-testid="calibration-grid-sfd">
      {/* Most looked-at first: the failsafe options, then the Z-bias, then
          the one-off baro thrust calibration. */}
      {fsOptions || fsEkfAction ? (
        <article className="calibration-card" data-testid="sfd-failsafe-card">
          <div className="calibration-card__header">
            <strong>Failsafe options</strong>
          </div>
          <p>The same settings as the Failsafe tab, here because the fork changes what they do.</p>
          {fsOptions ? (
            <ScopedBitmaskField
              parameter={fsOptions}
              liveValue={fsOptions.value}
              editedValues={editedValues}
              onChange={onChange}
              draftStatusById={draftStatusById}
            />
          ) : null}
          {fsEkfAction ? (
            <ScopedSelectField
              parameter={fsEkfAction}
              liveValue={fsEkfAction.value}
              editedValues={editedValues}
              onChange={onChange}
              draftStatusById={draftStatusById}
            />
          ) : null}
        </article>
      ) : null}
      {ids.includes(SFD_ZBIAS_PARAM_ID) ? (
        <AccelZBiasCard
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          setDraft={setDraft}
          editedValues={editedValues}
        />
      ) : null}
      {detectSfdBaroThrustCompensation(ids) ? (
        <ValtCalibrationCard
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          setDraft={setDraft}
          logServerLabel={logServerLabel}
          onboardLogs={onboardLogs}
        />
      ) : null}
    </div>
  )
}
