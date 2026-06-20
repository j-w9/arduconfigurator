import { useId } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RcChannelBarsProps {
  channels: {
    channelNumber: number
    role: string
    pwm: number | undefined
    fillPercent: number
    trimPercent: number
    isModeChannel: boolean
  }[]
  verified: boolean
  testId?: string
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PWM_MIN = 900
const PWM_MAX = 2100
const PWM_CENTER = 1500
const PWM_RANGE = PWM_MAX - PWM_MIN // 1200

/** Position of the 1500 center mark as a percentage of the bar width */
const CENTER_PCT = ((PWM_CENTER - PWM_MIN) / PWM_RANGE) * 100 // 50%

/* ------------------------------------------------------------------ */
/*  Scoped CSS (injected once)                                         */
/* ------------------------------------------------------------------ */

const STYLE_BLOCK = `
/* RC Channel Bars ------------------------------------------------- */
.rc-bars-container {
  display: flex;
  flex-direction: column;
  gap: 1px;
  user-select: none;
}

.rc-bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 56px;
  align-items: center;
  height: 28px;
  gap: 6px;
  padding: 0 4px;
  border-radius: var(--radius-sm, 3px);
  border: 1px solid transparent;
  transition: border-color 120ms ease;
}

.rc-bar-row--mode {
  border-color: var(--warning, #dab254);
  background: var(--warning-weak, rgba(218, 178, 84, 0.14));
}

/* Label column */
.rc-bar-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim, #5a7088);
  white-space: nowrap;
  overflow: hidden;
  line-height: 1;
}

.rc-bar-label__ch {
  color: var(--text-muted, #8ea0b0);
  font-weight: 600;
}

.rc-bar-label__role {
  color: var(--text-dim, #5a7088);
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-bar-label__sep {
  color: var(--text-dim, #5a7088);
  opacity: 0.5;
}

/* Bar track */
.rc-bar-track {
  position: relative;
  height: 16px;
  background: var(--bg-panel-muted, #0b1016);
  border: 1px solid var(--border-soft, #1f2a36);
  border-radius: 2px;
  overflow: hidden;
}

.rc-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 1px;
  transition: width 80ms ease, background-color 120ms ease;
  will-change: width;
}

/* Center line at 1500 */
.rc-bar-center {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--text-dim, #5a7088);
  opacity: 0.55;
  pointer-events: none;
}

/* Trim marker — small upward-pointing triangle sitting on the bottom edge */
.rc-bar-trim {
  position: absolute;
  bottom: 0;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 5px solid var(--text-muted, #8ea0b0);
  transform: translateX(-3px);
  pointer-events: none;
  opacity: 0.85;
  transition: left 80ms ease;
}

/* PWM value column */
.rc-bar-value {
  font-family: var(--font-data, "IBM Plex Mono", "SFMono-Regular", "SF Mono", Consolas, monospace);
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--text, #e4eaf0);
  white-space: nowrap;
}

.rc-bar-value--empty {
  color: var(--text-dim, #5a7088);
}

/* Header row */
.rc-bars-header {
  display: grid;
  grid-template-columns: 90px 1fr 56px;
  gap: 6px;
  padding: 0 4px 4px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim, #5a7088);
  border-bottom: 1px solid var(--border-soft, #1f2a36);
  margin-bottom: 2px;
}

.rc-bars-header span:last-child {
  text-align: right;
}
`

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fillColor(pwm: number | undefined, isModeChannel: boolean): string {
  if (pwm === undefined) return 'var(--text-dim, #5a7088)'
  if (pwm < PWM_MIN || pwm > PWM_MAX) return 'var(--danger, #d46b62)'
  if (isModeChannel) return 'var(--warning, #dab254)'
  return 'var(--accent, #6db8e0)'
}

function clampFillPct(pct: number): number {
  return Math.max(0, Math.min(100, pct))
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RcChannelBars({ channels, verified, testId }: RcChannelBarsProps) {
  const styleId = useId()

  return (
    <div data-testid={testId} className="rc-bars-container">
      {/* Scoped style block — uses id to avoid duplicates in StrictMode */}
      <style key={styleId}>{STYLE_BLOCK}</style>

      {/* Column headers */}
      <div className="rc-bars-header">
        <span>Channel</span>
        <span style={{ textAlign: 'center' }}>
          {PWM_MIN}
          <span style={{ margin: '0 4px', opacity: 0.4 }}>/</span>
          {PWM_CENTER}
          <span style={{ margin: '0 4px', opacity: 0.4 }}>/</span>
          {PWM_MAX}
        </span>
        <span>PWM</span>
      </div>

      {/* Channel rows */}
      {channels.map((ch) => {
        const hasData = ch.pwm !== undefined && verified
        const pct = hasData ? clampFillPct(ch.fillPercent) : 0
        const trimPct = clampFillPct(ch.trimPercent)
        const color = hasData ? fillColor(ch.pwm, ch.isModeChannel) : 'transparent'
        const fillOpacity = hasData ? 0.82 : 0

        return (
          <div
            key={ch.channelNumber}
            className={`rc-bar-row${ch.isModeChannel ? ' rc-bar-row--mode' : ''}`}
            data-testid={testId ? `${testId}-ch${ch.channelNumber}` : undefined}
          >
            {/* Label */}
            <div className="rc-bar-label">
              <span className="rc-bar-label__ch">CH{ch.channelNumber}</span>
              {ch.role && (
                <>
                  <span className="rc-bar-label__sep">&middot;</span>
                  <span className="rc-bar-label__role">{ch.role}</span>
                </>
              )}
            </div>

            {/* Bar */}
            <div className="rc-bar-track">
              {/* Fill */}
              <div
                className="rc-bar-fill"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  opacity: fillOpacity
                }}
              />

              {/* Center line at 1500 */}
              <div className="rc-bar-center" style={{ left: `${CENTER_PCT}%` }} />

              {/* Trim marker */}
              {hasData && (
                <div className="rc-bar-trim" style={{ left: `${trimPct}%` }} />
              )}
            </div>

            {/* PWM value */}
            <div className={`rc-bar-value${!hasData ? ' rc-bar-value--empty' : ''}`}>
              {hasData ? ch.pwm : '\u2014'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
