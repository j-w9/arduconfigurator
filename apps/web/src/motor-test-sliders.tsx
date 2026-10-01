import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

interface MotorTestSlidersProps {
  targets: Array<{
    value: number
    label: string
  }>
  selectedOutput: number | undefined
  throttlePercent: number
  onSelectOutput: (output: number) => void
  onThrottleChange: (percent: number) => void
  onTest: () => void
  testDisabled: boolean
  /** Abort an in-progress test (zero-throttle DO_MOTOR_TEST). */
  onStop: () => void
  /** Whether a test is currently running/requested (Stop is actionable). */
  stopEnabled: boolean
  masterEnabled: boolean
  testId?: string
  /** Called once per drag, on pointer release, with the final value. Use this
   *  rather than onThrottleChange for anything that talks to the vehicle. */
  onThrottleCommit?: (percent: number) => void
  /** Ceiling for the typed percent field AND the top of every track. Defaults
   *  to 100. The spin wizard passes its own ceiling so the whole track covers
   *  the range it can use -- at full scale its usable 0-20% lived in the
   *  bottom fifth of the track, about 16px for twenty steps, which is what
   *  made it feel blocky.  */
  maxPercent?: number
  /** Track height in px. The compact Motors column and a dialog with room to
   *  spare want different sizes. */
  trackHeight?: number
  /** Measured RPM per output channel, printed under each column so the
   *  commanded value and the measured one sit together. Omit on a vehicle
   *  without ESC telemetry and no line renders. `status` lands on the wrapper
   *  as data-status. */
  rpm?: {
    status: 'unavailable' | 'stale' | 'live'
    byOutput: Record<number, { rpm?: number; temperatureC?: number; fresh: boolean }>
  }
  /** Test length in seconds, beside the percent field. */
  durationSeconds?: number
  maxDurationSeconds?: number
  onDurationChange?: (seconds: number) => void
  /** Show an "at once" switch while the ALL column is selected. Sequence is
   *  the default; at-once is the simultaneous sentinel. */
  simultaneousToggle?: boolean
  /** Hooks for the guided wizard: its deep link scrolls to this id, and its
   *  pulse class lands on the Test button. */
  testButtonId?: string
  testButtonClassName?: string
  /** Vertical (default): short tall tracks side by side, the wizard's shape.
   *  Horizontal: one row per motor -- label, a full-width track, the percent,
   *  the measured RPM -- so the box reads as a table and the track is as long
   *  as the box is wide. The Motors tab's column uses this. */
  orientation?: 'vertical' | 'horizontal'
}

/* ── palette constants (mirrors :root tokens for inline styles) ── */

// Structural colours read CSS theme tokens (inline styles resolve var()) so the
// vertical sliders follow the light/dark theme; the throttle fill + accents stay
// fixed data colours.
const color = {
  bgPanelMuted: 'var(--bg-panel-muted)',
  bgPanel: 'var(--bg-panel)',
  bgPanelRaised: 'var(--bg-panel-raised)',
  bgSurfaceStrong: 'var(--bg-surface-strong)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  borderAccent: 'var(--border-accent)',
  accent: '#6db8e0',
  accentWeak: 'rgba(109, 184, 224, 0.14)',
  warning: '#dab254',
  warningWeak: 'rgba(218, 178, 84, 0.14)',
  danger: '#d46b62',
  dangerWeak: 'rgba(212, 107, 98, 0.12)',
  success: '#5cc28a',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textDim: 'var(--text-dim)',
  fontData: 'var(--font-data)',
} as const

/* ── geometry ── */

