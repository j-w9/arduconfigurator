// 3D picture of the flight controller as it is mounted, from AHRS_ORIENTATION.
//
// A sample quad frame stays fixed (body, arms, props, the camera at the nose)
// and the board sits on it, posed by the orientation. The board is a solid
// slab: the component side carries the forward arrow, the underside carries
// the same arrow in outline, and the front edge is green, so the nose stays
// findable after any flip. A line under the picture says where the arrow
// points and which way the components face.
//
// Axis mapping (body -> CSS): yaw about the board's normal = rotateZ; roll about
// the forward axis = rotateY; pitch about the right axis = rotateX, negated
// (CSS tips the top edge away from the camera; ArduPilot's positive pitch is
// nose up). Composed roll -> pitch -> yaw, written outermost-first in CSS.
// Checked against AP_Math rotate() for every orientation (the view-model test).

import {
  describeBoardOrientation,
  rotateBoardOrientation,
  type BoardOrientationVisual,
  type BoardRotationAxis
} from '../view-models/board-orientation-visual'
import { FlightControllerBottom, FlightControllerTop } from './FlightControllerArt'

export interface BoardOrientationRotateControls {
  /** The AHRS_ORIENTATION value shown. */
  value: number
  options: ReadonlyArray<{ value: number; label: string }>
  /** Stage the value the board was turned to. */
  onChange: (value: number) => void
  disabled?: boolean
}

export interface BoardOrientationDiagramProps {
  visual: BoardOrientationVisual
  testId?: string
  /** When given, arrows on the picture turn the board and pick the matching setting. */
  rotate?: BoardOrientationRotateControls
}

// The arrows on the picture: roll and pitch turn the board 90°, yaw 45°
// (ArduPilot has the 45° yaw mounts). Left-hand buttons turn one way,
// right-hand the other.
const TURNS: Array<{ id: string; axis: BoardRotationAxis; degrees: number; text: string; title: string }> = [
  { id: 'yaw-left', axis: 'yaw', degrees: -45, text: '↺ Yaw 45°', title: 'Turn the board 45°, nose to the left' },
  { id: 'yaw-right', axis: 'yaw', degrees: 45, text: 'Yaw 45° ↻', title: 'Turn the board 45°, nose to the right' },
  { id: 'roll-left', axis: 'roll', degrees: -90, text: '↺ Roll', title: 'Roll the board 90°, left side down' },
  { id: 'roll-right', axis: 'roll', degrees: 90, text: 'Roll ↻', title: 'Roll the board 90°, right side down' },
  { id: 'pitch-down', axis: 'pitch', degrees: -90, text: '▼ Nose', title: 'Pitch the board 90°, nose down' },
  { id: 'pitch-up', axis: 'pitch', degrees: 90, text: 'Nose ▲', title: 'Pitch the board 90°, nose up' }
]

function RotateArrows({ rotate }: { rotate: BoardOrientationRotateControls }) {
  return (
    <>
      {TURNS.map((turn) => {
        const target = rotateBoardOrientation(rotate.value, turn.axis, turn.degrees, rotate.options)
        const unavailable = target === undefined
        return (
          <button
            key={turn.id}
            type="button"
            className={`board-orientation-diagram__turn board-orientation-diagram__turn--${turn.id}`}
            data-testid={`board-orientation-turn-${turn.id}`}
            title={unavailable ? 'ArduPilot has no setting for that mount. Pick one from the list.' : turn.title}
            aria-label={turn.title}
            disabled={rotate.disabled || unavailable}
            onClick={() => {
              if (target !== undefined) rotate.onChange(target)
            }}
          >
            {turn.text}
          </button>
        )
      })}
    </>
  )
}

