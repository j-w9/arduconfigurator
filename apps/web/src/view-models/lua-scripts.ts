// Pure view-model for the Lua Scripts tab: the curated applet catalog, the
// scripting-capability gate (SCR_ENABLE / SCR_HEAP_SIZE), and best-effort
// per-applet prerequisite sanity checks. No runtime / transport / MAVLink
// imports — App feeds it the parameter snapshot and the installed-file listing
// and renders the plain result. Unit-tested directly in lua-scripts.test.ts.
//
// GPL provenance for the bundled applets lives on each catalog entry's `source`
// and `license` fields; the `.lua` bodies are under apps/web/src/lua-applets/.

/** Where Lua scripts live on the SD card. Hardware uses /APM/scripts; a SITL
 *  build uses /scripts. We target hardware by default (the browser app's normal
 *  audience) and surface the SITL path in the UI copy. */
export const LUA_SCRIPTS_DIR = '/APM/scripts'
export const LUA_SCRIPTS_DIR_SITL = '/scripts'

/** Heap we stage when enabling scripting if the current heap looks too small,
 *  and the floor below which we warn. 100 KiB is a comfortable default for the
 *  small applets in this catalog. */
export const LUA_RECOMMENDED_HEAP_BYTES = 102400
export const LUA_MIN_SAFE_HEAP_BYTES = 65536

/** Ceiling on an uploaded script; ArduPilot scripts are tiny, so anything large
 *  is almost certainly a mistake (wrong file). */
export const LUA_MAX_SCRIPT_BYTES = 512 * 1024

export type ScriptingCapability =
  // SCR_ENABLE is absent — this firmware build has no Lua VM at all.
  | 'unsupported'
  // SCR_ENABLE present but 0 — scripting is compiled in but switched off.
  | 'disabled'
  // SCR_ENABLE present and non-zero — scripting is on.
  | 'enabled'

export interface ScriptingCapabilityResult {
  capability: ScriptingCapability
  scrEnablePresent: boolean
  scrEnableValue: number | null
  heapSizePresent: boolean
  heapSizeBytes: number | null
  /** Heap is present and below the safe floor. */
  heapLow: boolean
  recommendedHeapBytes: number
}

type ParamInput = readonly { id: string; value: number }[]

function toMap(params: ParamInput): Map<string, number> {
  return new Map(params.map((parameter) => [parameter.id, parameter.value]))
}

export function evaluateScriptingCapability(params: ParamInput): ScriptingCapabilityResult {
  const byId = toMap(params)
  const scrEnablePresent = byId.has('SCR_ENABLE')
  const scrEnableValue = scrEnablePresent ? (byId.get('SCR_ENABLE') as number) : null
  const heapSizePresent = byId.has('SCR_HEAP_SIZE')
  const heapSizeBytes = heapSizePresent ? (byId.get('SCR_HEAP_SIZE') as number) : null

  const capability: ScriptingCapability = !scrEnablePresent
    ? 'unsupported'
    : (scrEnableValue ?? 0) !== 0
      ? 'enabled'
      : 'disabled'

  return {
    capability,
    scrEnablePresent,
    scrEnableValue,
    heapSizePresent,
    heapSizeBytes,
    heapLow: heapSizeBytes !== null && heapSizeBytes < LUA_MIN_SAFE_HEAP_BYTES,
    recommendedHeapBytes: LUA_RECOMMENDED_HEAP_BYTES
  }
}

// A prerequisite the applet's own header documents. Checks are best-effort and
// never hard-block an install — they render as warnings the operator can weigh.
export type LuaPrereqTest =
  // Satisfied if any of these params is present at all.
  | { kind: 'paramPresent'; anyOf: readonly string[] }
  // Satisfied if any of these params is present AND non-zero.
  | { kind: 'paramNonZero'; anyOf: readonly string[] }
  // Satisfied if any SERIALx_PROTOCOL equals `protocol`.
  | { kind: 'serialProtocol'; protocol: number }
  // Never fails — pure guidance shown on the card.
  | { kind: 'info' }

export interface LuaPrerequisite {
  label: string
  detail?: string
  test: LuaPrereqTest
}

export type LuaAppletCategory =
  | 'VTX'
  | 'LED'
  | 'Camera'
  | 'Battery'
  | 'Gimbal'
  | 'Winch'
  | 'Scripting'
  | 'Safety'
  | 'Tuning'
  | 'Testing'
  | 'Navigation'

export interface LuaAppletMeta {
  id: string
  name: string
  /** On-SD filename; also the key used to detect an already-installed copy. */
  filename: string
  summary: string
  description: string
  category: LuaAppletCategory
  prerequisites: readonly LuaPrerequisite[]
  /** Upstream path (GPL provenance). */
  source: string
  license: string
}