// Default track height, for the compact Motors column: 62. The buttons sit
// beside the sliders rather than under them to pay for it. This column is
// tight -- a 200px track pushed the rest of the test panel below the fold on a
// laptop -- and it is for quick per-motor checks, so fine granularity is not
// its job. Callers with room and a reason pass their own: the spin-threshold
// wizard uses 180, because easing up on a break-away point is exactly the case
// that needs travel per step.
const TRACK_HEIGHT = 58
// Narrow tracks: this is a column beside the settings now, not a full-width
// row, and 36px columns pushed the ALL tile off a 300px column at laptop
// widths. The pointer handlers are on the tile, not the visible bar, so the
// grab area does not shrink with the paint.
const TRACK_WIDTH = 18
const MASTER_TRACK_WIDTH = 24
const HANDLE_HEIGHT = 10
const MASTER_OUTPUT_VALUE = 0
// Mirrors ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS in motor-test-helpers.ts: the
// "spin every motor at once" sentinel. The ALL tile drives either all-mode.
const SIMULTANEOUS_OUTPUT_VALUE = -1

/* ── helpers ── */

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function percentFromY(trackEl: HTMLElement, clientY: number, fullScale: number): number {
  const rect = trackEl.getBoundingClientRect()
  const yInTrack = clamp(clientY - rect.top, 0, rect.height)
  // top of track = fullScale, bottom = 0%
  return Math.round((1 - yInTrack / rect.height) * fullScale)
}

function percentFromX(trackEl: HTMLElement, clientX: number, fullScale: number): number {
  const rect = trackEl.getBoundingClientRect()
  const xInTrack = clamp(clientX - rect.left, 0, rect.width)
  // left of track = 0%, right = fullScale
  return Math.round((xInTrack / rect.width) * fullScale)
}

/** Generates a vertical gradient string from warning (bottom) to danger (top). */
function fillGradient(pct: number): string {
  if (pct <= 0) return 'transparent'
  return `linear-gradient(to top, ${color.warning} 0%, ${color.danger} 100%)`
}

/* ── sub-components ── */

