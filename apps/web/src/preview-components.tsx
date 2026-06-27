import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactElement } from 'react'

import type { ConfiguratorSnapshot, RcAxisObservation } from '@arduconfig/ardupilot-core'

import { readRoundedParameter } from './selectors/parameter-read'

// The 3D craft preview pulls in three.js (~148 KB gzip). Lazy-load it so three.js
// is kept out of the first-paint bundle and only fetched when a preview first
// mounts (post-connect Setup / Receiver). The local wrapper keeps every call site
// (`<FlightDeckPreview .../>`) unchanged and provides the Suspense boundary plus a
// class-matched placeholder so the async swap-in does not shift layout.
const LazyFlightDeckPreview = lazy(() =>
  import('./flight-deck-preview').then((module) => ({ default: module.FlightDeckPreview }))
)

function FlightDeckPreview(props: ComponentProps<typeof LazyFlightDeckPreview>): ReactElement {
  return (
    <Suspense
      fallback={
        <div
          className={`flight-deck flight-deck--loading${props.compact ? ' flight-deck--compact' : ''}`}
          aria-hidden="true"
        />
      }
    >
      <LazyFlightDeckPreview {...props} />
    </Suspense>
  )
}

export function AttitudePreview({
  snapshot,
  compact = false,
  showReadouts = true,
  frameClassLabel,
  frameTypeLabel
}: {
  snapshot: ConfiguratorSnapshot
  compact?: boolean
  showReadouts?: boolean
  frameClassLabel?: string
  frameTypeLabel?: string
}) {
  return (
    <FlightDeckPreview
      rollDeg={snapshot.liveVerification.attitudeTelemetry.rollDeg}
      pitchDeg={snapshot.liveVerification.attitudeTelemetry.pitchDeg}
      yawDeg={snapshot.liveVerification.attitudeTelemetry.yawDeg}
      quaternion={snapshot.liveVerification.attitudeTelemetry.quaternion}
      flightMode={snapshot.vehicle?.flightMode}
      verified={snapshot.liveVerification.attitudeTelemetry.verified}
      vehicleType={snapshot.vehicle?.vehicle}
      frameClassLabel={frameClassLabel}
      frameTypeLabel={frameTypeLabel}
      quadFrameClass={readRoundedParameter(snapshot, 'Q_FRAME_CLASS')}
      quadFrameType={readRoundedParameter(snapshot, 'Q_FRAME_TYPE')}
      compact={compact}
      showReadouts={showReadouts}
      testId={compact ? undefined : 'setup-craft-preview'}
    />
  )
}

// Receiver-tab craft that banks/pitches/yaws with the live RC sticks (like
// ArduPilot's radio-calibration view), so the operator can confirm stick
// direction at a glance. Uses each axis' CALIBRATED deflection and honors the
// channel's RCx_REVERSED so the craft moves the way the flight controller
// actually interprets the stick — not just the raw PWM direction.
export function StickCraftPreview({
  observations,
  snapshot,
  verified,
  vehicleType,
  frameClassLabel,
  frameTypeLabel
}: {
  observations: readonly RcAxisObservation[]
  snapshot: ConfiguratorSnapshot
  verified: boolean
  vehicleType?: string
  frameClassLabel?: string
  frameTypeLabel?: string
}) {
  // Calibrated, reversal-aware stick deflection (-1 .. +1) for an axis: 0 when
  // centred, +/-1 at the calibrated extremes, sign flipped if the channel is
  // reversed (RCx_REVERSED). Falls back to raw 1500+/-500 if uncalibrated.
  const axisNorm = (axisId: string): number => {
    const obs = observations.find((axis) => axis.axisId === axisId)
    if (!obs || obs.pwm === undefined || !Number.isFinite(obs.pwm)) {
      return 0
    }
    // Deflection measured from the calibrated TRIM (centre), not the min/max
    // midpoint — otherwise an off-centre trim makes a centred stick read
    // non-zero, which (for yaw) makes the heading drift/spin at rest. 0 at
    // trim, +/-1 at the calibrated extremes; falls back to 1500us +/-500.
    const { pwm, calibratedTrim, calibratedMin, calibratedMax } = obs
    let value: number
    if (
      calibratedTrim !== undefined &&
      calibratedMin !== undefined &&
      calibratedMax !== undefined &&
      calibratedMax > calibratedMin &&
      calibratedTrim > calibratedMin &&
      calibratedTrim < calibratedMax
    ) {
      value = pwm >= calibratedTrim
        ? (pwm - calibratedTrim) / (calibratedMax - calibratedTrim)
        : (pwm - calibratedTrim) / (calibratedTrim - calibratedMin)
    } else {
      value = (pwm - 1500) / 500
    }
    const reversed = readRoundedParameter(snapshot, `RC${obs.channelNumber}_REVERSED`) === 1
    return Math.max(-1, Math.min(1, reversed ? -value : value))
  }
  const rollNorm = axisNorm('roll')
  const pitchNorm = axisNorm('pitch')
  const yawNorm = axisNorm('yaw')

  // Behave like an angle-mode multirotor: roll/pitch sticks command a
  // proportional LEAN ANGLE (centre = level), while the yaw stick is a RATE —
  // holding it spins the craft continuously and centring it holds heading.
  const yawNormRef = useRef(yawNorm)
  yawNormRef.current = yawNorm
  const [yawHeading, setYawHeading] = useState(0)
  useEffect(() => {
    const TICK_MS = 50
    const DEG_PER_SEC = 120
    const id = setInterval(() => {
      const n = yawNormRef.current
      if (Math.abs(n) <= 0.04) return // deadband: centred stick holds heading
      setYawHeading((heading) => (heading + n * DEG_PER_SEC * (TICK_MS / 1000) + 360) % 360)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return (
    // display:contents wrapper exposes the live attitude for tests without
    // affecting layout (e.g. asserting a centred yaw holds heading).
    <div
      style={{ display: 'contents' }}
      data-testid="receiver-stick-attitude"
      data-yaw-heading={Math.round(yawHeading)}
      data-roll-deg={Math.round(rollNorm * 35)}
      data-pitch-deg={Math.round(-pitchNorm * 35)}
    >
      <FlightDeckPreview
        rollDeg={rollNorm * 35}
        pitchDeg={-pitchNorm * 35}
        yawDeg={yawHeading}
        captionLabel={verified ? 'Moves with your live RC sticks' : 'Waiting on live RC input'}
        flightMode="Stick preview"
        verified={verified}
        vehicleType={vehicleType}
        frameClassLabel={frameClassLabel}
        frameTypeLabel={frameTypeLabel}
        quadFrameClass={readRoundedParameter(snapshot, 'Q_FRAME_CLASS')}
        quadFrameType={readRoundedParameter(snapshot, 'Q_FRAME_TYPE')}
        compact
        showReadouts={false}
        testId="receiver-stick-craft"
      />
    </div>
  )
}
