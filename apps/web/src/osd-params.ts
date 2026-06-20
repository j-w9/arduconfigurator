// OSD-tab parameter groupings, extracted from App.tsx as part of its
// decomposition. Pure ArduPilot OSD parameter-id constants and the per-element
// overlay catalog the OSD tab renders from — no React, no app state.

// Per-element OSD overlay toggles. Each entry's `id` matches the
// firmware's OSD1_<id>_EN/X/Y parameter triplet; toggling the EN
// checkbox or dragging the preview commits a draft on that triplet.
// Expanded 2026-05-20 from 10 → 25 to cover the commonly-used
// Mission Planner overlay elements. Elements without live snapshot
// data render a short placeholder in the preview ("WIND", "SATS")
// but the toggle + drag-and-drop work the same way.
export const OSD_ELEMENTS = [
  { id: 'BAT_VOLT', label: 'Battery voltage' },
  { id: 'CURRENT', label: 'Battery current' },
  { id: 'BATUSED', label: 'Battery used (mAh)' },
  { id: 'RSSI', label: 'RSSI' },
  { id: 'ALTITUDE', label: 'Altitude' },
  { id: 'GSPEED', label: 'Ground speed' },
  { id: 'ASPEED', label: 'Airspeed' },
  { id: 'VSPEED', label: 'Vertical speed' },
  { id: 'HEADING', label: 'Heading' },
  { id: 'COMPASS', label: 'Compass tape' },
  { id: 'WIND', label: 'Wind' },
  { id: 'THROTTLE', label: 'Throttle' },
  { id: 'FLTMODE', label: 'Flight mode' },
  { id: 'MESSAGE', label: 'Status message' },
  { id: 'HOME', label: 'Home indicator' },
  { id: 'HORIZON', label: 'Horizon' },
  { id: 'SATS', label: 'GPS satellites' },
  { id: 'HDOP', label: 'GPS HDOP' },
  { id: 'WAYPOINT', label: 'Waypoint' },
  { id: 'DIST', label: 'Distance' },
  { id: 'TEMP', label: 'IMU temperature' },
  { id: 'ATEMP', label: 'Air temperature' },
  { id: 'CALLSIGN', label: 'Callsign' },
  // Expanded 2026-05-23 to the full ArduPilot OSD element set (65 total)
  // so every OSD1_<id>_EN the firmware exposes has a toggle.
  { id: 'ACRVOLT', label: 'Resting cell voltage' },
  { id: 'ARMING', label: 'Arming status' },
  { id: 'ASPD1', label: 'Airspeed 1' },
  { id: 'ASPD2', label: 'Airspeed 2' },
  { id: 'AVGCELLV', label: 'Avg cell voltage' },
  { id: 'BAT2USED', label: 'Battery 2 used (mAh)' },
  { id: 'BAT2_VLT', label: 'Battery 2 voltage' },
  { id: 'BATTBAR', label: 'Battery bar' },
  { id: 'BTEMP', label: 'Battery temperature' },
  { id: 'CELLVOLT', label: 'Cell voltage' },
  { id: 'CLIMBEFF', label: 'Climb efficiency' },
  { id: 'CLK', label: 'Clock' },
  { id: 'CRSSHAIR', label: 'Crosshair' },
  { id: 'CURRENT2', label: 'Battery 2 current' },
  { id: 'EFF', label: 'Efficiency' },
  { id: 'ESCAMPS', label: 'ESC current' },
  { id: 'ESCRPM', label: 'ESC RPM' },
  { id: 'ESCTEMP', label: 'ESC temperature' },
  { id: 'FENCE', label: 'Fence status' },
  { id: 'FLTIME', label: 'Flight time' },
  { id: 'GPSLAT', label: 'GPS latitude' },
  { id: 'GPSLONG', label: 'GPS longitude' },
  { id: 'HOMEDIR', label: 'Home direction' },
  { id: 'HOMEDIST', label: 'Home distance' },
  { id: 'LINK_Q', label: 'Link quality' },
  { id: 'PITCH', label: 'Pitch angle' },
  { id: 'PLUSCODE', label: 'Plus code' },
  { id: 'POWER', label: 'Power (W)' },
  { id: 'RC_ANT', label: 'RC antenna' },
  { id: 'RC_LQ', label: 'RC link quality' },
  { id: 'RC_PWR', label: 'RC TX power' },
  { id: 'RC_SNR', label: 'RC SNR' },
  { id: 'RESTVOLT', label: 'Resting voltage' },
  { id: 'RNGF', label: 'Rangefinder' },
  { id: 'ROLL', label: 'Roll angle' },
  { id: 'RPM', label: 'Motor RPM' },
  { id: 'RSSIDBM', label: 'RSSI (dBm)' },
  { id: 'SIDEBARS', label: 'Sidebars' },
  { id: 'STATS', label: 'Stats' },
  { id: 'TER_HGT', label: 'Terrain height' },
  { id: 'VTX_PWR', label: 'VTX power' },
  { id: 'XTRACK', label: 'Crosstrack error' }
] as const

// ArduPilot exposes 4 OSD screens (OSD1/OSD2/OSD3/OSD4); each has its
// own per-element EN/X/Y triplet plus its own ENABLE + CHAN_MIN/MAX.
// We mirror that layout: screen 1 is the default, the user can switch
// to 2/3/4 from the OSD tab's screen tabs.
export const OSD_SCREEN_NUMBERS = [1, 2, 3, 4] as const
export type OsdScreenNumber = typeof OSD_SCREEN_NUMBERS[number]

// Pre-compute EN/X/Y param ids across all 4 screens × 25 elements so
// the OSD scope picks up every per-screen draft. Editing on screen 2
// then switching to screen 1 should NOT lose the draft — they're all
// in the OSD apply pool.
export const OSD_ELEMENT_EN_PARAM_IDS = OSD_SCREEN_NUMBERS.flatMap((screen) =>
  OSD_ELEMENTS.map((element) => `OSD${screen}_${element.id}_EN` as const)
)
export const OSD_ELEMENT_X_PARAM_IDS = OSD_SCREEN_NUMBERS.flatMap((screen) =>
  OSD_ELEMENTS.map((element) => `OSD${screen}_${element.id}_X` as const)
)
export const OSD_ELEMENT_Y_PARAM_IDS = OSD_SCREEN_NUMBERS.flatMap((screen) =>
  OSD_ELEMENTS.map((element) => `OSD${screen}_${element.id}_Y` as const)
)

// Per-screen "Screen Options" (Mission Planner panel): enable, HD text
// resolution, font, RC channel switch range, and ESC telemetry index.
export const OSD_SCREEN_OPTION_SUFFIXES = ['ENABLE', 'TXT_RES', 'FONT', 'CHAN_MIN', 'CHAN_MAX', 'ESC_IDX'] as const
export const OSD_SCREEN_OPTION_PARAM_IDS = OSD_SCREEN_NUMBERS.flatMap((screen) =>
  OSD_SCREEN_OPTION_SUFFIXES.map((suffix) => `OSD${screen}_${suffix}` as const)
)

export const OSD_PARAM_IDS = [
  'OSD_TYPE',
  'OSD_CHAN',
  'OSD_SW_METHOD',
  'MSP_OPTIONS',
  'MSP_OSD_NCELLS',
  ...OSD_SCREEN_OPTION_PARAM_IDS,
  ...OSD_ELEMENT_EN_PARAM_IDS,
  ...OSD_ELEMENT_X_PARAM_IDS,
  ...OSD_ELEMENT_Y_PARAM_IDS
] as const
