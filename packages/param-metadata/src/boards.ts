export type BoardReferenceKind = 'photo' | 'pinout' | 'manual' | 'documentation'

export interface BoardReferenceLink {
  id: string
  label: string
  description: string
  kind: BoardReferenceKind
  url: string
}

export interface BoardCatalogEntry {
  boardType: number
  slug: string
  label: string
  familyLabel?: string
  manufacturerName: string
  manufacturerUrl: string
  wikiUrl: string
  referenceLinks: BoardReferenceLink[]
  hardwarePortLabels: Record<string, string>
}

export const BOARD_CATALOG: BoardCatalogEntry[] = [
  {
    boardType: 53,
    slug: 'pixhawk-6x',
    label: 'Pixhawk 6X',
    familyLabel: 'Holybro Pixhawk 6X / 6X Pro',
    manufacturerName: 'Holybro',
    manufacturerUrl: 'https://docs.holybro.com/autopilot/pixhawk-6x/overview',
    wikiUrl: 'https://ardupilot.org/copter/docs/common-holybro-pixhawk6X.html',
    referenceLinks: [
      {
        id: 'pixhawk6x-overview',
        label: 'ArduPilot Overview',
        description: 'ArduPilot hardware overview and UART mapping for the Pixhawk 6X family.',
        kind: 'documentation',
        url: 'https://ardupilot.org/copter/docs/common-holybro-pixhawk6X.html'
      },
      {
        id: 'pixhawk6x-holybro',
        label: 'Holybro Docs',
        description: 'Manufacturer overview, pinout, and hardware integration guidance.',
        kind: 'documentation',
        url: 'https://docs.holybro.com/autopilot/pixhawk-6x/overview'
      }
    ],
    hardwarePortLabels: {
      OTG1: 'USB',
      UART7: 'Telem 1',
      UART5: 'Telem 2',
      USART1: 'GPS 1',
      UART8: 'GPS 2',
      USART2: 'Telem 3',
      UART4: 'User',
      USART3: 'Debug',
      OTG2: 'USB Virtual / SLCAN'
    }
  },
  {
    boardType: 57,
    slug: 'arkv6x',
    label: 'ARKV6X',
    familyLabel: 'ARK Electronics Pixhawk 6X',
    manufacturerName: 'ARK Electronics',
    manufacturerUrl: 'https://docs.arkelectron.com/products/flight-controller/arkv6x',
    wikiUrl: 'https://ardupilot.org/copter/docs/common-arkv6x-overview.html',
    referenceLinks: [
      {
        id: 'arkv6x-overview',
        label: 'ArduPilot Overview',
        description: 'ArduPilot hardware overview for the ARKV6X flight controller family.',
        kind: 'documentation',
        url: 'https://ardupilot.org/copter/docs/common-arkv6x-overview.html'
      },
      {
        id: 'arkv6x-docs',
        label: 'ARK Documentation',
        description: 'Manufacturer documentation including ArduPilot install notes and serial mapping.',
        kind: 'documentation',
        url: 'https://docs.arkelectron.com/flight-controller/arkv6x/ardupilot-instructions'
      }
    ],
    hardwarePortLabels: {
      OTG1: 'USB-C',
      UART7: 'Telem 1',
      UART5: 'Telem 2',
      USART1: 'GPS',
      UART8: 'GPS 2',
      USART2: 'Telem 3',
      UART4: 'UART4 / I2C',
      USART3: 'Debug Console',
      USART6: 'PX4IO / RC'
    }
  },
  {
    boardType: 59,
    slug: 'ark-fpv',
    label: 'ARK FPV',
    manufacturerName: 'ARK Electronics',
    manufacturerUrl: 'https://docs.arkelectron.com/flight-controller/ark-fpv/pinout',
    wikiUrl: 'https://ardupilot.org/copter/docs/common-ark-fpv-overview.html',
    referenceLinks: [
      {
        id: 'ark-fpv-overview',
        label: 'ArduPilot Overview',
        description: 'ArduPilot hardware overview and board summary.',
        kind: 'documentation',
        url: 'https://ardupilot.org/copter/docs/common-ark-fpv-overview.html'
      },
      {
        id: 'ark-fpv-pinout',
        label: 'ARK Pinout',
        description: 'Manufacturer pinout and connector naming for the ARK FPV board.',
        kind: 'pinout',
        url: 'https://docs.arkelectron.com/flight-controller/ark-fpv/pinout'
      }
    ],
    hardwarePortLabels: {
      OTG1: 'USB',
      UART7: 'Telem 1',
      UART5: 'Telem 2 / VTX',
      USART1: 'GPS',
      UART8: 'GPS2',
      USART2: 'Telem 3 / VTX',
      UART4: 'PWM / UART4',
      USART3: 'Debug',
      USART6: 'RC'
    }
  },
  {
    boardType: 1013,
    slug: 'matekh743',
    label: 'Matek H743',
    familyLabel: 'H743-WING / SLIM / MINI / WLITE',
    manufacturerName: 'Matek Systems',
    manufacturerUrl: 'https://www.mateksys.com/?portfolio=h743-wlite',
    wikiUrl: 'https://ardupilot.org/copter/docs/common-matekh743-wing.html',
    referenceLinks: [
      {
        id: 'matekh743-overview',
        label: 'ArduPilot Overview',
        description: 'ArduPilot wiki overview for the supported H743 family.',
        kind: 'documentation',
        url: 'https://ardupilot.org/copter/docs/common-matekh743-wing.html'
      },
      {
        id: 'matekh743-manual',
        label: 'Matek Manual',
        description: 'Manufacturer quick-start guide and pinout documentation.',
        kind: 'manual',
        url: 'https://mateksys.com/downloads/Manual/H743-WLITE_Manual.pdf'
      }
    ],
    hardwarePortLabels: {
      OTG1: 'USB',
      USART1: 'Telem 2',
      USART2: 'GPS 1',
      USART3: 'GPS 2',
      UART4: 'User / ESC Telemetry',
      UART6: 'RC / SBUS / CRSF',
      UART7: 'Telem 1',
      UART8: 'User'
    }
  },
  {
    boardType: 7000,
    slug: 'cuav-7-nano',
    label: 'CUAV-7-Nano',
    manufacturerName: 'CUAV',
    manufacturerUrl: 'https://doc.cuav.net/controller/7-nano/en/',
    wikiUrl: 'https://ardupilot.org/rover/docs/common-CUAV-7-Nano.html',
    referenceLinks: [
      {
        id: 'cuav-7-nano-overview',
        label: 'ArduPilot Overview',
        description: 'ArduPilot hardware page for the CUAV-7-Nano family.',
        kind: 'documentation',
        url: 'https://ardupilot.org/rover/docs/common-CUAV-7-Nano.html'
      },
      {
        id: 'cuav-7-nano-docs',
        label: 'CUAV Manual',
        description: 'Manufacturer user manual and quick-start documentation for the 7-Nano.',
        kind: 'documentation',
        url: 'https://doc.cuav.net/controller/7-nano/en/ardupilot-users-manual.html'
      }
    ],
    hardwarePortLabels: {
      OTG1: 'USB-C',
      UART7: 'Telem 1',
      UART5: 'Telem 2',
      USART1: 'GPS 1 / Safety',
      UART8: 'GPS 2',
      USART3: 'Debug'
    }
  },
  {
    // Confirmed against a live FC: AUTOPILOT_VERSION.boardVersion >> 16 = 1118,
    // boot banner "RADIX2HD", ArduCopter V4.6.3. Added during the real-FC
    // audit. Catalog entry lets the Ports tab identify the board on connect;
    // referenceLinks / hardwarePortLabels stay minimal until verified against
    // the manufacturer's docs.
    boardType: 1118,
    slug: 'brainfpv-radix-2-hd',
    label: 'BrainFPV Radix 2 HD',
    familyLabel: 'BrainFPV Radix 2 HD',
    manufacturerName: 'BrainFPV',
    manufacturerUrl: 'https://www.brainfpv.com/',
    wikiUrl: 'https://ardupilot.org/copter/docs/common-autopilots.html',
    referenceLinks: [
      {
        id: 'radix2hd-ardupilot-overview',
        label: 'ArduPilot Autopilot Index',
        description: 'ArduPilot supported-autopilot index — pick BrainFPV Radix 2 HD for the bundled docs.',
        kind: 'documentation',
        url: 'https://ardupilot.org/copter/docs/common-autopilots.html'
      },
      {
        id: 'radix2hd-manufacturer',
        label: 'BrainFPV',
        description: 'Manufacturer site for Radix family flight controllers.',
        kind: 'documentation',
        url: 'https://www.brainfpv.com/'
      }
    ],
    hardwarePortLabels: {}
  }
]

export function findBoardCatalogEntry(boardType: number | undefined): BoardCatalogEntry | undefined {
  if (boardType === undefined) {
    return undefined
  }

  return BOARD_CATALOG.find((entry) => entry.boardType === boardType)
}
