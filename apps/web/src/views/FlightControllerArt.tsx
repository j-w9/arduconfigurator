// A drawn flight controller for the board-orientation picture: a 36 x 36 mm
// board on the 30.5 mm mounting pattern (1 unit = 0.1 mm). Generic on
// purpose: no real product's layout or branding. The top carries the MCU, IMU,
// baro, passives, labelled pads, USB-C and the forward arrow; the bottom
// carries the outlined arrow, an SD slot and "BOTTOM".

import type { ReactElement } from 'react'

const SIZE = 360
const HOLE = 27.5 // (36 - 30.5) / 2 mm
const HOLES: Array<[number, number]> = [
  [HOLE, HOLE],
  [SIZE - HOLE, HOLE],
  [HOLE, SIZE - HOLE],
  [SIZE - HOLE, SIZE - HOLE]
]

function MountingHoles(): ReactElement {
  return (
    <>
      {HOLES.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="27" fill="#d4af55" />
          <circle cx={cx} cy={cy} r="17" fill="#0a1a12" />
        </g>
      ))}
    </>
  )
}

// A row of edge pads with silkscreen labels.
function PadColumn({ x, labels, labelSide }: { x: number; labels: string[]; labelSide: 'left' | 'right' }): ReactElement {
  const top = 92
  const pitch = 30
  return (
    <>
      {labels.map((label, index) => {
        const y = top + index * pitch
        return (
          <g key={label}>
            <rect x={x} y={y} width="26" height="18" rx="3" fill="#d4af55" />
            <text
              x={labelSide === 'right' ? x + 32 : x - 6}
              y={y + 14}
              textAnchor={labelSide === 'right' ? 'start' : 'end'}
              className="fc-art__silk"
            >
              {label}
            </text>
          </g>
        )
      })}
    </>
  )
}

// A QFP: a body with pins on all four sides.
function Qfp({ x, y, size, pins }: { x: number; y: number; size: number; pins: number }): ReactElement {
  const ticks: ReactElement[] = []
  const step = (size - 12) / (pins - 1)
  for (let i = 0; i < pins; i += 1) {
    const p = 6 + i * step
    ticks.push(
      <rect key={`t${i}`} x={x + p - 1.5} y={y - 8} width="3" height="8" fill="#c7cbcf" />,
      <rect key={`b${i}`} x={x + p - 1.5} y={y + size} width="3" height="8" fill="#c7cbcf" />,
      <rect key={`l${i}`} x={x - 8} y={y + p - 1.5} width="8" height="3" fill="#c7cbcf" />,
      <rect key={`r${i}`} x={x + size} y={y + p - 1.5} width="8" height="3" fill="#c7cbcf" />
    )
  }
  return (
    <g>
      {ticks}
      <rect x={x} y={y} width={size} height={size} rx="3" fill="#15181a" />
      <circle cx={x + 10} cy={y + 10} r="4" fill="#3a4044" />
    </g>
  )
}

// Small passives: 0402/0603 resistors and capacitors.
const PASSIVES: Array<[number, number, number, number, string]> = [
  [96, 160, 14, 8, '#b98a4b'],
  [96, 176, 14, 8, '#b98a4b'],
  [96, 192, 14, 8, '#5b5550'],
  [250, 160, 14, 8, '#b98a4b'],
  [250, 176, 8, 14, '#5b5550'],
  [264, 176, 8, 14, '#5b5550'],
  [250, 200, 14, 8, '#b98a4b'],
  [130, 258, 14, 8, '#b98a4b'],
  [148, 258, 14, 8, '#5b5550'],
  [198, 258, 14, 8, '#b98a4b'],
  [216, 258, 14, 8, '#5b5550'],
  [150, 112, 8, 14, '#b98a4b'],
  [204, 112, 8, 14, '#5b5550']
]

