import { useMemo } from 'react'

interface RateCurveGraphProps {
  maxRate: number       // deg/s at full stick
  expo: number          // 0.0-1.0
  label: string         // e.g. "Roll / Pitch" or "Yaw"
  color?: string        // curve color, defaults to accent blue
  testId?: string
}

const MONO_FONT = '"IBM Plex Mono", "SFMono-Regular", "SF Mono", Consolas, monospace'
const GRID_COLOR = 'rgba(46, 61, 78, 0.5)'
const BORDER_COLOR = '#2e3d4e'
const BG_COLOR = '#0b1016'
const DIM_TEXT = '#5a7088'
const ACCENT_DEFAULT = '#6db8e0'
const LINEAR_REF_COLOR = '#2e3d4e'

/* Layout constants within the SVG viewBox */
const VIEW_W = 400
const VIEW_H = 220
const PAD_L = 42    // left padding for Y-axis labels
const PAD_R = 16
const PAD_T = 24    // top padding for badge
const PAD_B = 28    // bottom padding for X-axis label
const PLOT_X = PAD_L
const PLOT_Y = PAD_T
const PLOT_W = VIEW_W - PAD_L - PAD_R
const PLOT_H = VIEW_H - PAD_T - PAD_B

const NUM_POINTS = 50

/**
 * Compute rate for a given normalized stick input (0..1).
 * rate = maxRate * (expo * stick^3 + (1 - expo) * stick)
 */
function computeRate(stick: number, maxRate: number, expo: number): number {
  return maxRate * (expo * stick * stick * stick + (1 - expo) * stick)
}