function SliderColumn({
  label,
  percent,
  selected,
  wide,
  onSelect,
  onDrag,
  onCommit,
  fullScale,
  trackHeight,
  rpm,
  rpmTestId,
}: {
  label: string
  percent: number
  selected: boolean
  wide?: boolean
  onSelect: () => void
  onDrag: (pct: number) => void
  onCommit?: (pct: number) => void
  /** Throttle at the top of the track. 100 for the motor test; the spin wizard
   *  passes its own ceiling so the whole track covers the range it can use. */
  fullScale: number
  trackHeight: number
  /** Measured RPM under the label; undefined = no telemetry line at all. */
  rpm?: { rpm?: number; fresh: boolean }
  rpmTestId?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // Pointer events (not mouse) so finger drags work on touch devices too — the
  // old mouse-only handler never fired mousemove/mouseup during a touch drag, so
  // the sliders couldn't be moved by finger on phones. Pointer capture keeps the
  // drag tracking if the finger leaves the track; the track's touch-action:none
  // (below) stops the browser from stealing the gesture as a scroll.
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      onSelect()
      const track = trackRef.current
      if (!track) return
      dragging.current = true
      try {
        track.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released/invalid — capture is best-effort.
      }
      onDrag(percentFromY(track, e.clientY, fullScale))

      const onMove = (ev: globalThis.PointerEvent) => {
        if (!dragging.current || !trackRef.current) return
        onDrag(percentFromY(trackRef.current, ev.clientY, fullScale))
      }
      const onUp = (ev: globalThis.PointerEvent) => {
        if (!dragging.current) return
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        // Commit on release. A consumer that sends a command per value would
        // otherwise send one per pointermove -- dozens per drag.
        if (onCommit && trackRef.current) {
          onCommit(percentFromY(trackRef.current, ev.clientY, fullScale))
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onSelect, onDrag, onCommit, fullScale],
  )

  const trackW = wide ? MASTER_TRACK_WIDTH : TRACK_WIDTH

  const columnStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    userSelect: 'none',
  }

  const readoutStyle: CSSProperties = {
    fontFamily: color.fontData,
    fontSize: 11,
    fontWeight: 700,
    color: percent > 0 ? color.text : color.textDim,
    letterSpacing: '0.02em',
    minWidth: trackW,
    textAlign: 'center',
  }

  const trackOuterStyle: CSSProperties = {
    position: 'relative',
    width: trackW,
    height: trackHeight,
    background: color.bgPanelMuted,
    borderRadius: trackW / 2,
    border: `2px solid ${selected ? color.accent : color.border}`,
    boxShadow: selected
      ? `0 0 8px ${color.borderAccent}, inset 0 2px 6px rgba(0,0,0,0.35)`
      : 'inset 0 2px 6px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    // Claim the touch gesture so a finger drag adjusts the slider instead of
    // scrolling the page.
    touchAction: 'none',
  }

  const fillHeight = (Math.min(percent, fullScale) / fullScale) * trackHeight
  const fillStyle: CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: fillHeight,
    background: fillGradient(percent),
    borderRadius: `0 0 ${trackW / 2 - 2}px ${trackW / 2 - 2}px`,
    transition: dragging.current ? 'none' : 'height 0.08s ease-out',
  }

  // Handle sits at top edge of fill
  const handleY = trackHeight - fillHeight - HANDLE_HEIGHT / 2
  const handleStyle: CSSProperties = {
    position: 'absolute',
    top: clamp(handleY, 0, trackHeight - HANDLE_HEIGHT),
    left: 3,
    right: 3,
    height: HANDLE_HEIGHT,
    borderRadius: HANDLE_HEIGHT / 2,
    background: percent > 0 ? color.text : color.textMuted,
    opacity: 0.9,
    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
    transition: dragging.current ? 'none' : 'top 0.08s ease-out',
    pointerEvents: 'none',
  }

  const labelStyle: CSSProperties = {
    fontFamily: color.fontData,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: selected ? color.accent : color.textDim,
    transition: 'color 0.15s',
  }

  return (
    <div style={columnStyle} onClick={onSelect}>
      <span style={readoutStyle} data-testid={`motor-slider-readout-${label}`}>{percent}%</span>
      <div
        ref={trackRef}
        style={trackOuterStyle}
        onPointerDown={handlePointerDown}
        data-testid={`motor-slider-track-${label}`}
      >
        <div style={fillStyle} />
        <div style={handleStyle} />
      </div>
      <span style={labelStyle}>{label}</span>
      {rpm ? (
        <span
          style={{
            fontFamily: color.fontData,
            fontSize: 10,
            color: rpm.fresh ? color.textMuted : color.textDim,
            opacity: rpm.fresh ? 1 : 0.6,
            marginTop: -2,
          }}
          data-testid={rpmTestId}
          title="Measured RPM from ESC telemetry"
        >
          {/* An em dash, not a zero: 0 is a real reading that means stopped. */}
          {rpm.rpm === undefined ? '—' : rpm.rpm.toLocaleString()}
        </span>
      ) : null}
    </div>
  )
}

