import { useEffect, useRef, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  ORIENTATION_MATCH_LIMIT_DEG,
  detectBoardOrientation,
  findRotation,
  summariseSteadyWindow,
  type AccelCalPose,
  type OrientationDetection,
  type OrientationSample,
  type Vector3
} from '../view-models/board-orientation-detect'

/** Poses the card asks for, in the order they are captured. */
const CAPTURE_POSES: { pose: AccelCalPose; label: string; how: string }[] = [
  { pose: 'level', label: 'Level', how: 'Vehicle flat on the bench, as it sits in normal flight.' },
  {
    pose: 'nose-down',
    label: 'Nose down',
    how: 'Stand it on its nose, front edge down. This is what tells us which way forward is.'
  }
]

/** ~1s at the boosted 10 Hz stream: enough to see movement. */
const WINDOW_SAMPLES = 10

/**
 * SCALED_IMU is requested at 1 Hz for the whole session, because the only thing
 * that wanted it was the TCAL temperature readout and temperature moves slowly.
 * One sample a second cannot tell a held pose from a slow hand -- and filling a
 * window would take ten seconds. Ask for 10 Hz while this card is on screen and
 * put it back afterwards, rather than making every session carry the bandwidth
 * for a surface used once per build.
 */
const CAPTURE_INTERVAL_US = 100_000
const BASELINE_INTERVAL_US = 1_000_000

export interface BoardOrientationCardProps {
  /** Live accelerometer in m/s², vehicle frame, or undefined before any arrives. */
  accelMss: { x: number; y: number; z: number } | undefined
  /** Live AHRS_ORIENTATION, or undefined while parameters are still syncing. */
  currentOrientation: number | undefined
  /** Stage the proposed value as a draft. This card never writes. */
  onStage: (value: number) => void
  /** Ask the vehicle for a different SCALED_IMU rate; see CAPTURE_INTERVAL_US. */
  onRequestImuRate?: (intervalUs: number) => void | Promise<void>
  disabled?: boolean
}

function formatVector(v: Vector3): string {
  return `x ${v[0].toFixed(2)}  y ${v[1].toFixed(2)}  z ${v[2].toFixed(2)}`
}

/**
 * Measure how the flight controller is mounted, and offer the AHRS_ORIENTATION
 * that matches.
 *
 * The operator holds two poses; gravity in each is what identifies the
 * mounting. Level alone cannot do it -- it reads the same whether the board
 * faces forward, backward or sideways -- so the nose-down pose is where the
 * operator declares which end is the front, and that is what supplies yaw.
 *
 * The result is STAGED, never written. AHRS_ORIENTATION rotates the compass as
 * well as the IMU and only takes effect on the next boot, so it belongs in the
 * same review-and-apply flow as every other parameter change.
 */