export function FlightControllerTop(): ReactElement {
  return (
    <svg className="fc-art" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <rect x="1" y="1" width={SIZE - 2} height={SIZE - 2} rx="22" fill="#1d5a3b" stroke="#0e3523" strokeWidth="2" />
      {/* Copper pours under the mask. */}
      <rect x="64" y="70" width="232" height="220" rx="10" fill="#21673f" />
      <MountingHoles />

      {/* Forward arrow, the thing to line up with the nose. */}
      <path d="M180 10 L222 60 L198 60 L198 82 L162 82 L162 60 L138 60 Z" className="fc-art__arrow" />
      <text x="232" y="40" className="fc-art__silk fc-art__silk--axis">X</text>
      <text x="318" y="186" className="fc-art__silk fc-art__silk--axis">Y</text>
      <path d="M300 180 L314 180" stroke="#e8f1ea" strokeWidth="3" />
      <path d="M314 174 L322 180 L314 186 Z" fill="#e8f1ea" />

      {/* IMU and baro beside the MCU. */}
      <rect x="112" y="102" width="30" height="30" rx="3" fill="#1b1e20" />
      <circle cx="118" cy="108" r="2.5" fill="#4a5155" />
      <text x="127" y="146" textAnchor="middle" className="fc-art__silk">IMU</text>
      <rect x="220" y="104" width="26" height="22" rx="3" fill="#c8ccd0" />
      <circle cx="233" cy="115" r="3" fill="#7d8489" />
      <text x="233" y="142" textAnchor="middle" className="fc-art__silk">BARO</text>

      <Qfp x={132} y={150} size={96} pins={12} />

      {PASSIVES.map(([x, y, w, h, fill]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="1.5" fill={fill} />
      ))}

      {/* Status LEDs and the boot button. */}
      <rect x="262" y="76" width="10" height="7" rx="1.5" fill="#4ea3ff" />
      <rect x="276" y="76" width="10" height="7" rx="1.5" fill="#57d977" />
      <rect x="290" y="76" width="10" height="7" rx="1.5" fill="#ff5a4f" />
      <rect x="72" y="74" width="26" height="18" rx="3" fill="#d9dcdf" />
      <circle cx="85" cy="83" r="5" fill="#7c8388" />
      <text x="85" y="106" textAnchor="middle" className="fc-art__silk">BOOT</text>

      <PadColumn x={18} labels={['5V', 'G', 'T1', 'R1', 'T2', 'R2', 'SDA']} labelSide="right" />
      <PadColumn x={SIZE - 44} labels={['BAT', 'G', 'CUR', 'T3', 'R3', 'T4', 'SCL']} labelSide="left" />

      {/* Motor pads along the back edge, either side of the USB port. */}
      {['M1', 'M2', 'M3', 'M4'].map((label, index) => {
        const x = index < 2 ? 70 + index * 34 : 222 + (index - 2) * 34
        return (
          <g key={label}>
            <rect x={x} y={312} width="24" height="20" rx="3" fill="#d4af55" />
            <text x={x + 12} y={304} textAnchor="middle" className="fc-art__silk">{label}</text>
          </g>
        )
      })}

      {/* USB-C, overhanging the back edge. */}
      <rect x="148" y="318" width="64" height="46" rx="10" fill="#b9bec2" stroke="#7d8489" strokeWidth="2" />
      <rect x="160" y="340" width="40" height="12" rx="6" fill="#2a2e31" />

      <text x="180" y="300" textAnchor="middle" className="fc-art__silk fc-art__silk--brand">FC H7</text>
    </svg>
  )
}

export function FlightControllerBottom(): ReactElement {
  // Drawn as seen from underneath. The board flips about its forward axis to
  // show this face, so the arrow end stays at the top of the drawing.
  return (
    <svg className="fc-art" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <rect x="1" y="1" width={SIZE - 2} height={SIZE - 2} rx="22" fill="#1d5a3b" stroke="#0e3523" strokeWidth="2" />
      {/* The warm wash marks the underside at a glance. */}
      <rect x="1" y="1" width={SIZE - 2} height={SIZE - 2} rx="22" className="fc-art__underside" />
      <MountingHoles />
      <path d="M180 10 L222 60 L198 60 L198 82 L162 82 L162 60 L138 60 Z" className="fc-art__arrow fc-art__arrow--outline" />
      {/* SD card slot. */}
      <rect x="110" y="120" width="140" height="120" rx="8" fill="#b9bec2" stroke="#7d8489" strokeWidth="2" />
      <rect x="122" y="132" width="116" height="80" rx="4" fill="#9aa0a5" />
      <text x="180" y="230" textAnchor="middle" className="fc-art__silk fc-art__silk--dark">microSD</text>
      {[60, 80, 270, 290].map((x) => (
        <rect key={x} x={x} y={150} width="14" height="8" rx="1.5" fill="#b98a4b" />
      ))}
      <text x="180" y="300" textAnchor="middle" className="fc-art__silk fc-art__silk--bottom">BOTTOM</text>
    </svg>
  )
}