/** One horizontal row: label | track | percent | trailing cell (RPM or a slot). */
function SliderRow({
  label,
  percent,
  selected,
  onSelect,
  onDrag,
  onCommit,
  fullScale,
  rpm,
  rpmTestId,
  trailing,
}: {
  label: string
  percent: number
  selected: boolean
  onSelect: () => void
  onDrag: (pct: number) => void
  onCommit?: (pct: number) => void
  fullScale: number
  rpm?: { rpm?: number; temperatureC?: number; fresh: boolean }
  rpmTestId?: string
  /** Replaces the RPM and temperature cells (the ALL row's "at once" switch). */
  trailing?: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      onSelect()
      const track = trackRef.current
      if (!track) return
      dragging.current = true
      try {
        track.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released/invalid — capture is best-effort.
      }
      onDrag(percentFromX(track, e.clientX, fullScale))
      const onMove = (ev: globalThis.PointerEvent) => {
        if (!dragging.current || !trackRef.current) return
        onDrag(percentFromX(trackRef.current, ev.clientX, fullScale))
      }
      const onUp = (ev: globalThis.PointerEvent) => {
        if (!dragging.current) return
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (onCommit && trackRef.current) {
          onCommit(percentFromX(trackRef.current, ev.clientX, fullScale))
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onSelect, onDrag, onCommit, fullScale],
  )

  const TRACK_H = 14
  const fillPct = (Math.min(percent, fullScale) / fullScale) * 100

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr) 42px 52px 40px',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={onSelect}
      data-testid={`motor-slider-row-${label}`}
    >
      <span
        style={{
          fontFamily: color.fontData,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: selected ? color.accent : color.textDim,
          transition: 'color 0.15s',
        }}
      >
        {label}
      </span>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        data-testid={`motor-slider-track-${label}`}
        style={{
          position: 'relative',
          height: TRACK_H,
          background: color.bgPanelMuted,
          borderRadius: TRACK_H / 2,
          border: `2px solid ${selected ? color.accent : color.border}`,
          boxShadow: selected
            ? `0 0 8px ${color.borderAccent}, inset 0 2px 6px rgba(0,0,0,0.35)`
            : 'inset 0 2px 6px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${fillPct}%`,
            background: percent > 0 ? `linear-gradient(to right, ${color.warning} 0%, ${color.danger} 100%)` : 'transparent',
            transition: dragging.current ? 'none' : 'width 0.08s ease-out',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 1,
            bottom: 1,
            left: `calc(${fillPct}% - ${HANDLE_HEIGHT / 2}px)`,
            width: HANDLE_HEIGHT,
            borderRadius: HANDLE_HEIGHT / 2,
            background: percent > 0 ? color.text : color.textMuted,
            opacity: 0.9,
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            transition: dragging.current ? 'none' : 'left 0.08s ease-out',
            pointerEvents: 'none',
          }}
        />
      </div>
      {/* The ALL row hands its percent, RPM and temperature cells to the
          mode pills: its percent is the typed field under the rows, and it
          has no telemetry of its own. */}
      {trailing !== undefined ? (
        <span style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'flex-end' }}>{trailing}</span>
      ) : (
        <span
          style={{
            fontFamily: color.fontData,
            fontSize: 11,
            fontWeight: 700,
            color: percent > 0 ? color.text : color.textDim,
            textAlign: 'right',
          }}
          data-testid={`motor-slider-readout-${label}`}
        >
          {percent}%
        </span>
      )}
      {trailing !== undefined ? null : rpm ? (
        <>
          <span
            style={{
              fontFamily: color.fontData,
              fontSize: 11,
              color: rpm.fresh ? color.textMuted : color.textDim,
              opacity: rpm.fresh ? 1 : 0.6,
              textAlign: 'right',
            }}
            data-testid={rpmTestId}
            title="Measured RPM from ESC telemetry"
          >
            {rpm.rpm === undefined ? '—' : rpm.rpm.toLocaleString()}
          </span>
          {/* ESC temperature beside the RPM: the second thing a bench test
              is watching for, and the ESC reports it in the same frame. */}
          <span
            style={{
              fontFamily: color.fontData,
              fontSize: 11,
              color: rpm.fresh ? color.textMuted : color.textDim,
              opacity: rpm.fresh ? 1 : 0.6,
              textAlign: 'right',
            }}
            data-testid={rpmTestId ? rpmTestId.replace('esc-rpm-value', 'esc-temp-value') : undefined}
            title="ESC temperature, °C"
          >
            {rpm.temperatureC === undefined ? '—' : `${Math.round(rpm.temperatureC)}°`}
          </span>
        </>
      ) : (
        <span style={{ gridColumn: 'span 2' }} />
      )}
    </div>
  )
}

/* ── main export ── */

