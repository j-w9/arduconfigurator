// Top-down picture of the flight controller as it is mounted, from the
// AHRS_ORIENTATION value. A board rectangle with a forward arrow, a USB
// connector notch and an IMU chip, rotated by the orientation's yaw and flipped
// when the board is mounted upside down — so the operator sees the mounting, not
// just an enum value. Edge/tilted and custom orientations show a note instead of
// a misleading flat rotation. Dumb presentational component.

import type { BoardOrientationVisual } from '../view-models/board-orientation-visual'

export interface BoardOrientationDiagramProps {
  visual: BoardOrientationVisual
  testId?: string
}

export function BoardOrientationDiagram({ visual, testId }: BoardOrientationDiagramProps) {
  const depictable = visual.kind === 'flat' || visual.kind === 'inverted'

  return (
    <div className="board-orientation-diagram" data-testid={testId}>
      <div className="board-orientation-diagram__stage">
        {/* Fixed airframe reference: "FRONT" marker at the top, so the board's
            rotation reads against the vehicle's forward direction. */}
        <span className="board-orientation-diagram__front" aria-hidden="true">
          FRONT
        </span>
        {depictable ? (
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`Board mounted: ${visual.label}`}
            className="board-orientation-diagram__svg"
            style={{
              // Yaw rotates the board; a 180° flip mirrors it about the axis the
              // roll/pitch inversion acts on (x = left-right for Roll 180, y =
              // top-bottom for Pitch 180) so the forward arrow points correctly.
              transform: `rotate(${visual.yawDeg}deg)${
                visual.mirror === 'x' ? ' scaleX(-1)' : visual.mirror === 'y' ? ' scaleY(-1)' : ''
              }`
            }}
          >
            {/* Board body */}
            <rect x="30" y="24" width="60" height="72" rx="7" className="board-orientation-diagram__board" />
            {/* Forward arrow (points to the board's own +X / nose) */}
            <polygon points="60,10 52,28 68,28" className="board-orientation-diagram__arrow" />
            <line x1="60" y1="26" x2="60" y2="60" className="board-orientation-diagram__arrow-stem" />
            {/* USB / connector notch at the rear edge */}
            <rect x="50" y="96" width="20" height="7" rx="2" className="board-orientation-diagram__usb" />
            {/* IMU chip, offset so a flip is visible */}
            <rect x="44" y="40" width="20" height="20" rx="3" className="board-orientation-diagram__imu" />
          </svg>
        ) : (
          <div className="board-orientation-diagram__note" data-testid="board-orientation-note">
            <strong>{visual.label}</strong>
            <p>{visual.note}</p>
          </div>
        )}
      </div>
      <div className="board-orientation-diagram__caption">
        <span>{visual.label}</span>
        {visual.inverted ? <span className="board-orientation-diagram__badge">Upside down</span> : null}
      </div>
    </div>
  )
}