export function BoardOrientationCard({
  accelMss,
  currentOrientation,
  onStage,
  onRequestImuRate,
  disabled = false
}: BoardOrientationCardProps): ReactElement {
  const window = useRef<Vector3[]>([])
  const [captured, setCaptured] = useState<Partial<Record<AccelCalPose, Vector3>>>({})
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [steady, setSteady] = useState(false)

  // Boost the IMU stream for as long as this card is mounted, and hand it back
  // on the way out so a session that visited Calibration once does not keep
  // paying for it.
  //
  // Reached through a ref, and depending on nothing. Parents pass this as an
  // inline arrow, so it is a new function every render; an effect depending on
  // it tears down and re-runs each time, which here meant firing a
  // SET_MESSAGE_INTERVAL pair on every render and leaving the rate wherever the
  // last cleanup put it. Mount and unmount are the only edges that matter.
  const requestImuRate = useRef(onRequestImuRate)
  requestImuRate.current = onRequestImuRate
  useEffect(() => {
    void requestImuRate.current?.(CAPTURE_INTERVAL_US)
    return () => {
      void requestImuRate.current?.(BASELINE_INTERVAL_US)
    }
  }, [])

  // Keep a rolling window so a capture reflects a held pose rather than one
  // frame that happened to look plausible mid-handling.
  useEffect(() => {
    if (!accelMss) return
    window.current = [...window.current, [accelMss.x, accelMss.y, accelMss.z] as Vector3].slice(-WINDOW_SAMPLES)
    setSteady(summariseSteadyWindow(window.current).steady)
  }, [accelMss])

  const samples: OrientationSample[] = (Object.entries(captured) as [AccelCalPose, Vector3][])
    .map(([pose, accel]) => ({ pose, accel }))

  const detection: OrientationDetection | undefined =
    samples.length >= 2 && currentOrientation !== undefined
      ? detectBoardOrientation(samples, currentOrientation)
      : undefined

  const currentRotation = currentOrientation !== undefined ? findRotation(currentOrientation) : undefined
  const live: Vector3 | undefined = accelMss ? [accelMss.x, accelMss.y, accelMss.z] : undefined

  const capture = (pose: AccelCalPose): void => {
    const summary = summariseSteadyWindow(window.current)
    if (!summary.steady || !summary.accel) {
      setNotice(summary.reason ?? 'Hold the pose still and try again.')
      return
    }
    setNotice(undefined)
    setCaptured((current) => ({ ...current, [pose]: summary.accel }))
  }

  return (
    <section className="bf-gui-box" data-testid="board-orientation-card">
      <div className="bf-gui-box__titlebar">
        <strong>Board orientation</strong>
        <StatusBadge tone={detection?.status === 'detected' ? (detection.alreadySet ? 'success' : 'warning') : 'neutral'}>
          {currentRotation ? currentRotation.name.replace('ROTATION_', '') : `AHRS_ORIENTATION ${currentOrientation ?? '?'}`}
        </StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Measures how the autopilot is actually mounted, instead of reading the arrow on the board.
          Hold each pose still and capture it — gravity says which way is down, and standing it on its
          nose is what tells us which way is forward.
        </p>

        <p className="bf-note" data-testid="board-orientation-live">
          Accelerometer:{' '}
          {live ? (
            <>
              <code>{formatVector(live)}</code> m/s²{' '}
              <StatusBadge tone={steady ? 'success' : 'warning'}>{steady ? 'steady' : 'moving'}</StatusBadge>
            </>
          ) : (
            'waiting for IMU data…'
          )}
        </p>

        <div className="button-row">
          {CAPTURE_POSES.map(({ pose, label, how }) => (
            <button
              key={pose}
              type="button"
              style={buttonStyle(captured[pose] ? undefined : 'primary')}
              data-testid={`board-orientation-capture-${pose}`}
              title={how}
              disabled={disabled || !live}
              onClick={() => capture(pose)}
            >
              {captured[pose] ? `${label} ✓ recapture` : `Capture ${label.toLowerCase()}`}
            </button>
          ))}
          {samples.length > 0 ? (
            <button
              type="button"
              style={buttonStyle()}
              data-testid="board-orientation-reset"
              onClick={() => {
                setCaptured({})
                setNotice(undefined)
              }}
            >
              Start over
            </button>
          ) : null}
        </div>

        {CAPTURE_POSES.filter(({ pose }) => captured[pose]).map(({ pose, label }) => (
          <p className="bf-note" key={pose} data-testid={`board-orientation-sample-${pose}`}>
            {label}: <code>{formatVector(captured[pose]!)}</code>
          </p>
        ))}

        {notice ? (
          <p className="switch-exercise-warning" data-testid="board-orientation-notice">{notice}</p>
        ) : null}

        {detection && detection.status !== 'detected' ? (
          <p className="switch-exercise-warning" data-testid="board-orientation-problem">{detection.reason}</p>
        ) : null}

        {detection?.status === 'detected' && detection.best ? (
          <div className="scoped-review-card scoped-review-card--compact" data-testid="board-orientation-result">
            <div className="switch-exercise-card__header">
              <div>
                <strong>{detection.best.rotation.name.replace('ROTATION_', '')}</strong>
                <p>
                  AHRS_ORIENTATION {detection.best.rotation.value} — the poses agree with it to{' '}
                  {detection.best.residualDeg.toFixed(1)}°.
                </p>
              </div>
              <StatusBadge tone={detection.alreadySet ? 'success' : 'warning'}>
                {detection.alreadySet ? 'already set' : 'differs'}
              </StatusBadge>
            </div>

            {/* A near-tie is worth saying out loud: the fixed rotations are 45°
                apart in yaw, so a close runner-up means a pose was probably not
                held squarely rather than that the answer is finely balanced. */}
            {detection.runnerUp &&
            detection.runnerUp.residualDeg - detection.best.residualDeg < ORIENTATION_MATCH_LIMIT_DEG ? (
              <p className="bf-note" data-testid="board-orientation-close-call">
                Next closest is {detection.runnerUp.rotation.name.replace('ROTATION_', '')} at{' '}
                {detection.runnerUp.residualDeg.toFixed(1)}°. Re-capture with the poses held squarer if
                that looks more like your mounting.
              </p>
            ) : null}

            {detection.alreadySet ? (
              <p className="bf-note">Nothing to change — the setting already matches how the board is mounted.</p>
            ) : (
              <>
                <p className="bf-note">
                  Staging this replaces AHRS_ORIENTATION {currentOrientation}. It takes effect on the next
                  boot, and the vehicle needs re-levelling afterwards. It rotates the compass as well as the
                  IMU, so apply it only if the measurement matches how the board really sits.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    data-testid="board-orientation-stage"
                    disabled={disabled}
                    onClick={() => onStage(detection.best!.rotation.value)}
                  >
                    Stage AHRS_ORIENTATION = {detection.best.rotation.value}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
