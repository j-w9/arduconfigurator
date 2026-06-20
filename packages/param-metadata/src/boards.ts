export type BoardReferenceKind = 'photo' | 'pinout' | 'manual' | 'documentation'

export interface BoardReferenceLink {
  id: string
  label: string
  description: string
  kind: BoardReferenceKind
  url: string
}

export interface BoardMediaAsset {
  id: string
  label: string
  description: string
  kind: Extract<BoardReferenceKind, 'photo' | 'pinout'>
  assetPath: string
  alt: string
}

/** One manufacturer board photo (hot-linked from the vendor site). */
export interface BoardVariantImage {
  label: string
  /** Absolute vendor URL (e.g. mateksys.com/wp-content/uploads/...). */
  url: string
}

/** A sub-variant of a board family (e.g. the H743 WING / SLIM / MINI / WLITE),
 *  each with its own official photos. The same board_id is reported by the FC
 *  for the whole family, so the configurator can't auto-detect which one — the
 *  operator picks it from a dropdown to see the right board's photos. */
export interface BoardVariant {
  id: string
  label: string
  /** Manufacturer product / manual page for this exact variant. */
  productUrl: string
  /** Official board photos for this variant (top + layout/pinout). */
  images: BoardVariantImage[]
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
  mediaAssets: BoardMediaAsset[]
  hardwarePortLabels: Record<string, string>
  /** Optional per-variant official photos, shown via a variant picker. */
  variants?: BoardVariant[]
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
    mediaAssets: [
      {
        id: 'pixhawk6x-uart-map',
        label: 'UART Quick Reference',
        description: 'Bundled connector map for the Pixhawk 6X serial and USB ports.',
        kind: 'pinout',
        assetPath: '/boards/pixhawk6x/pixhawk6x-uart-map.svg',
        alt: 'Pixhawk 6X connector reference showing USB, telem, GPS, user, and debug ports.'
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
    mediaAssets: [
      {
        id: 'arkv6x-uart-map',
        label: 'UART Quick Reference',
        description: 'Bundled connector map for ARKV6X serial roles and carrier-facing ports.',
        kind: 'pinout',
        assetPath: '/boards/arkv6x/arkv6x-uart-map.svg',
        alt: 'ARKV6X connector reference showing telem, GPS, UART4, debug, PX4IO, and USB roles.'
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
    mediaAssets: [
      {
        id: 'ark-fpv-port-map',
        label: 'Port Map',
        description: 'Bundled top-level port map for the ARK FPV carrier-facing connectors.',
        kind: 'photo',
        assetPath: '/boards/ark-fpv/ark-fpv-port-map.svg',
        alt: 'ARK FPV board illustration with USB, telem, GPS, VTX, RC, and debug connectors labeled.'
      },
      {
        id: 'ark-fpv-serial-reference',
        label: 'Serial Roles',
        description: 'Compact SERIAL-to-connector cheat sheet for the ARK FPV default firmware mapping.',
        kind: 'pinout',
        assetPath: '/boards/ark-fpv/ark-fpv-serial-reference.svg',
        alt: 'ARK FPV serial reference table mapping SERIAL0 through SERIAL8 to named connectors.'
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
    mediaAssets: [
      {
        id: 'matekh743-layout',
        label: 'Connector Layout',
        description: 'Bundled board layout showing the common telem, GPS, RC, and user UART connectors.',
        kind: 'photo',
        assetPath: '/boards/matekh743/matekh743-layout.svg',
        alt: 'Matek H743 board illustration showing common connectors for telem, GPS, RC, and user UARTs.'
      },
      {
        id: 'matekh743-serial-reference',
        label: 'Serial Roles',
        description: 'Compact SERIAL-to-connector reference for the Matek H743 family defaults.',
        kind: 'pinout',
        assetPath: '/boards/matekh743/matekh743-serial-reference.svg',
        alt: 'Matek H743 serial reference table mapping SERIAL ports to named connectors.'
      }
    ],
    // The H743 family all reports board_id 1013, so the FC can't say which
    // variant it is — the operator picks it to see the right official photos
    // (top + layout/pinout) hot-linked from mateksys.com.
    variants: [
      {
        id: 'h743-wing',
        label: 'H743-WING V2',
        productUrl: 'https://www.mateksys.com/?portfolio=h743-wing-v3',
        images: [
          { label: 'Top', url: 'https://www.mateksys.com/wp-content/uploads/2021/09/H743-WING-V2_1.jpg' },
          { label: 'Layout / pinout', url: 'https://www.mateksys.com/wp-content/uploads/2021/09/H743-WING-V2_layout.jpg' }
        ]
      },
      {
        id: 'h743-slim',
        label: 'H743-SLIM V4',
        productUrl: 'https://www.mateksys.com/?portfolio=h743-slim-v4',
        images: [
          { label: 'Top', url: 'https://www.mateksys.com/wp-content/uploads/2025/07/H743-SLIM-V4_1.jpg' },
          { label: 'Layout / pinout', url: 'https://www.mateksys.com/wp-content/uploads/2025/07/H743-SLIM-V4_layout.jpg' }
        ]
      },
      {
        id: 'h743-mini',
        label: 'H743-MINI',
        productUrl: 'https://www.mateksys.com/?portfolio=h743-mini',
        images: [
          { label: 'Top', url: 'https://www.mateksys.com/wp-content/uploads/2020/10/H743-MINI_1.jpg' },
          { label: 'Layout / pinout', url: 'https://www.mateksys.com/wp-content/uploads/2020/10/H743-mini_layout_V3.jpg' }
        ]
      },
      {
        id: 'h743-wlite',
        label: 'H743-WLITE (EOL)',
        productUrl: 'https://www.mateksys.com/?portfolio=h743-wlite',
        images: [
          { label: 'Top', url: 'https://www.mateksys.com/wp-content/uploads/2022/04/H743-WLITE_1.jpg' },
          { label: 'Layout / pinout', url: 'https://www.mateksys.com/wp-content/uploads/2022/04/H743-WLITE-layout.jpg' }
        ]
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
    mediaAssets: [
      {
        id: 'cuav-7-nano-uart-map',
        label: 'UART Quick Reference',
        description: 'Bundled serial mapping summary for CUAV-7-Nano USB, telem, GPS, and debug connectors.',
        kind: 'pinout',
        assetPath: '/boards/cuav-7-nano/cuav-7-nano-uart-map.svg',
        alt: 'CUAV-7-Nano connector reference showing USB, telem, GPS, and debug roles.'
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
    // referenceLinks / mediaAssets / hardwarePortLabels stay minimal until
    // verified against the manufacturer's docs.
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
    mediaAssets: [],
    hardwarePortLabels: {}
  }
]

export function findBoardCatalogEntry(boardType: number | undefined): BoardCatalogEntry | undefined {
  if (boardType === undefined) {
    return undefined
  }

  return BOARD_CATALOG.find((entry) => entry.boardType === boardType)
}