const UPSTREAM = 'ArduPilot libraries/AP_Scripting/applets'
const GPL = 'GPL-3.0-or-later'

// Curated set: broadly useful, low-risk, single-file applets (no extra module
// directories to copy) so "Install" is genuinely one click. Each summary /
// prereq set is taken from the applet's own header comment.
export const LUA_APPLET_CATALOG: readonly LuaAppletMeta[] = [
  {
    id: 'smartaudio',
    name: 'VTX SmartAudio control',
    filename: 'SmartAudio.lua',
    category: 'VTX',
    summary: 'Set the video transmitter power level / pit mode from an RC switch over SmartAudio 2.0.',
    description:
      'Drives an analog VTX that speaks SmartAudio 2.0 (power level and pit mode) from a spare serial port. ' +
      'Set the boot power with SCR_USER1 (-1 keeps it unchanged) and change it in flight from an RC switch.',
    prerequisites: [
      {
        label: 'A spare serial port set to Scripting (protocol 28), half-duplex',
        detail: 'Wire the port TX to the VTX SmartAudio pin; set the port option to 4 (half-duplex).',
        test: { kind: 'serialProtocol', protocol: 28 }
      },
      {
        label: 'An RC channel with RCx_OPTION = 300 (scripting) to change power',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/SmartAudio.lua`,
    license: GPL
  },
  {
    id: 'leds-on-switch',
    name: 'LED brightness on a switch',
    filename: 'leds_on_a_switch.lua',
    category: 'LED',
    summary: 'Turn the notify LEDs off / dim / full from a 3-position RC switch.',
    description:
      'Maps a 3-position RC switch (aux function 300) to NTF_LED_BRIGHT so you can kill or dim the ' +
      'notify LEDs for night flying without pulling parameters.',
    prerequisites: [
      {
        label: 'Notify LEDs configured (NTF_LED_BRIGHT present)',
        test: { kind: 'paramPresent', anyOf: ['NTF_LED_BRIGHT'] }
      },
      {
        label: 'An RC channel with RCx_OPTION = 300 (scripting)',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/leds_on_a_switch.lua`,
    license: GPL
  },
  {
    id: 'runcam-on-arm',
    name: 'RunCam record on arm',
    filename: 'runcam_on_arm.lua',
    category: 'Camera',
    summary: 'Start and stop RunCam recording automatically on arm / disarm.',
    description:
      'Simulates the RunCam control button (aux function 78) on arm and disarm, so recording follows the ' +
      'flight without a dedicated RC channel. Uses CAM_RC_BTN_DELAY to pace the button presses.',
    prerequisites: [
      {
        label: 'Camera / RunCam configured (CAM_RC_BTN_DELAY present)',
        detail: 'Set up a RunCam on a serial port and enable the RC camera-control parameters.',
        test: { kind: 'paramPresent', anyOf: ['CAM_RC_BTN_DELAY'] }
      }
    ],
    source: `${UPSTREAM}/runcam_on_arm.lua`,
    license: GPL
  },
  {
    id: 'batt-estimate',
    name: 'Battery state-of-charge estimator',
    filename: 'BattEstimate.lua',
    category: 'Battery',
    summary: 'Estimate remaining battery capacity from resting voltage.',
    description:
      'Adds a resting-voltage state-of-charge estimator (BATT_SOC_* parameters). Fit the coefficients from a ' +
      'flight log with Tools/scripts/battery_fit.py, then set BATT_SOC_COUNT to activate it.',
    prerequisites: [
      {
        label: 'A battery monitor enabled (BATT_MONITOR non-zero)',
        test: { kind: 'paramNonZero', anyOf: ['BATT_MONITOR', 'BATT2_MONITOR'] }
      },
      {
        label: 'Fit BATT_SOC_* coefficients from a log before it reports usefully',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/BattEstimate.lua`,
    license: GPL
  },
  {
    id: 'mount-poi',
    name: 'Gimbal point-of-interest',
    filename: 'mount-poi.lua',
    category: 'Gimbal',
    summary: 'Report the lat/lon/alt the camera gimbal is pointing at, using the terrain database.',
    description:
      'On an aux switch (300, or 301 to also lock the gimbal), walks the gimbal pointing vector against the ' +
      'terrain database and prints the ground point-of-interest location to the GCS messages tab.',
    prerequisites: [
      {
        label: 'A camera mount / gimbal configured (MNT1_TYPE non-zero)',
        test: { kind: 'paramNonZero', anyOf: ['MNT1_TYPE', 'MNT2_TYPE'] }
      },
      {
        label: 'Terrain database enabled (TERRAIN_ENABLE = 1)',
        test: { kind: 'paramNonZero', anyOf: ['TERRAIN_ENABLE'] }
      },
      {
        label: 'An RC channel with RCx_OPTION = 300 or 301',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/mount-poi.lua`,
    license: GPL
  },
  {
    id: 'winch-control',
    name: 'Winch control on a switch',
    filename: 'winch-control.lua',
    category: 'Winch',
    summary: 'Deploy / retract a winch at a fixed rate from a 3-position RC switch.',
    description:
      'Maps a 3-position RC switch (aux function 300) to a fixed-rate winch deploy / retract / stop, using ' +
      'WINCH_RATE_UP and WINCH_RATE_DN. Mission Planner’s aux-function screen works in place of a physical switch.',
    prerequisites: [
      {
        label: 'A winch configured (WINCH_TYPE non-zero)',
        test: { kind: 'paramNonZero', anyOf: ['WINCH_TYPE'] }
      },
      {
        label: 'An RC channel with RCx_OPTION = 300 (scripting)',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/winch-control.lua`,
    license: GPL
  },
  {
    id: 'script-controller',
    name: 'Script-set selector',
    filename: 'Script_Controller.lua',
    category: 'Scripting',
    summary: 'Swap between sets of scripts in /1, /2, /3 subfolders using an RC switch.',
    description:
      'Selects which set of scripts (and mission) is active from /APM/scripts/1, /2, /3 subfolders using an aux ' +
      'switch (SCR_USER6 channel, default aux function 302), then reboots to apply. Advanced — for multi-config craft.',
    prerequisites: [
      {
        label: 'Create /APM/scripts/1, /2, /3 subfolders with scripts + mission.txt in each',
        test: { kind: 'info' }
      },
      {
        label: 'Set SCR_USER6 to the selector RC channel, or use aux function 302',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/Script_Controller.lua`,
    license: GPL
  },
  {
    id: 'deadreckon-home',
    name: 'Dead-reckon home on GPS loss',
    filename: 'copter-deadreckon-home.lua',
    category: 'Safety',
    summary: 'Fly toward home by dead reckoning if GPS quality drops or an EKF failsafe triggers.',
    description:
      'A safety net for Copter 4.3+: on low GPS quality or an EKF failsafe the vehicle switches to Guided_NoGPS and ' +
      'leans in the last known direction of home, then recovers to DR_NEXT_MODE (default RTL) once GPS/EKF returns. ' +
      'Adds DR_* parameters (DR_ENABLE, DR_ENABLE_DIST, DR_GPS_SAT_MIN, DR_FLY_ANGLE, DR_NEXT_MODE, …). Needs a ' +
      'roomy heap — set SCR_HEAP_SIZE to 80000 or higher.',
    prerequisites: [
      {
        label: 'A GPS is fitted and configured (GPS_TYPE non-zero)',
        test: { kind: 'paramNonZero', anyOf: ['GPS_TYPE', 'GPS1_TYPE'] }
      },
      {
        label: 'Set SCR_HEAP_SIZE to at least 80000 for this script',
        test: { kind: 'info' }
      },
      {
        label: 'Set DR_ENABLE = 1 after install (added by the script) and reboot',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/copter-deadreckon-home.lua`,
    license: GPL
  },
  {
    id: 'terrain-brake',
    name: 'Terrain brake (Loiter)',
    filename: 'copter_terrain_brake.lua',
    category: 'Safety',
    summary: 'Switch to BRAKE if you break a terrain-altitude floor while in Loiter over steep ground.',
    description:
      'An emergency terrain-impact guard for Copter flown in Loiter over steep terrain: when the height above ground ' +
      '(from the terrain database) drops below TERR_BRK_ALT the script switches to BRAKE. Adds TERR_BRK_* parameters ' +
      '(ENABLE, ALT, HDIST, SPD). Requires the onboard terrain system with terrain data preloaded or streamed from the GCS.',
    prerequisites: [
      {
        label: 'Terrain database enabled (TERRAIN_ENABLE = 1)',
        test: { kind: 'paramNonZero', anyOf: ['TERRAIN_ENABLE'] }
      },
      {
        label: 'Terrain data preloaded or available from the GCS',
        detail: 'See terrain.ardupilot.org, or keep a GCS terrain link up.',
        test: { kind: 'info' }
      },
      {
        label: 'Set TERR_BRK_ENABLE = 1 after install and reboot',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/copter_terrain_brake.lua`,
    license: GPL
  },
  {
    id: 'revert-param',
    name: 'Revert params from a switch',
    filename: 'revert_param.lua',
    category: 'Tuning',
    summary: 'Instantly revert parameters to their startup values from an RC switch while tuning in flight.',
    description:
      'A tuning safety net: flip an aux switch to snap all changed parameters back to the values they had at boot, ' +
      'so a bad in-flight tuning change is one switch away from undone. Adds PREV_* parameters; the trigger aux ' +
      'function defaults to 300 (PREV_RC_FUNC).',
    prerequisites: [
      {
        label: 'An RC channel with RCx_OPTION = 300 (or set PREV_RC_FUNC) to trigger the revert',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/revert_param.lua`,
    license: GPL
  },
  {
    id: 'motor-failure-test',
    name: 'Motor-failure test',
    filename: 'motor_failure_test.lua',
    category: 'Testing',
    summary: 'Stop selected motors in flight from a switch to test motor-failure handling.',
    description:
      'A bench/flight test aid: set MOT_STOP_BITMASK to choose which motors to cut, then flip an aux switch to stop ' +
      'them (they are driven to MOT_PWM_MIN) so you can validate how the airframe copes with a lost motor. Use with ' +
      'extreme care — this deliberately fails motors.',
    prerequisites: [
      {
        label: 'Motor PWM range configured (MOT_PWM_MIN present)',
        test: { kind: 'paramPresent', anyOf: ['MOT_PWM_MIN', 'Q_M_PWM_MIN'] }
      },
      {
        label: 'An RC channel with RCx_OPTION = 300 (scripting) to trigger the cut',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/motor_failure_test.lua`,
    license: GPL
  },
  {
    id: 'advance-wp',
    name: 'Advance waypoint on a switch',
    filename: 'advance-wp.lua',
    category: 'Navigation',
    summary: 'Skip to the next mission waypoint from an RC switch (wraps after the last).',
    description:
      'Advances the active mission to the next waypoint when an aux switch is flipped (wrapping back to WP1 after the ' +
      'last), handy for stepping through a mission. Adds WAYPT_* parameters; optionally announces the current ' +
      'waypoint bearing/distance and can drive the buzzer as you close on the target.',
    prerequisites: [
      {
        label: 'Set WAYPT_ADVANCE to an aux function (e.g. 300) and an RCx_OPTION to match',
        test: { kind: 'info' }
      }
    ],
    source: `${UPSTREAM}/advance-wp.lua`,
    license: GPL
  }
]

function prereqSatisfied(test: LuaPrereqTest, byId: Map<string, number>): boolean {
  switch (test.kind) {
    case 'info':
      return true
    case 'paramPresent':
      return test.anyOf.some((id) => byId.has(id))
    case 'paramNonZero':
      return test.anyOf.some((id) => byId.has(id) && (byId.get(id) as number) !== 0)
    case 'serialProtocol': {
      for (const [id, value] of byId) {
        if (/^SERIAL\d+_PROTOCOL$/.test(id) && value === test.protocol) {
          return true
        }
      }
      return false
    }
  }
}

export interface LuaAppletSanity {
  /** Documented prerequisites that are not currently satisfied (warnings only). */
  unmet: { label: string; detail?: string }[]
  hasWarnings: boolean
}

export function evaluateAppletSanity(applet: LuaAppletMeta, params: ParamInput): LuaAppletSanity {
  const byId = toMap(params)
  const unmet = applet.prerequisites
    .filter((prereq) => prereq.test.kind !== 'info' && !prereqSatisfied(prereq.test, byId))
    .map((prereq) => ({ label: prereq.label, detail: prereq.detail }))
  return { unmet, hasWarnings: unmet.length > 0 }
}

export interface LuaScriptCard {
  meta: LuaAppletMeta
  sanity: LuaAppletSanity
  /** A file of this name already exists in the scripts directory. */
  installed: boolean
}

export interface LuaScriptsViewModel {
  capability: ScriptingCapabilityResult
  cards: LuaScriptCard[]
}

export function buildLuaScriptsViewModel(input: {
  params: ParamInput
  installedNames: readonly string[]
}): LuaScriptsViewModel {
  const installedLower = new Set(input.installedNames.map((name) => name.toLowerCase()))
  return {
    capability: evaluateScriptingCapability(input.params),
    cards: LUA_APPLET_CATALOG.map((meta) => ({
      meta,
      sanity: evaluateAppletSanity(meta, input.params),
      installed: installedLower.has(meta.filename.toLowerCase())
    }))
  }
}

/** Validate a user-supplied file before upload. Returns an error string or null. */
export function validateLuaUpload(name: string, sizeBytes: number): string | null {
  if (!/\.lua$/i.test(name)) {
    return 'Only .lua files can be uploaded to the scripts directory.'
  }
  if (sizeBytes === 0) {
    return 'That file is empty.'
  }
  if (sizeBytes > LUA_MAX_SCRIPT_BYTES) {
    return `That file is ${(sizeBytes / 1024).toFixed(0)} KiB — far larger than any ArduPilot script. Wrong file?`
  }
  return null
}