function QuadFrame() {
  // Drawn in a 200x200 box, nose at the top. Arms on the diagonals.
  const props = [
    { cx: 46, cy: 46, front: true },
    { cx: 154, cy: 46, front: true },
    { cx: 46, cy: 154, front: false },
    { cx: 154, cy: 154, front: false }
  ]
  return (
    <svg className="board-orientation-diagram__frame" viewBox="0 0 200 200" aria-hidden="true">
      {props.map((prop) => (
        <line key={`arm-${prop.cx}-${prop.cy}`} className="board-orientation-diagram__frame-arm" x1="100" y1="100" x2={prop.cx} y2={prop.cy} />
      ))}
      <rect className="board-orientation-diagram__frame-body" x="70" y="62" width="60" height="76" rx="8" />
      {/* The FPV camera sits at the nose. */}
      <rect className="board-orientation-diagram__frame-camera" x="88" y="50" width="24" height="14" rx="3" />
      {props.map((prop) => (
        <g key={`prop-${prop.cx}-${prop.cy}`}>
          <circle
            className={`board-orientation-diagram__frame-prop${prop.front ? ' board-orientation-diagram__frame-prop--front' : ''}`}
            cx={prop.cx}
            cy={prop.cy}
            r="30"
          />
          <circle className="board-orientation-diagram__frame-motor" cx={prop.cx} cy={prop.cy} r="7" />
        </g>
      ))}
      <path className="board-orientation-diagram__frame-nose" d="M100 14 L110 30 L90 30 Z" />
      <text className="board-orientation-diagram__frame-label" x="100" y="8" textAnchor="middle">
        FRONT
      </text>
    </svg>
  )
}

export function BoardOrientationDiagram({ visual, testId, rotate }: BoardOrientationDiagramProps) {
  if (visual.kind === 'custom') {
    return (
      <div className="board-orientation-diagram" data-testid={testId}>
        <div className="board-orientation-diagram__stage">
          <div className="board-orientation-diagram__note" data-testid="board-orientation-note">
            <strong>{visual.label}</strong>
            <p>{visual.note}</p>
          </div>
        </div>
        <div className="board-orientation-diagram__caption">{visual.label}</div>
      </div>
    )
  }

  const boardTransform = `rotateZ(${visual.yaw}deg) rotateX(${-visual.pitch}deg) rotateY(${visual.roll}deg)`
  const readout = describeBoardOrientation(visual)

  return (
    <div className="board-orientation-diagram" data-testid={testId}>
      <div className="board-orientation-diagram__stage board-orientation-diagram__stage--3d">
        {rotate ? <RotateArrows rotate={rotate} /> : null}
        <div className="board-orientation-diagram__scene">
          <QuadFrame />
          <div
            className="board-orientation-diagram__board3d"
            data-testid="board-orientation-3d"
            style={{ transform: boardTransform }}
            role="img"
            aria-label={`Board mounted: ${visual.label}. Arrow points ${readout.arrow}, components face ${readout.componentSide}.`}
          >
            {/* Component side. */}
            <div className="board-orientation-diagram__face board-orientation-diagram__face--top">
              <FlightControllerTop />
            </div>
            {/* Underside: tinted, named, and still showing which way is forward. */}
            <div className="board-orientation-diagram__face board-orientation-diagram__face--bottom" aria-hidden="true">
              <FlightControllerBottom />
            </div>
            <div className="board-orientation-diagram__edge board-orientation-diagram__edge--front" aria-hidden="true" />
            <div className="board-orientation-diagram__edge board-orientation-diagram__edge--back" aria-hidden="true" />
            <div className="board-orientation-diagram__edge board-orientation-diagram__edge--left" aria-hidden="true" />
            <div className="board-orientation-diagram__edge board-orientation-diagram__edge--right" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="board-orientation-diagram__caption">{visual.label}</div>
      <div className="board-orientation-diagram__readout" data-testid="board-orientation-readout">
        Arrow points <strong>{readout.arrow}</strong> · components face <strong>{readout.componentSide}</strong>
      </div>
    </div>
  )
}
