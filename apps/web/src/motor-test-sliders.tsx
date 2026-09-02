import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

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
  /** Ceiling for the typed percent field. Defaults to 100; the motor-test
   *  surface passes its own guard limit so the box cannot ask for a throttle
   *  the runtime will refuse. */
  maxPercent?: number
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

// 80, and the buttons moved out to the side to pay for it. The sliders live in a narrow column beside the
// settings now rather than on a page of their own, and a 200px track pushed
// the rest of the test panel below the fold on a laptop. Grab area is still
// well over the ~44px touch target at every step of the range.
const TRACK_HEIGHT = 80
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

function percentFromY(trackEl: HTMLElement, clientY: number): number {
  const rect = trackEl.getBoundingClientRect()
  const yInTrack = clamp(clientY - rect.top, 0, rect.height)
  // top of track = 100%, bottom = 0%
  return Math.round((1 - yInTrack / rect.height) * 100)
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
}: {
  label: string
  percent: number
  selected: boolean
  wide?: boolean
  onSelect: () => void
  onDrag: (pct: number) => void
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
      onDrag(percentFromY(track, e.clientY))

      const onMove = (ev: globalThis.PointerEvent) => {
        if (!dragging.current || !trackRef.current) return
        onDrag(percentFromY(trackRef.current, ev.clientY))
      }
      const onUp = () => {
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onSelect, onDrag],
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
    height: TRACK_HEIGHT,
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

  const fillHeight = (percent / 100) * TRACK_HEIGHT
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
  const handleY = TRACK_HEIGHT - fillHeight - HANDLE_HEIGHT / 2
  const handleStyle: CSSProperties = {
    position: 'absolute',
    top: clamp(handleY, 0, TRACK_HEIGHT - HANDLE_HEIGHT),
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
}: MotorTestSlidersProps) {
  const active = throttlePercent > 0

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
    margin: '18px 4px',
    background: color.border,
    opacity: 0.5,
  }

  const percentFieldStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    border: `1px solid ${color.border}`,
    borderRadius: 5,
    padding: '2px 6px',
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

  return (
    <div style={wrapperStyle} data-testid={testId}>
      <div style={slidersRowStyle}>
        {targets.map((target) => (
          <SliderColumn
            key={target.value}
            label={target.label}
            percent={selectedOutput === target.value ? throttlePercent : 0}
            selected={selectedOutput === target.value}
            onSelect={() => onSelectOutput(target.value)}
            onDrag={onThrottleChange}
          />
        ))}

        {masterEnabled ? (
          <>
            <div style={separatorStyle} />
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
            />
          </>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        <button
          type="button"
          style={testBtnStyle}
          disabled={testDisabled}
          onClick={onTest}
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
      </div>
    </div>
  )
}