export function RateCurveGraph({ maxRate, expo, label, color, testId }: RateCurveGraphProps) {
  const curveColor = color ?? ACCENT_DEFAULT

  const curvePoints = useMemo(() => {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= NUM_POINTS; i++) {
      const stick = i / NUM_POINTS
      const rate = computeRate(stick, maxRate, expo)
      pts.push({
        x: PLOT_X + stick * PLOT_W,
        y: PLOT_Y + PLOT_H - (rate / maxRate) * PLOT_H
      })
    }
    return pts
  }, [maxRate, expo])

  const curvePath = useMemo(() => {
    if (curvePoints.length === 0) return ''
    return curvePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
  }, [curvePoints])

  /* Grid fractions: 25%, 50%, 75% */
  const gridFractions = [0.25, 0.5, 0.75]

  /* Linear reference line (expo=0): from bottom-left to top-right of plot */
  const linearPath = `M${PLOT_X},${PLOT_Y + PLOT_H} L${PLOT_X + PLOT_W},${PLOT_Y}`

  const rateLabel = maxRate >= 1000
    ? `${(maxRate / 1000).toFixed(1)}k`
    : `${Math.round(maxRate)}`

  return (
    <div
      data-testid={testId}
      style={{
        width: '100%',
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: 7,
        overflow: 'hidden',
        background: BG_COLOR
      }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 180 }}
      >
        {/* Plot area background */}
        <rect
          x={PLOT_X}
          y={PLOT_Y}
          width={PLOT_W}
          height={PLOT_H}
          fill={BG_COLOR}
        />

        {/* Vertical grid lines (stick input 25%, 50%, 75%) */}
        {gridFractions.map(f => {
          const x = PLOT_X + f * PLOT_W
          return (
            <line
              key={`vg-${f}`}
              x1={x}
              y1={PLOT_Y}
              x2={x}
              y2={PLOT_Y + PLOT_H}
              stroke={GRID_COLOR}
              strokeWidth={0.7}
            />
          )
        })}

        {/* Horizontal grid lines (rate 25%, 50%, 75%) */}
        {gridFractions.map(f => {
          const y = PLOT_Y + PLOT_H - f * PLOT_H
          return (
            <line
              key={`hg-${f}`}
              x1={PLOT_X}
              y1={y}
              x2={PLOT_X + PLOT_W}
              y2={y}
              stroke={GRID_COLOR}
              strokeWidth={0.7}
            />
          )
        })}

        {/* Plot area border */}
        <rect
          x={PLOT_X}
          y={PLOT_Y}
          width={PLOT_W}
          height={PLOT_H}
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth={0.8}
        />

        {/* Y-axis grid labels (rate values) */}
        {gridFractions.map(f => {
          const y = PLOT_Y + PLOT_H - f * PLOT_H
          const val = Math.round(maxRate * f)
          return (
            <text
              key={`yl-${f}`}
              x={PLOT_X - 5}
              y={y + 3}
              textAnchor="end"
              fill={DIM_TEXT}
              fontFamily={MONO_FONT}
              fontSize={8}
            >
              {val}
            </text>
          )
        })}

        {/* Y-axis origin label */}
        <text
          x={PLOT_X - 5}
          y={PLOT_Y + PLOT_H + 3}
          textAnchor="end"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={8}
        >
          0
        </text>

        {/* Y-axis max label */}
        <text
          x={PLOT_X - 5}
          y={PLOT_Y + 3}
          textAnchor="end"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={8}
        >
          {Math.round(maxRate)}
        </text>

        {/* X-axis grid labels */}
        {gridFractions.map(f => {
          const x = PLOT_X + f * PLOT_W
          return (
            <text
              key={`xl-${f}`}
              x={x}
              y={PLOT_Y + PLOT_H + 12}
              textAnchor="middle"
              fill={DIM_TEXT}
              fontFamily={MONO_FONT}
              fontSize={8}
            >
              {Math.round(f * 100)}%
            </text>
          )
        })}

        {/* X-axis origin label */}
        <text
          x={PLOT_X}
          y={PLOT_Y + PLOT_H + 12}
          textAnchor="middle"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={8}
        >
          0%
        </text>

        {/* X-axis end label */}
        <text
          x={PLOT_X + PLOT_W}
          y={PLOT_Y + PLOT_H + 12}
          textAnchor="middle"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={8}
        >
          100%
        </text>

        {/* Axis titles */}
        <text
          x={PLOT_X + PLOT_W / 2}
          y={VIEW_H - 2}
          textAnchor="middle"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={9}
        >
          Stick Input
        </text>

        <text
          x={6}
          y={PLOT_Y + PLOT_H / 2}
          textAnchor="middle"
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={9}
          transform={`rotate(-90, 6, ${PLOT_Y + PLOT_H / 2})`}
        >
          Rate (°/s)
        </text>

        {/* Linear reference line (dashed) */}
        <path
          d={linearPath}
          fill="none"
          stroke={LINEAR_REF_COLOR}
          strokeWidth={1}
          strokeDasharray="4 3"
        />

        {/* Rate curve */}
        <path
          d={curvePath}
          fill="none"
          stroke={curveColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Label (bottom-left inside plot) */}
        <text
          x={PLOT_X + 6}
          y={PLOT_Y + PLOT_H - 6}
          fill={DIM_TEXT}
          fontFamily={MONO_FONT}
          fontSize={9}
          fontWeight={600}
        >
          {label}
        </text>

        {/* Max rate readout badge (top-right corner inside plot) */}
        <rect
          x={PLOT_X + PLOT_W - 62}
          y={PLOT_Y + 4}
          width={56}
          height={18}
          rx={9}
          ry={9}
          fill="rgba(11, 16, 22, 0.85)"
          stroke={curveColor}
          strokeWidth={0.8}
          strokeOpacity={0.4}
        />
        <text
          x={PLOT_X + PLOT_W - 34}
          y={PLOT_Y + 16}
          textAnchor="middle"
          fill={curveColor}
          fontFamily={MONO_FONT}
          fontSize={9}
          fontWeight={700}
        >
          {rateLabel}°/s
        </text>
      </svg>
    </div>
  )
}
