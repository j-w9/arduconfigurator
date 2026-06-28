// Read-only schematic motor map (top-down): arms, spin direction, motor number
// and the mapped OUTx per position. Shares the .motor-mixer-preview styling with
// the interactive reorder preview in MotorReorderDialog, but carries none of the
// guided-pick logic — it's a reference diagram (used on the Motors -> Test tab
// beside the throttle sliders).

import type { MotorPreviewNode } from '../view-models/motor-preview'
import { motorSpinArcPath } from './motor-spin-arc'

export interface MotorMixerDiagramProps {
  nodes: readonly MotorPreviewNode[]
  geometryMode: string
  /** motorNumber -> output label (e.g. "OUT1"); positions without a label read "UNMAPPED". */
  outputLabelByMotor?: Record<number, string>
  className?: string
  testId?: string
}

export function MotorMixerDiagram({ nodes, geometryMode, outputLabelByMotor, className, testId }: MotorMixerDiagramProps) {
  if (nodes.length === 0) {
    return null
  }
  return (
    <div className={`motor-mixer-preview${className ? ` ${className}` : ''}`} data-testid={testId}>
      <svg viewBox="0 0 260 260" role="img" aria-label="Schematic motor map">
        <defs>
          <marker id="spinArrowTest" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 z" className="motor-mixer-preview__spin-head" />
          </marker>
        </defs>
        <rect x="0" y="0" width="260" height="260" rx="18" className="motor-mixer-preview__backdrop" />
        <line x1="130" y1="34" x2="130" y2="58" className="motor-mixer-preview__nose-arrow" />
        <polygon points="130,18 122,36 138,36" className="motor-mixer-preview__nose-arrow" />
        {nodes.map((node) => {
          const x = 130 + node.x * 82
          const y = 130 + node.y * 82
          const label = outputLabelByMotor?.[node.motorNumber]
          return (
            <g key={`motor-test-preview:${node.motorNumber}`} className={`motor-mixer-preview__node ${label ? 'is-mapped' : 'is-empty'}`}>
              <line x1="130" y1="130" x2={x} y2={y} className="motor-mixer-preview__arm" />
              <circle cx={x} cy={y} r={node.stack ? 29 : 24} className="motor-mixer-preview__ring" />
              {node.stack ? <circle cx={x} cy={y} r={19} className="motor-mixer-preview__stack" /> : null}
              {node.spin ? (
                <path
                  d={motorSpinArcPath(x, y, (node.stack ? 29 : 24) + 6, node.spin)}
                  className="motor-mixer-preview__spin"
                  markerEnd="url(#spinArrowTest)"
                />
              ) : null}
              <text x={x} y={y + 4} textAnchor="middle" className="motor-mixer-preview__motor-number">
                {node.motorNumber}
              </text>
              <text x={x} y={y + (node.stack ? 38 : 34)} textAnchor="middle" className="motor-mixer-preview__channel-label">
                {label ?? 'UNMAPPED'}
              </text>
            </g>
          )
        })}
        <circle cx="130" cy="130" r="26" className="motor-mixer-preview__body" />
        <text x="130" y="136" textAnchor="middle" className="motor-mixer-preview__center-label">
          {geometryMode.toUpperCase()}
        </text>
      </svg>
    </div>
  )
}
