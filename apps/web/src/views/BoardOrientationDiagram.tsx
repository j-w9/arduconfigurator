// 3D picture of the flight controller as it is mounted, from AHRS_ORIENTATION.
// A thin board slab (distinct top vs bottom faces, a forward arrow, a USB notch)
// posed by the orientation's roll/pitch/yaw, inside a tilted scene so depth
// reads — so every option is visible, including the edge/tilted and upside-down
// mounts a flat 2D picture couldn't show. Custom orientations show a note.
//
// Axis mapping (body -> CSS): yaw about the board's normal = rotateZ; roll about
// the forward axis = rotateY; pitch about the right axis = rotateX. Composed
// intrinsically roll -> pitch -> yaw (ArduPilot's order) — in CSS that's written
// outermost-first, i.e. rotateZ(yaw) rotateX(pitch) rotateY(roll).

import type { BoardOrientationVisual } from '../view-models/board-orientation-visual'

export interface BoardOrientationDiagramProps {
  visual: BoardOrientationVisual
  testId?: string
}

export function BoardOrientationDiagram({ visual, testId }: BoardOrientationDiagramProps) {
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

  const boardTransform = `rotateZ(${visual.yaw}deg) rotateX(${visual.pitch}deg) rotateY(${visual.roll}deg)`

  return (
    <div className="board-orientation-diagram" data-testid={testId}>
      <div className="board-orientation-diagram__stage board-orientation-diagram__stage--3d">
        <span className="board-orientation-diagram__front" aria-hidden="true">
          FRONT
        </span>
        {/* Tilted scene so the board's thickness / which face is up reads. */}
        <div className="board-orientation-diagram__scene">
          <div
            className="board-orientation-diagram__board3d"
            data-testid="board-orientation-3d"
            style={{ transform: boardTransform }}
            role="img"
            aria-label={`Board mounted: ${visual.label}`}
          >
            {/* Top face — the component side, with the forward arrow. */}
            <div className="board-orientation-diagram__face board-orientation-diagram__face--top">
              <div className="board-orientation-diagram__arrow" aria-hidden="true" />
              {/* Body axes. X forward / Y right are the frame ArduPilot's roll
               *  and pitch are defined about, so naming them makes the arrow
               *  mean something specific rather than just "this way up". */}
              <div className="board-orientation-diagram__axes" aria-hidden="true">
                <span className="board-orientation-diagram__axis board-orientation-diagram__axis--x">X</span>
                <span className="board-orientation-diagram__axis board-orientation-diagram__axis--y">Y</span>
              </div>
              <div className="board-orientation-diagram__imu" aria-hidden="true" />
              <div className="board-orientation-diagram__usb" aria-hidden="true" />
            </div>
            {/* Bottom face — a distinct colour AND an explicit label, so an
             *  upside-down mount is unmistakable even in a still screenshot
             *  where the colour alone could read as a lighting effect. */}
            <div className="board-orientation-diagram__face board-orientation-diagram__face--bottom" aria-hidden="true">
              <span className="board-orientation-diagram__bottom-label">BOTTOM</span>
            </div>
          </div>
        </div>
      </div>
      <div className="board-orientation-diagram__caption">{visual.label}</div>
    </div>
  )
}