export function MotorTestSliders({
  targets,
  selectedOutput,
  throttlePercent,
  onSelectOutput,
  onThrottleChange,
  onTest,
  testDisabled,
  onStop,
  stopEnabled,
  masterEnabled,
  testId,
  maxPercent = 100,
  onThrottleCommit,
  trackHeight = TRACK_HEIGHT,
  rpm,
  durationSeconds,
  maxDurationSeconds,
  onDurationChange,
  simultaneousToggle = false,
  testButtonId,
  testButtonClassName,
  orientation = 'vertical',
}: MotorTestSlidersProps) {
  // The danger frame means motors are turning, not "a percent is typed in".
  const active = stopEnabled
  const allSelected = selectedOutput === MASTER_OUTPUT_VALUE || selectedOutput === SIMULTANEOUS_OUTPUT_VALUE

  // Sliders on the left, controls in a column beside them. Stacking the
  // buttons UNDER the sliders cost the tracks ~37px of height, which is
  // granularity: at 100 steps over 42px a single pixel of drag was three
  // percent. Beside them, the same box holds a track twice as tall.
  const wrapperStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 8,
    background: color.bgPanel,
    borderRadius: 9,
    border: `1.5px solid ${active ? color.danger : color.border}`,
    boxShadow: active
      ? `0 0 12px ${color.dangerWeak}, inset 0 0 20px rgba(212, 107, 98, 0.04)`
      : 'none',
    transition: 'border-color 0.25s, box-shadow 0.25s',
  }

  const slidersRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10,
  }

  const separatorStyle: CSSProperties = {
    width: 1,
    alignSelf: 'stretch',
    margin: `${Math.round(trackHeight * 0.22)}px 4px`,
    background: color.border,
    opacity: 0.5,
  }

  const percentFieldStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    // Height matched to the Test/Stop buttons it stacks with. Left to its own
    // intrinsic size it came out 21px against their 31 and read as a different
    // class of control sitting in the same column.
    height: 31,
    boxSizing: 'border-box',
    border: `1px solid ${color.border}`,
    borderRadius: 5,
    padding: '0 6px',
    background: color.bgPanelMuted,
  }

  const percentLabelStyle: CSSProperties = {
    color: color.textDim,
    fontFamily: color.fontData,
    fontSize: 11,
  }

  const percentInputStyle: CSSProperties = {
    width: 46,
    border: 'none',
    background: 'transparent',
    color: color.text,
    fontFamily: color.fontData,
    fontSize: 12,
    padding: '2px 0',
    textAlign: 'right',
  }

  const testBtnStyle: CSSProperties = {
    border: `1px solid ${testDisabled ? color.border : 'rgba(218, 178, 84, 0.5)'}`,
    background: testDisabled ? 'rgba(255,255,255,0.03)' : 'rgba(218, 178, 84, 0.12)',
    color: testDisabled ? color.textDim : '#e8c968',
    padding: '6px 14px',
    borderRadius: 5,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: '0.02em',
    cursor: testDisabled ? 'not-allowed' : 'pointer',
    textTransform: 'uppercase',
    fontFamily: color.fontData,
    opacity: testDisabled ? 0.5 : 1,
    transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
  }

  const stopBtnStyle: CSSProperties = {
    border: `1px solid ${stopEnabled ? 'rgba(212, 107, 98, 0.7)' : color.border}`,
    background: stopEnabled ? 'rgba(212, 107, 98, 0.16)' : 'rgba(255,255,255,0.03)',
    color: stopEnabled ? '#f08a80' : color.textDim,
    padding: '6px 14px',
    borderRadius: 5,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: '0.02em',
    cursor: stopEnabled ? 'pointer' : 'not-allowed',
    textTransform: 'uppercase',
    fontFamily: color.fontData,
    opacity: stopEnabled ? 1 : 0.5,
    transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
  }

  const percentField = (
    <label style={percentFieldStyle}>
      <span style={percentLabelStyle}>%</span>
      <input
        type="number"
        min={0}
        max={maxPercent}
        step={1}
        value={throttlePercent}
        data-testid={testId ? `${testId}-percent` : undefined}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (!Number.isFinite(next)) return
          onThrottleChange(Math.min(Math.max(Math.round(next), 0), maxPercent))
        }}
        style={percentInputStyle}
      />
    </label>
  )
  const durationField = onDurationChange ? (
    <label style={percentFieldStyle}>
      <span style={percentLabelStyle}>s</span>
      <input
        type="number"
        min={0.1}
        max={maxDurationSeconds}
        step={0.1}
        value={durationSeconds}
        data-testid={testId ? `${testId}-duration` : undefined}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (!Number.isFinite(next)) return
          onDurationChange(next)
        }}
        style={percentInputStyle}
        title="Test duration, seconds"
      />
    </label>
  ) : null
  const testButton = (
    <button
      id={testButtonId}
      type="button"
      className={testButtonClassName}
      style={testBtnStyle}
      disabled={testDisabled}
      onClick={onTest}
      data-testid={testId ? `${testId}-test` : undefined}
    >
      Test
    </button>
  )
  const stopButton = (
    <button
      type="button"
      style={stopBtnStyle}
      disabled={!stopEnabled}
      onClick={onStop}
      data-testid={testId ? `${testId}-stop` : undefined}
    >
      Stop
    </button>
  )
  // ALL row modes as two pills: "In order" spins each motor in turn (the
  // sequence sentinel), "At once" spins them together. A checkbox said only
  // one of the two by name.
  const modePill = (label: string, value: number, testIdSuffix: string): ReactNode => {
    const active = selectedOutput === value
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSelectOutput(value)
        }}
        data-testid={testId ? `${testId}-${testIdSuffix}` : undefined}
        aria-pressed={active}
        style={{
          border: `1px solid ${active ? 'rgba(218, 178, 84, 0.6)' : color.border}`,
          background: active ? 'rgba(218, 178, 84, 0.14)' : 'transparent',
          color: active ? '#e8c968' : color.textDim,
          padding: '1px 6px',
          borderRadius: 4,
          fontFamily: color.fontData,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    )
  }
  const atOnceToggle = simultaneousToggle ? (
    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
      {modePill('In order', MASTER_OUTPUT_VALUE, 'in-order')}
      {modePill('At once', SIMULTANEOUS_OUTPUT_VALUE, 'at-once')}
    </span>
  ) : null

  if (orientation === 'horizontal') {
    return (
      <div
        style={{ ...wrapperStyle, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
        data-testid={testId}
        data-status={rpm?.status}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          {targets.map((target) => (
            <SliderRow
              key={target.value}
              label={target.label}
              percent={selectedOutput === target.value ? throttlePercent : 0}
              selected={selectedOutput === target.value}
              onSelect={() => onSelectOutput(target.value)}
              onDrag={onThrottleChange}
              onCommit={onThrottleCommit}
              fullScale={maxPercent}
              rpm={rpm && rpm.status !== 'unavailable' ? rpm.byOutput[target.value] ?? { fresh: false } : undefined}
              rpmTestId={`esc-rpm-value-${target.value}`}
            />
          ))}
          {masterEnabled ? (
            <SliderRow
              label="ALL"
              percent={allSelected ? throttlePercent : 0}
              selected={allSelected}
              onSelect={() =>
                onSelectOutput(selectedOutput === SIMULTANEOUS_OUTPUT_VALUE ? SIMULTANEOUS_OUTPUT_VALUE : MASTER_OUTPUT_VALUE)
              }
              onDrag={onThrottleChange}
              onCommit={onThrottleCommit}
              fullScale={maxPercent}
              trailing={atOnceToggle ?? <span />}
            />
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {percentField}
            {durationField}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {testButton}
            {stopButton}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={wrapperStyle} data-testid={testId} data-status={rpm?.status}>
      <div style={slidersRowStyle}>
        {targets.map((target) => (
          <SliderColumn
            key={target.value}
            label={target.label}
            percent={selectedOutput === target.value ? throttlePercent : 0}
            selected={selectedOutput === target.value}
            onSelect={() => onSelectOutput(target.value)}
            onDrag={onThrottleChange}
            onCommit={onThrottleCommit}
            fullScale={maxPercent}
            trackHeight={trackHeight}
            rpm={rpm && rpm.status !== 'unavailable' ? rpm.byOutput[target.value] ?? { fresh: false } : undefined}
            rpmTestId={`esc-rpm-value-${target.value}`}
          />
        ))}

        {masterEnabled ? (
          <>
            {/* No per-motor tiles to separate from when a caller drives ALL
                only (the spin wizard), and a lone rule reads as a glitch. */}
            {targets.length > 0 ? <div style={separatorStyle} /> : null}
            <SliderColumn
              label="ALL"
              percent={
                selectedOutput === MASTER_OUTPUT_VALUE || selectedOutput === SIMULTANEOUS_OUTPUT_VALUE
                  ? throttlePercent
                  : 0
              }
              selected={selectedOutput === MASTER_OUTPUT_VALUE || selectedOutput === SIMULTANEOUS_OUTPUT_VALUE}
              wide
              onSelect={() => {
                // Preserve an already-chosen all-mode (sequence OR at-once)
                // instead of always snapping back to sequence — otherwise
                // picking "at once" in the dropdown gets reverted by this tile.
                onSelectOutput(
                  selectedOutput === SIMULTANEOUS_OUTPUT_VALUE ? SIMULTANEOUS_OUTPUT_VALUE : MASTER_OUTPUT_VALUE
                )
              }}
              onDrag={onThrottleChange}
              onCommit={onThrottleCommit}
              fullScale={maxPercent}
              trackHeight={trackHeight}
            />
          </>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Typed entry alongside the drag. A slider is the fast way to find
            roughly the right throttle; it is a poor way to ask for exactly 7%,
            which is what a repeatable bench test needs. Both drive the same
            value. */}
        <label style={percentFieldStyle}>
          <span style={percentLabelStyle}>%</span>
          <input
            type="number"
            min={0}
            max={maxPercent}
            step={1}
            value={throttlePercent}
            data-testid={testId ? `${testId}-percent` : undefined}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next)) return
              onThrottleChange(Math.min(Math.max(Math.round(next), 0), maxPercent))
            }}
            style={percentInputStyle}
          />
        </label>
        {onDurationChange ? (
          <label style={percentFieldStyle}>
            <span style={percentLabelStyle}>s</span>
            <input
              type="number"
              min={0.1}
              max={maxDurationSeconds}
              step={0.1}
              value={durationSeconds}
              data-testid={testId ? `${testId}-duration` : undefined}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                onDurationChange(next)
              }}
              style={percentInputStyle}
              title="Test duration, seconds"
            />
          </label>
        ) : null}
        <button
          id={testButtonId}
          type="button"
          className={testButtonClassName}
          style={testBtnStyle}
          disabled={testDisabled}
          onClick={onTest}
          data-testid={testId ? `${testId}-test` : undefined}
        >
          Test
        </button>
        <button
          type="button"
          style={stopBtnStyle}
          disabled={!stopEnabled}
          onClick={onStop}
          data-testid={testId ? `${testId}-stop` : undefined}
        >
          Stop
        </button>
        {simultaneousToggle && allSelected ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: color.fontData,
              fontSize: 10,
              color: color.textMuted,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
            title="Spin every motor at the same time instead of one after another"
          >
            <input
              type="checkbox"
              checked={selectedOutput === SIMULTANEOUS_OUTPUT_VALUE}
              onChange={(event) => onSelectOutput(event.target.checked ? SIMULTANEOUS_OUTPUT_VALUE : MASTER_OUTPUT_VALUE)}
              data-testid={testId ? `${testId}-at-once` : undefined}
            />
            at once
          </label>
        ) : null}
      </div>
    </div>
  )
}
