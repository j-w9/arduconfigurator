// A category for a parameter the curated bundle does not describe.
//
// Only 709 of ArduCopter 4.7's ~5,690 parameters are hand-curated, so the
// remaining ~4,980 arrived in the UI as "Uncategorized": unfilterable on the
// Parameters tab, and lumped into one heap in every staged-change and snapshot
// diff. Reported from the app as "a ton of items in uncategorized — RC channels
// above 6, ATC params, OSD params", and those are only the visible edge of it.
//
// The rules below are NOT invented prefixes. ArduPilot already groups its own
// parameters -- the top-level keys of apm.pdef.json ARE the groups (`ATC_`,
// `OSD1_`, `BATT3_`, `RNGFND2_`, `SERIAL`, …) -- so these rules restate that
// grouping and map it onto this app's categories.
// `tests/parameter-category-coverage.test.mjs` checks the mapping against the
// pinned apm.pdef.json, so a family that firmware adds later shows up as a gap
// rather than silently landing back in "Uncategorized".
//
// DISPLAY ONLY. This is deliberately not folded into the curated metadata: a
// category there also decides what appears under a tab's "Additional settings",
// and quietly moving thousands of parameters onto those surfaces is a different
// change from letting them be grouped and filtered.

/**
 * The category ids this maps onto, which are the ones the curated bundle
 * already defines — nothing here invents a new category.
 */
export type FallbackCategoryId =
  | 'acro'
  | 'airframe'
  | 'sensors'
  | 'ports'
  | 'peripherals'
  | 'network'
  | 'vtx'
  | 'osd'
  | 'radio'
  | 'modes'
  | 'outputs'
  | 'gimbal'
  | 'rangefinder'
  | 'relays'
  | 'power'
  | 'failsafe'
  | 'fence'
  | 'tuning'
  | 'filters'
  | 'logging'

interface CategoryRule {
  /** Matched against the parameter id with digits removed (RC7_MIN -> RC_MIN). */
  readonly test: RegExp
  readonly category: FallbackCategoryId
}

/**
 * Ordered — first match wins, so a specific rule must precede a general one
 * (INS_HNTCH_* is filtering, the rest of INS_* is a sensor).
 */
const RULES: readonly CategoryRule[] = [
  // --- filters before the sensors they live on
  { test: /^INS_HNTC/, category: 'filters' },
  { test: /^INS_LOG_/, category: 'logging' },
  { test: /^FFT_/, category: 'filters' },
  // The FILTn_ notch bank — filtering, despite not living under INS_.
  { test: /^FILT_/, category: 'filters' },

  // --- sensors. ACC_ is the fork's Z-bias learning (ACC_ZBIAS_LEARN), which
  // is not in ArduPilot's pdef and so cannot be caught by the coverage test
  // against it — it was found sitting in "Uncategorized" in the app.
  { test: /^(INS|IMU|COMPASS_|BARO|AHRS_|EK_|EK_SRC|GPS|ARSPD|TEMP|RPM_|CUST_ROT|EAHRS|VISO|BCN|IM_|ACC_)/, category: 'sensors' },

  // --- radio / RC input. PILOT_* is stick feel, which is tuning, so it must
  // not be swept up by a broad RC rule.
  // RCL_ is the fork's AP_RC_Logic mixer; JS_ is ArduSub's joystick.
  { test: /^(RC_|RC$|RCMAP_|BTN_|RSSI_|SID|SIMPLE|SUPER_SIMPLE|RCL_|JS_)/, category: 'radio' },

  // --- flight modes and the mode-shaped features
  { test: /^(FLTMODE|LOIT_|PHLD_|FHLD|CIRCLE_|RTL_|SRTL_|LAND_|AROT_|ZIGZ_|TMODE|FOLL|PLND_|PLDP_|WP_|MIS_|RALLY_|TERRAIN_|SPRAY_|WVANE_|AUTOTUNE_|AUTO_OPTIONS|GUID_|THROW_|TKOFF_|SURFTRAK_|INITIAL_MODE|FLIGHT_OPTIONS|MODE$|MODE_CH|VALT_|WPNAV_|NAVL_|CRUISE_|SURFACE_DEPTH)/, category: 'modes' },

  // --- tuning / control
  { test: /^(ATC_|PSC|PILOT_|THR_DZ|TUNE|GND_EFFECT_COMP|SPEED_MAX|TURN_)/, category: 'tuning' },
  { test: /^ACRO_/, category: 'acro' },

  // --- outputs and the motor/servo stack
  { test: /^(MOT_|SERVO|H_|KDE_|ESC_TLM|LGR_)/, category: 'outputs' },
  { test: /^RELAY/, category: 'relays' },

  // --- power
  { test: /^(BATT|GEN_|POWR)/, category: 'power' },

  // --- peripherals hanging off the board
  { test: /^RNGFND/, category: 'rangefinder' },
  { test: /^(CAN_|CC|EFI|GRIP_|WINCH|PRX|FLOW|ADSB_|AIS_|DID_|NMEA_|FRSKY_|MSP|KDE)/, category: 'peripherals' },
  { test: /^(CAM|MNT)/, category: 'gimbal' },
  { test: /^NTF_/, category: 'relays' },

  // --- links
  { test: /^(SERIAL|MAV)/, category: 'ports' },
  { test: /^(NET_|DDS)/, category: 'network' },
  { test: /^VTX_/, category: 'vtx' },
  { test: /^OSD/, category: 'osd' },

  // --- safety
  { test: /^(FENCE_|AVOID_|AVD_|OA_)/, category: 'fence' },
  { test: /^(FS_|AFS_|CHUTE_|ARMING_|DISARM_DELAY|GCS_PID_MASK)/, category: 'failsafe' },

  // --- board / airframe
  { test: /^(BRD_|FRAME|SCHED_|STAT|VEHICLE|SCR_|CUST|FORMAT_VERSION|DEV_OPTIONS|FSTRATE_|ESC_CALIBRATION)/, category: 'airframe' },

  // --- logging
  { test: /^(LOG|TCAL)/, category: 'logging' }
]

/**
 * The category to show a parameter under when nothing curated describes it.
 *
 * Returns undefined rather than a guess for families this app has no home for
 * — SIM_* (SITL only, never reported by a real board) and Lua script
 * parameters. "Uncategorized" is the honest answer there.
 */
export function categoryForParameterId(parameterId: string): FallbackCategoryId | undefined {
  // Match on the family, not the instance: RC7_MIN, BATT3_AMP_OFFSET and
  // RNGFND2_TYPE are the same kind of thing as RC1_MIN, BATT_AMP_OFFSET and
  // RNGFND1_TYPE, and a rule per instance would go stale the moment ArduPilot
  // adds a ninth battery monitor.
  const family = parameterId.replace(/\d+/g, '')
  for (const rule of RULES) {
    if (rule.test.test(family)) {
      return rule.category
    }
  }
  return undefined
}
