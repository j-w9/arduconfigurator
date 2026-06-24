import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARDUPLANE_FLIGHT_MODE_LABELS,
  BOARD_CATALOG,
  arducopterMetadata,
  arducopterFlightModeLabel,
  arduplaneFlightModeLabel,
  arduplaneMetadata,
  arduroverMetadata,
  ardusubMetadata,
  findBoardCatalogEntry,
  formatArducopterNotificationLedBrightness,
  formatArducopterOsdType,
  formatArducopterLogBackend,
  formatArducopterServoFunction,
  arducopterSerialBaudRate,
  encodeArducopterSerialBaud,
  arducopterSerialProtocolOptions,
  ARDUCOPTER_SERIAL_PROTOCOL_LABELS,
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  formatArducopterVtxEnable,
  formatArduplaneFlightMode,
  formatArduplaneLongFailsafeAction,
  formatArduplaneShortFailsafeAction,
  ARDUROVER_FLIGHT_MODE_LABELS,
  arduroverFlightModeLabel,
  formatArduroverFlightMode,
  ARDUSUB_FLIGHT_MODE_LABELS,
  ardusubFlightModeLabel,
  formatArdusubFlightMode,
  normalizeFirmwareMetadata
} from '../packages/param-metadata/dist/index.js'

test('metadata catalog exposes VTX parameters on the dedicated VTX surface', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  const vtxEnable = metadata.parameters.VTX_ENABLE
  const vtxFrequency = metadata.parameters.VTX_FREQ
  const vtxPower = metadata.parameters.VTX_POWER
  const vtxMaxPower = metadata.parameters.VTX_MAX_POWER
  const vtxOptions = metadata.parameters.VTX_OPTIONS

  assert.equal(vtxEnable.categoryDefinition.id, 'vtx')
  assert.equal(vtxEnable.categoryDefinition.viewId, 'vtx')
  assert.equal(vtxEnable.options.length, 2)
  assert.equal(vtxFrequency.unit, 'MHz')
  assert.equal(vtxPower.unit, 'mW')
  assert.equal(vtxMaxPower.unit, 'mW')
  assert.equal(vtxOptions.categoryDefinition.viewId, 'vtx')
})

test('metadata catalog exposes OSD and notification parameters on product surfaces', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  assert.equal(metadata.parameters.OSD_TYPE.categoryDefinition.viewId, 'osd')
  assert.equal(metadata.parameters.OSD_CHAN.categoryDefinition.viewId, 'osd')
  assert.equal(metadata.parameters.MSP_OPTIONS.categoryDefinition.viewId, 'osd')
  assert.equal(metadata.parameters.MSP_OSD_NCELLS.options.length, 15)

  assert.equal(metadata.parameters.NTF_LED_TYPES.categoryDefinition.viewId, 'motors')
  assert.equal(metadata.parameters.NTF_LED_LEN.categoryDefinition.viewId, 'motors')
  assert.equal(metadata.parameters.NTF_LED_BRIGHT.options.length, 4)
  assert.equal(metadata.parameters.NTF_BUZZ_TYPES.categoryDefinition.viewId, 'motors')
  assert.equal(metadata.parameters.NTF_BUZZ_VOLUME.unit, '%')
})

test('metadata catalog exposes serial options and dedicated FPV app views', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  assert.ok(metadata.appViews.some((view) => view.id === 'vtx'))
  assert.ok(metadata.appViews.some((view) => view.id === 'osd'))
  assert.equal(metadata.parameters.SERIAL1_OPTIONS.categoryDefinition.viewId, 'ports')
  assert.ok(metadata.parameters.SERIAL1_OPTIONS.options.length > 0)
})

test('board catalog covers the expanded hardware-aware Ports targets', () => {
  assert.ok(BOARD_CATALOG.length >= 5)
  assert.equal(findBoardCatalogEntry(53)?.label, 'Pixhawk 6X')
  assert.equal(findBoardCatalogEntry(57)?.label, 'ARKV6X')
  assert.equal(findBoardCatalogEntry(59)?.label, 'ARK FPV')
  assert.equal(findBoardCatalogEntry(1013)?.label, 'Matek H743')
  assert.equal(findBoardCatalogEntry(7000)?.label, 'CUAV-7-Nano')
  // BrainFPV Radix 2 HD — confirmed via AUTOPILOT_VERSION.boardVersion >> 16
  // on a live FC ("RADIX2HD" in the boot banner). Added during the real-FC
  // audit so the Ports tab identifies the board on connect.
  assert.equal(findBoardCatalogEntry(1118)?.label, 'BrainFPV Radix 2 HD')
  assert.equal(findBoardCatalogEntry(1118)?.manufacturerName, 'BrainFPV')
})

test('metadata catalog exposes advanced setup, receiver, and failsafe parameters on product surfaces', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  assert.equal(metadata.parameters.COMPASS_USE2.categoryDefinition.viewId, 'setup')
  assert.equal(metadata.parameters.COMPASS_USE3.categoryDefinition.viewId, 'setup')

  assert.equal(metadata.parameters.RC_SPEED.categoryDefinition.viewId, 'receiver')
  assert.equal(metadata.parameters.RC_OPTIONS.categoryDefinition.viewId, 'receiver')
  assert.equal(metadata.parameters.RC_SPEED.unit, 'Hz')

  assert.equal(metadata.parameters.DISARM_DELAY.categoryDefinition.viewId, 'power')
  // BATT_LOW_TIMER / RC_FS_TIMEOUT / FS_OPTIONS used to flow through the
  // Power tab via category 'failsafe' (viewId: 'power'). They now route to
  // the Failsafe tab so the operator has one place to think about
  // loss-of-link behavior.
  assert.equal(metadata.parameters.BATT_LOW_TIMER.categoryDefinition.viewId, 'failsafe')
  assert.equal(metadata.parameters.RC_FS_TIMEOUT.categoryDefinition.viewId, 'failsafe')
  assert.equal(metadata.parameters.FS_OPTIONS.categoryDefinition.viewId, 'failsafe')
})

test('ArduCopter exposes a Gimbal / Mount config category backed by the MNT1 params', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)
  const gimbal = metadata.parameters.MNT1_TYPE
  assert.ok(gimbal, 'MNT1_TYPE should be curated')
  assert.equal(gimbal.categoryDefinition.id, 'gimbal')
  assert.equal(gimbal.categoryDefinition.label, 'Gimbal / Mount')
  // Routed into the Outputs (Motors) additional-settings surface.
  assert.equal(gimbal.categoryDefinition.viewId, 'motors')
  // Pin the value->label mapping against AP_Mount source (8 = Siyi, not BrushlessPWM).
  assert.ok(gimbal.options.some((option) => option.value === 8 && option.label === 'Siyi'))
  // Per-axis angle limits + control mode round out the section.
  for (const id of ['MNT1_DEFLT_MODE', 'MNT1_RC_RATE', 'MNT1_PITCH_MIN', 'MNT1_PITCH_MAX', 'MNT1_YAW_MIN', 'MNT1_YAW_MAX']) {
    assert.equal(metadata.parameters[id]?.categoryDefinition.id, 'gimbal', `${id} should be in the gimbal category`)
  }
})

test('every vehicle bundle exposes the gimbal MNT1/MNT2 family with source-correct ranges', () => {
  const bundles = {
    ArduCopter: arducopterMetadata,
    ArduPlane: arduplaneMetadata,
    ArduRover: arduroverMetadata,
    ArduSub: ardusubMetadata
  }
  for (const [vehicle, bundle] of Object.entries(bundles)) {
    const metadata = normalizeFirmwareMetadata(bundle)
    // Both mounts present, in the gimbal category.
    assert.equal(metadata.parameters.MNT1_TYPE?.categoryDefinition.id, 'gimbal', `${vehicle} MNT1_TYPE`)
    assert.equal(metadata.parameters.MNT2_TYPE?.categoryDefinition.id, 'gimbal', `${vehicle} MNT2_TYPE`)
    // Deepened params: retract/neutral angles + the options bitmask.
    assert.ok(metadata.parameters.MNT1_RETRACT_X, `${vehicle} MNT1_RETRACT_X`)
    assert.ok(metadata.parameters.MNT1_NEUTRAL_Z, `${vehicle} MNT1_NEUTRAL_Z`)
    assert.equal(metadata.parameters.MNT1_OPTIONS?.bitmask, true, `${vehicle} MNT1_OPTIONS is a bitmask`)
    // Pitch range is -90..90 per AP_Mount source (roll/yaw are -180..180).
    assert.equal(metadata.parameters.MNT1_PITCH_MIN?.minimum, -90, `${vehicle} pitch min range`)
    assert.equal(metadata.parameters.MNT1_PITCH_MAX?.maximum, 90, `${vehicle} pitch max range`)
    assert.equal(metadata.parameters.MNT1_ROLL_MIN?.minimum, -180, `${vehicle} roll min range`)
  }
})

test('every vehicle bundle exposes the rangefinder/lidar RNGFND1 family', () => {
  const bundles = {
    ArduCopter: arducopterMetadata,
    ArduPlane: arduplaneMetadata,
    ArduRover: arduroverMetadata,
    ArduSub: ardusubMetadata
  }
  for (const [vehicle, bundle] of Object.entries(bundles)) {
    const metadata = normalizeFirmwareMetadata(bundle)
    const type = metadata.parameters.RNGFND1_TYPE
    assert.ok(type, `${vehicle} RNGFND1_TYPE`)
    assert.equal(type.categoryDefinition.id, 'rangefinder', `${vehicle} rangefinder category`)
    assert.equal(type.categoryDefinition.viewId, 'motors', `${vehicle} rangefinder routes to Outputs`)
    // Value->label mapping pinned against AP_RangeFinder source.
    assert.ok(type.options.some((option) => option.value === 10 && option.label === 'MAVLink'))
    // Orientation enum (Down = 25 for terrain/altitude) + core config params.
    assert.ok(metadata.parameters.RNGFND1_ORIENT?.options.some((option) => option.value === 25 && option.label === 'Down'))
    for (const id of ['RNGFND1_MIN', 'RNGFND1_MAX', 'RNGFND1_GNDCLR', 'RNGFND1_ADDR', 'RNGFND1_POS_X']) {
      assert.equal(metadata.parameters[id]?.categoryDefinition.id, 'rangefinder', `${vehicle} ${id}`)
    }
  }
})

test('VTX enable formatting stays user-facing', () => {
  assert.equal(formatArducopterVtxEnable(0), 'Disabled')
  assert.equal(formatArducopterVtxEnable(1), 'Enabled')
  assert.equal(formatArducopterVtxEnable(undefined), 'Unknown')
})

test('OSD and notification formatting stays user-facing', () => {
  assert.equal(formatArducopterOsdType(5), 'MSP DisplayPort')
  assert.equal(formatArducopterNotificationLedBrightness(2), 'Medium')
})

test('ArduPlane flight-mode labels resolve common Plane and QuadPlane modes', () => {
  // Core Plane fixed-wing modes
  assert.equal(arduplaneFlightModeLabel(0), 'Manual')
  assert.equal(arduplaneFlightModeLabel(5), 'FBWA')
  assert.equal(arduplaneFlightModeLabel(10), 'Auto')
  assert.equal(arduplaneFlightModeLabel(11), 'RTL')

  // QuadPlane modes (the 17-23 range)
  assert.equal(arduplaneFlightModeLabel(17), 'QStabilize')
  assert.equal(arduplaneFlightModeLabel(20), 'QLand')

  // Newer modes (ArduPlane/mode.h enum Mode::Number)
  assert.equal(arduplaneFlightModeLabel(24), 'Thermal')
  assert.equal(arduplaneFlightModeLabel(25), 'Loiter alt to QLand')
  assert.equal(arduplaneFlightModeLabel(26), 'Autoland') // mode 26 AUTOLAND

  // Unknown mode falls through to the numbered placeholder
  assert.equal(formatArduplaneFlightMode(99), 'Mode 99')
  assert.equal(formatArduplaneFlightMode(undefined), 'Unknown')

  // The label table itself exposes the expected size for the current Plane build
  assert.equal(Object.keys(ARDUPLANE_FLIGHT_MODE_LABELS).length, 26)
})

test('ArduRover flight-mode labels resolve Rover/Boat modes', () => {
  assert.equal(arduroverFlightModeLabel(0), 'Manual')
  assert.equal(arduroverFlightModeLabel(3), 'Steering')
  assert.equal(arduroverFlightModeLabel(4), 'Hold')
  assert.equal(arduroverFlightModeLabel(10), 'Auto')
  assert.equal(arduroverFlightModeLabel(11), 'RTL')
  assert.equal(arduroverFlightModeLabel(12), 'SmartRTL')
  // Rover mode 4 is Hold; the Copter table would have called it 'Guided' —
  // proves the dispatch is genuinely Rover-specific, not Copter fallback.
  assert.notEqual(arduroverFlightModeLabel(4), 'Guided')
  assert.equal(arduroverFlightModeLabel(8), 'Dock')
  assert.equal(arduroverFlightModeLabel(15), 'Guided')
  // Rover/mode.h enum Mode::Number leaves 2, 13 and 14 unassigned (no mode).
  assert.equal(arduroverFlightModeLabel(2), undefined)
  assert.equal(arduroverFlightModeLabel(13), undefined)
  assert.equal(arduroverFlightModeLabel(14), undefined)
  assert.equal(formatArduroverFlightMode(99), 'Mode 99')
  assert.equal(formatArduroverFlightMode(undefined), 'Unknown')
  assert.equal(Object.keys(ARDUROVER_FLIGHT_MODE_LABELS).length, 14)
})

test('ArduSub flight-mode labels resolve Sub modes', () => {
  assert.equal(ardusubFlightModeLabel(0), 'Stabilize')
  assert.equal(ardusubFlightModeLabel(2), 'Alt Hold')
  assert.equal(ardusubFlightModeLabel(9), 'Surface')
  assert.equal(ardusubFlightModeLabel(19), 'Manual')
  assert.equal(ardusubFlightModeLabel(20), 'Motor Detect')
  // Sub mode 19 is Manual; Copter mode 19 does not exist / differs —
  // proves Sub-specific dispatch.
  assert.equal(formatArdusubFlightMode(19), 'Manual')
  // ArduSub/mode.h enum Mode::Number adds 21 SURFTRAK; 5,6,8,10-15,17-18 unused.
  assert.equal(ardusubFlightModeLabel(21), 'Surftrak')
  assert.equal(ardusubFlightModeLabel(5), undefined)
  assert.equal(ardusubFlightModeLabel(17), undefined)
  assert.equal(formatArdusubFlightMode(99), 'Mode 99')
  assert.equal(formatArdusubFlightMode(undefined), 'Unknown')
  assert.equal(Object.keys(ARDUSUB_FLIGHT_MODE_LABELS).length, 11)
})

test('metadata catalog exposes per-element OSD layout parameters on the OSD surface', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  const batEnable = metadata.parameters.OSD1_BAT_VOLT_EN
  assert.equal(batEnable.categoryDefinition.viewId, 'osd')
  assert.equal(batEnable.options.length, 2)
  assert.equal(batEnable.options[0].label, 'Disabled')
  assert.equal(batEnable.options[1].label, 'Enabled')

  // X/Y bounds match ArduPilot upstream (0-59 X, 0-21 Y) so HD backends
  // (50x18 / 60x22 grids) can address every cell — previously hard-capped
  // to the 30x16 PAL grid, which rejected legitimate HD positions.
  assert.equal(metadata.parameters.OSD1_RSSI_X.minimum, 0)
  assert.equal(metadata.parameters.OSD1_RSSI_X.maximum, 59)
  assert.equal(metadata.parameters.OSD1_RSSI_Y.minimum, 0)
  assert.equal(metadata.parameters.OSD1_RSSI_Y.maximum, 21)

  const expectedElements = [
    'BAT_VOLT',
    'RSSI',
    'ALTITUDE',
    'THROTTLE',
    'CURRENT',
    'HEADING',
    'GSPEED',
    'HOME',
    'HORIZON',
    'FLTMODE'
  ]
  for (const screen of [1, 2, 3, 4]) {
    for (const element of expectedElements) {
      for (const suffix of ['EN', 'X', 'Y']) {
        const id = `OSD${screen}_${element}_${suffix}`
        const entry = metadata.parameters[id]
        assert.ok(entry, `expected ${id} in catalog`)
        assert.equal(entry.categoryDefinition.viewId, 'osd')
      }
    }
  }

  // Spot-check a screen-2 entry and a newly added element label
  assert.equal(metadata.parameters.OSD2_HEADING_X.maximum, 59)
  assert.equal(metadata.parameters.OSD3_HORIZON_EN.options.length, 2)
  assert.equal(metadata.parameters.OSD1_HEADING_EN.label, 'OSD1 Heading Enabled')
})

test('metadata catalog exposes onboard logging parameters under a dedicated logging category', () => {
  const metadata = normalizeFirmwareMetadata(arducopterMetadata)

  const backend = metadata.parameters.LOG_BACKEND_TYPE
  assert.equal(backend.categoryDefinition.id, 'logging')
  assert.equal(backend.categoryDefinition.viewId, 'parameters')
  assert.equal(backend.options.length, 5)
  assert.equal(backend.options[0].label, 'None')
  assert.equal(backend.options[4].label, 'Block')
  assert.equal(backend.rebootRequired, true)

  // The MB-free retention knob carries a unit and a non-trivial upper bound
  assert.equal(metadata.parameters.LOG_FILE_MB_FREE.unit, 'MB')
  assert.ok(metadata.parameters.LOG_FILE_MB_FREE.maximum >= 1024)

  // The boolean LOG_* knobs reuse the shared Disabled/Enabled option pair
  for (const id of ['LOG_FILE_DSRMROT', 'LOG_REPLAY', 'LOG_DISARMED']) {
    const entry = metadata.parameters[id]
    assert.equal(entry.categoryDefinition.id, 'logging')
    assert.equal(entry.options.length, 2)
    assert.equal(entry.options[0].label, 'Disabled')
    assert.equal(entry.options[1].label, 'Enabled')
  }
})

test('Log-backend formatting stays user-facing', () => {
  assert.equal(formatArducopterLogBackend(0), 'None')
  assert.equal(formatArducopterLogBackend(3), 'File + MAVLink')
  assert.equal(formatArducopterLogBackend(undefined), 'Unknown')
  assert.equal(formatArducopterLogBackend(99), 'Backend 99')
})

test('arduplaneMetadata normalizes without throwing and exposes the Plane catalog firmware tag', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)
  assert.equal(metadata.firmware, 'ArduPlane')
  assert.ok(metadata.appViews.length >= 14)
  assert.ok(metadata.categories.some((category) => category.id === 'airframe'))
  assert.ok(metadata.categories.some((category) => category.id === 'failsafe'))
})

test('arducopter exposes the ESC & DShot params with sane bitmask/range metadata', () => {
  const p = normalizeFirmwareMetadata(arducopterMetadata).parameters
  // bitmask masks: per-output (8 outputs => max 255), rendered as checkboxes.
  for (const id of ['SERVO_BLH_BDMASK', 'SERVO_BLH_RVMASK']) {
    assert.equal(p[id].bitmask, true, `${id} should be a bitmask`)
    assert.ok(Array.isArray(p[id].options) && p[id].options.length === 8, `${id} should expose 8 output bits`)
    assert.equal(p[id].maximum, 255)
  }
  // enums.
  assert.ok(p.SERVO_DSHOT_RATE.options.length > 0)
  assert.ok(p.SERVO_BLH_AUTO.options.length >= 2)
  // poles: plain number, ArduPilot default 14 lives within the range.
  assert.ok(p.SERVO_BLH_POLES.minimum <= 14 && p.SERVO_BLH_POLES.maximum >= 14)
  assert.ok(!p.SERVO_BLH_POLES.bitmask)
})

test('arducopter ARMING_CHECK and FS_OPTIONS are bitmasks with bit options', () => {
  const p = normalizeFirmwareMetadata(arducopterMetadata).parameters
  for (const id of ['ARMING_CHECK', 'FS_OPTIONS', 'RC_OPTIONS']) {
    assert.equal(p[id].bitmask, true, `${id} should be a bitmask`)
    assert.ok(Array.isArray(p[id].options) && p[id].options.length > 0, `${id} should expose bit options`)
    // Bit options are bit-index values (0..N), each with a label.
    for (const opt of p[id].options) {
      assert.equal(typeof opt.value, 'number')
      assert.ok(opt.value >= 0 && opt.value < 32)
      assert.ok(typeof opt.label === 'string' && opt.label.length > 0)
    }
  }
})

test('arduplane RC_OPTIONS renders as a bitmask (not a raw number) like ArduCopter', () => {
  const plane = normalizeFirmwareMetadata(arduplaneMetadata).parameters.RC_OPTIONS
  assert.equal(plane.bitmask, true)
  assert.ok(Array.isArray(plane.options) && plane.options.length > 0)
  // Shares the ArduPilot RC_Channels Options bit set with ArduCopter.
  const copter = normalizeFirmwareMetadata(arducopterMetadata).parameters.RC_OPTIONS
  assert.equal(plane.options.length, copter.options.length)
})

test('arduplane AUTOTUNE_AXES renders as a fixed-wing bitmask (Roll/Pitch/Yaw), not a raw number', () => {
  // A real fixed-wing ArduPlane streams AUTOTUNE_AXES (default 7 = Roll|Pitch|
  // Yaw); ArduPlane/Parameters.cpp @Bitmask: 0:Roll,1:Pitch,2:Yaw. The Plane
  // catalog only had AUTOTUNE_LEVEL/OPTIONS and the QuadPlane Q_AUTOTUNE_AXES,
  // so fixed-wing AUTOTUNE_AXES used to fall through to a raw numeric field.
  const axes = normalizeFirmwareMetadata(arduplaneMetadata).parameters.AUTOTUNE_AXES
  assert.equal(axes.bitmask, true)
  assert.deepEqual(
    axes.options.map((option) => option.label),
    ['Roll', 'Pitch', 'Yaw']
  )
  // Fixed-wing AUTOTUNE_AXES has no YawD bit, unlike the QuadPlane VTOL set.
  assert.ok(!axes.options.some((option) => option.label === 'YawD'))
})

test('arduroverMetadata normalizes and exposes a real Rover catalog (not a Copter clone)', () => {
  const metadata = normalizeFirmwareMetadata(arduroverMetadata)
  assert.equal(metadata.firmware, 'ArduRover')
  assert.ok(metadata.appViews.length >= 14)
  assert.ok(metadata.categories.some((category) => category.id === 'steering'))
  assert.ok(metadata.categories.some((category) => category.id === 'drive'))

  // Rover mode family uses MODE_CH/MODE1 (not Copter FLTMODE_*), with the
  // real Rover mode enum (Steering is a Rover-only label).
  assert.ok(metadata.parameters.MODE_CH, 'Rover exposes MODE_CH')
  assert.ok(metadata.parameters.MODE1.options.some((option) => option.label === 'Steering'))
  assert.ok(!metadata.parameters.FLTMODE_CH, 'Rover must not carry Copter FLTMODE_CH')
  assert.ok(!metadata.parameters.ATC_INPUT_TC, 'Rover must not carry the Copter ATC_INPUT_TC')
  // Rover carries its own FRAME_CLASS (Rover/Boat/BalanceBot) for the starter presets.
  assert.ok(metadata.parameters.FRAME_CLASS, 'Rover exposes its own FRAME_CLASS')
  assert.ok(metadata.parameters.FRAME_CLASS.options.some((option) => option.label === 'Boat'))

  // Rover-specific control surface is present and categorised for Tuning.
  assert.equal(metadata.parameters.ATC_STR_RAT_P.categoryDefinition.id, 'steering')
  assert.equal(metadata.parameters.ATC_STR_RAT_P.categoryDefinition.viewId, 'tuning')
  assert.ok(metadata.parameters.CRUISE_SPEED)
  assert.ok(metadata.parameters.FS_ACTION)

  // Rover setup flow (raw bundle — setupSections is not part of the
  // normalized shape) drops the Copter airframe step and adds a drive step.
  const sectionIds = arduroverMetadata.setupSections.map((section) => section.id)
  assert.ok(sectionIds.includes('drive'))
  assert.ok(sectionIds.includes('failsafe'))
  assert.ok(!sectionIds.includes('airframe'))
})

test('arduroverMetadata exposes the deepened steering/speed controller catalog (Phase 4 Rover slice 1)', () => {
  const metadata = normalizeFirmwareMetadata(arduroverMetadata)

  // Steering-rate AC_PID filter/slew + accel limits join the existing
  // steering category — first-cut catalog only had P/I/D/FF/IMAX/MAX.
  for (const id of [
    'ATC_STR_RAT_FLTT', 'ATC_STR_RAT_FLTE', 'ATC_STR_RAT_FLTD',
    'ATC_STR_RAT_SMAX', 'ATC_STR_ACC_MAX', 'ATC_STR_DEC_MAX'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Rover catalog`)
    assert.equal(entry.categoryDefinition.id, 'steering')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Speed/throttle FF + filter/slew + the speed envelope join the speed
  // category.
  for (const id of [
    'ATC_SPEED_FF', 'ATC_SPEED_FLTT', 'ATC_SPEED_FLTE', 'ATC_SPEED_FLTD',
    'ATC_SPEED_SMAX', 'ATC_STOP_SPEED', 'SPEED_MAX'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Rover catalog`)
    assert.equal(entry.categoryDefinition.id, 'speed')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced editor bounds (verbatim from AR_AttitudeControl.cpp / Rover
  // Parameters.cpp).
  assert.equal(metadata.parameters.ATC_STR_RAT_FLTT.maximum, 100)
  assert.equal(metadata.parameters.ATC_STR_RAT_SMAX.maximum, 200)
  assert.equal(metadata.parameters.ATC_STOP_SPEED.maximum, 0.5)
  assert.equal(metadata.parameters.SPEED_MAX.maximum, 30)
})

test('arduroverMetadata exposes the deepened navigation catalog (Phase 4 Rover slice 2)', () => {
  const metadata = normalizeFirmwareMetadata(arduroverMetadata)

  // L1 damping/crosstrack + WP accel/jerk + the modern turn-accel limit
  // join the existing navigation category — the first cut only had
  // NAVL1_PERIOD / WP_SPEED / WP_RADIUS / TURN_RADIUS.
  for (const id of ['NAVL1_DAMPING', 'NAVL1_XTRACK_I', 'WP_ACCEL', 'WP_JERK', 'ATC_TURN_MAX_G']) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Rover catalog`)
    assert.equal(entry.categoryDefinition.id, 'navigation')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds (verbatim from AP_L1_Control.cpp / AR_WPNav.cpp /
  // AR_AttitudeControl.cpp). Legacy TURN_MAX_G stays alongside the modern
  // ATC_TURN_MAX_G so a Rover on either firmware gets a label.
  assert.equal(metadata.parameters.NAVL1_DAMPING.minimum, 0.6)
  assert.equal(metadata.parameters.NAVL1_XTRACK_I.maximum, 0.1)
  assert.equal(metadata.parameters.WP_JERK.maximum, 100)
  assert.equal(metadata.parameters.ATC_TURN_MAX_G.maximum, 10)
  assert.ok(metadata.parameters.TURN_MAX_G, 'legacy TURN_MAX_G retained')
})

test('arduroverMetadata exposes the sailboat + wind-vane catalog (source-verified)', () => {
  const metadata = normalizeFirmwareMetadata(arduroverMetadata)

  // New Sailing / Wind Vane categories surface under the existing Tuning view
  // (no new nav surface).
  assert.ok(metadata.categories.some((category) => category.id === 'sailing'))
  assert.ok(metadata.categories.some((category) => category.id === 'windvane'))

  // SAIL_ family present and categorised for Tuning, with the verbatim
  // sailboat.cpp @Range/@Units.
  for (const id of [
    'SAIL_ENABLE', 'SAIL_ANGLE_MIN', 'SAIL_ANGLE_MAX', 'SAIL_ANGLE_IDEAL',
    'SAIL_HEEL_MAX', 'SAIL_NO_GO_ANGLE', 'SAIL_WNDSPD_MIN', 'SAIL_XTRACK_MAX',
    'SAIL_LOIT_RADIUS'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Rover catalog`)
    assert.equal(entry.categoryDefinition.id, 'sailing')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds verbatim from Rover/sailboat.cpp.
  assert.equal(metadata.parameters.SAIL_ANGLE_MIN.minimum, 0)
  assert.equal(metadata.parameters.SAIL_ANGLE_MIN.maximum, 90)
  assert.equal(metadata.parameters.SAIL_ANGLE_MIN.unit, 'deg')
  assert.equal(metadata.parameters.SAIL_WNDSPD_MIN.maximum, 5)
  assert.equal(metadata.parameters.SAIL_WNDSPD_MIN.unit, 'm/s')
  assert.equal(metadata.parameters.SAIL_XTRACK_MAX.minimum, 5)
  assert.equal(metadata.parameters.SAIL_XTRACK_MAX.maximum, 25)
  assert.equal(metadata.parameters.SAIL_LOIT_RADIUS.maximum, 20)

  // SAIL_ENABLE is an enabled/disabled enum and reboot-required.
  assert.equal(metadata.parameters.SAIL_ENABLE.options.length, 2)
  assert.equal(metadata.parameters.SAIL_ENABLE.rebootRequired, true)

  // Wind-vane TYPE enum resolves its source @Values labels.
  const wndvnType = metadata.parameters.WNDVN_TYPE
  assert.ok(wndvnType, 'expected WNDVN_TYPE in the Rover catalog')
  assert.equal(wndvnType.categoryDefinition.id, 'windvane')
  assert.equal(wndvnType.categoryDefinition.viewId, 'tuning')
  assert.equal(wndvnType.options.find((option) => option.value === 3)?.label, 'Analog')
  assert.equal(wndvnType.options.find((option) => option.value === 4)?.label, 'NMEA')
  assert.equal(wndvnType.options.find((option) => option.value === 11)?.label, 'SITL apparent')

  // Analog direction pin keeps the -1..127 source range and resolves a pin label.
  assert.equal(metadata.parameters.WNDVN_DIR_PIN.minimum, -1)
  assert.equal(metadata.parameters.WNDVN_DIR_PIN.maximum, 127)
  assert.equal(
    metadata.parameters.WNDVN_DIR_PIN.options.find((option) => option.value === 50)?.label,
    'AUX1'
  )

  // Prefix is WNDVN_ (not WNDVNE_) — the common mis-spelling must be absent.
  assert.ok(!metadata.parameters.WNDVNE_TYPE, 'wind vane prefix is WNDVN_, not WNDVNE_')

  // Heel-PID slew limit carries the only source-documented AC_PID range.
  assert.equal(metadata.parameters.ATC_SAIL_SMAX.maximum, 200)
  assert.equal(metadata.parameters.ATC_SAIL_SMAX.categoryDefinition.id, 'sailing')
})

test('ardusubMetadata: the IDs TuningSubSection surfaces are all wired (pilot envelope + joystick gain ladder)', () => {
  // Lock the bundle membership against the apps/web/src/tuning-params.ts
  // TUNING_SUB_PILOT_PARAM_IDS / TUNING_SUB_JOYSTICK_PARAM_IDS lists.
  // Same drift-guard pattern as the analogous Rover sailboat test below
  // — without this, an ID rename in either file is hidden by the empty-
  // guard in TuningSubSection.
  const metadata = normalizeFirmwareMetadata(ardusubMetadata)

  // Mirrors TUNING_SUB_PILOT_PARAM_IDS — the pilot envelope card.
  const pilotIds = [
    'PILOT_SPEED_UP',
    'PILOT_SPEED_DN',
    'PILOT_SPEED',
    'PILOT_ACCEL_Z',
    'PILOT_THR_FILT',
    'SURFACE_DEPTH',
    'SURFACE_MAX_THR'
  ]
  for (const id of pilotIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `TUNING_SUB_PILOT_PARAM_IDS lists ${id} but the bundle does not expose it`)
    assert.equal(entry.categoryDefinition.id, 'pilot', `${id} should land in 'pilot'`)
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Mirrors TUNING_SUB_JOYSTICK_PARAM_IDS — the gain ladder card.
  // Joystick gain params land in the 'joystick' category which lives
  // under the 'receiver' view, NOT 'tuning' — that's deliberate: the
  // bundle classifies them with the rest of the joystick wiring, while
  // the tuning surface borrows the gain subset for an in-place tuning
  // card. We only assert the bundle has them, not their view.
  const joystickIds = [
    'JS_GAIN_DEFAULT',
    'JS_GAIN_MAX',
    'JS_GAIN_MIN',
    'JS_GAIN_STEPS',
    'JS_THR_GAIN',
    'JS_LIGHTS_STEPS'
  ]
  for (const id of joystickIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `TUNING_SUB_JOYSTICK_PARAM_IDS lists ${id} but the bundle does not expose it`)
    assert.equal(entry.categoryDefinition.id, 'joystick', `${id} should land in 'joystick'`)
  }

  // Source-cited bounds (verbatim from ArduSub/Parameters.cpp @Param).
  assert.equal(metadata.parameters.PILOT_SPEED_UP.minimum, 20, 'PILOT_SPEED_UP @Range 20 500')
  assert.equal(metadata.parameters.PILOT_SPEED_UP.maximum, 500)
  assert.equal(metadata.parameters.SURFACE_DEPTH.minimum, -100, 'SURFACE_DEPTH @Range -100 0 (cm, negative below surface)')
  assert.equal(metadata.parameters.SURFACE_DEPTH.maximum, 0)
  assert.equal(metadata.parameters.JS_GAIN_DEFAULT.minimum, 0.1, 'JS_GAIN_DEFAULT @Range 0.1 1.0')
  assert.equal(metadata.parameters.JS_GAIN_DEFAULT.maximum, 1)
  assert.equal(metadata.parameters.JS_GAIN_STEPS.minimum, 1, 'JS_GAIN_STEPS: 1 means "always use DEFAULT"')
})

test('arduroverMetadata: the IDs TuningRoverSection surfaces are all wired (sail trim, heel PID, wind vane)', () => {
  // Lock the bundle membership against the apps/web/src/tuning-params.ts
  // ID lists. Drift between the curated tuning surface and the bundle
  // breaks silently (the empty-guard in TuningRoverSection hides any
  // missing param) — this test surfaces the drift.
  const metadata = normalizeFirmwareMetadata(arduroverMetadata)

  // Mirrors TUNING_ROVER_SAIL_PARAM_IDS.
  const sailIds = [
    'SAIL_ENABLE',
    'SAIL_ANGLE_MIN',
    'SAIL_ANGLE_MAX',
    'SAIL_ANGLE_IDEAL',
    'SAIL_HEEL_MAX',
    'SAIL_NO_GO_ANGLE',
    'SAIL_WNDSPD_MIN',
    'SAIL_XTRACK_MAX',
    'SAIL_LOIT_RADIUS'
  ]
  for (const id of sailIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `TUNING_ROVER_SAIL_PARAM_IDS lists ${id} but the bundle does not expose it`)
    assert.equal(entry.categoryDefinition.id, 'sailing', `${id} should land in 'sailing'`)
  }

  // Mirrors TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS.
  const heelPidIds = [
    'ATC_SAIL_P',
    'ATC_SAIL_I',
    'ATC_SAIL_D',
    'ATC_SAIL_FF',
    'ATC_SAIL_IMAX',
    'ATC_SAIL_FLTT',
    'ATC_SAIL_FLTE',
    'ATC_SAIL_FLTD',
    'ATC_SAIL_SMAX'
  ]
  for (const id of heelPidIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS lists ${id} but the bundle does not expose it`)
    assert.equal(entry.categoryDefinition.id, 'sailing', `${id} should land in 'sailing' (heel PID is nested under sailing)`)
  }

  // Mirrors TUNING_ROVER_WINDVANE_PARAM_IDS — tuning-relevant subset only
  // (pin / voltage wiring is intentionally NOT surfaced in the tuning
  // card, so it is not asserted here).
  const windvaneIds = [
    'WNDVN_TYPE',
    'WNDVN_SPEED_TYPE',
    'WNDVN_DIR_FILT',
    'WNDVN_SPEED_FILT',
    'WNDVN_TRUE_FILT',
    'WNDVN_DIR_OFS',
    'WNDVN_DIR_DZ',
    'WNDVN_SPEED_MIN',
    'WNDVN_CAL'
  ]
  for (const id of windvaneIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `TUNING_ROVER_WINDVANE_PARAM_IDS lists ${id} but the bundle does not expose it`)
    assert.equal(entry.categoryDefinition.id, 'windvane', `${id} should land in 'windvane'`)
  }
})

test('ardusubMetadata normalizes and exposes a real Sub catalog (not a Copter clone)', () => {
  const metadata = normalizeFirmwareMetadata(ardusubMetadata)
  assert.equal(metadata.firmware, 'ArduSub')
  assert.ok(metadata.appViews.length >= 14)
  assert.ok(metadata.categories.some((category) => category.id === 'frame'))
  assert.ok(metadata.categories.some((category) => category.id === 'joystick'))

  // Sub-specific surface present; Copter/Rover keys absent.
  assert.equal(metadata.parameters.FRAME_CONFIG.categoryDefinition.viewId, 'motors')
  assert.ok(metadata.parameters.JS_GAIN_DEFAULT)
  assert.ok(metadata.parameters.SURFACE_DEPTH)
  assert.ok(metadata.parameters.FS_LEAK_ENABLE, 'Sub exposes the safety-critical leak failsafe')
  assert.ok(!metadata.parameters.FRAME_CLASS, 'Sub must not carry Copter FRAME_CLASS')
  assert.ok(!metadata.parameters.MODE_CH, 'Sub must not carry Rover MODE_CH')

  const sectionIds = ardusubMetadata.setupSections.map((section) => section.id)
  assert.ok(sectionIds.includes('frame'))
  assert.ok(sectionIds.includes('failsafe'))
  assert.ok(!sectionIds.includes('airframe'))
})

test('ardusubMetadata exposes the deepened attitude rate-controller catalog (Phase 4 Sub slice 1)', () => {
  const metadata = normalizeFirmwareMetadata(ardusubMetadata)

  // The first-cut Sub attitude category only had ATC_RAT_*_{P,I,D} +
  // ATC_ANG_*_P; a connected Sub's AC_PID feed-forward / integrator
  // clamp / filter / slew terms came back uncatalogued. Sub uses the
  // same AC_AttitudeControl subgroups as Copter, so bounds mirror the
  // already-reviewed arducopter.ts catalog.
  for (const axis of ['RLL', 'PIT', 'YAW']) {
    for (const term of ['FF', 'IMAX', 'FLTT', 'FLTE', 'FLTD', 'SMAX']) {
      const id = `ATC_RAT_${axis}_${term}`
      const entry = metadata.parameters[id]
      assert.ok(entry, `expected ${id} in the Sub catalog`)
      assert.equal(entry.categoryDefinition.id, 'attitude')
      assert.equal(entry.categoryDefinition.viewId, 'tuning')
    }
  }

  // Sourced bounds (mirrored from arducopter.ts AC_PID subgroups).
  assert.equal(metadata.parameters.ATC_RAT_RLL_FF.maximum, 1)
  assert.equal(metadata.parameters.ATC_RAT_PIT_IMAX.maximum, 1)
  assert.equal(metadata.parameters.ATC_RAT_YAW_FLTE.maximum, 200)
  assert.equal(metadata.parameters.ATC_RAT_YAW_SMAX.maximum, 200)
})

test('ardusubMetadata exposes the vertical/depth position-controller catalog (Phase 4 Sub slice 2)', () => {
  const metadata = normalizeFirmwareMetadata(ardusubMetadata)

  // Sub's depth position controller (Depth Hold / Auto) was entirely
  // uncatalogued in the first cut. Both the modern (PSC_D_*) and legacy
  // (PSC_*Z_*) names are catalogued so a Sub on either firmware gets a
  // real label (ArduPilot renamed the family).
  const modern = [
    'PSC_D_POS_P', 'PSC_D_VEL_P', 'PSC_D_VEL_I', 'PSC_D_VEL_D', 'PSC_D_VEL_IMAX',
    'PSC_D_VEL_FLTE', 'PSC_D_VEL_FLTD', 'PSC_D_ACC_P', 'PSC_D_ACC_I', 'PSC_D_ACC_D',
    'PSC_D_ACC_IMAX', 'PSC_D_ACC_FLTT', 'PSC_D_ACC_FLTE', 'PSC_D_ACC_FLTD',
    'PSC_D_ACC_SMAX', 'PSC_JERK_D'
  ]
  const legacy = ['PSC_POSZ_P', 'PSC_VELZ_P', 'PSC_VELZ_I', 'PSC_VELZ_D', 'PSC_ACCZ_P', 'PSC_ACCZ_I', 'PSC_ACCZ_D', 'PSC_JERK_Z']
  for (const id of [...modern, ...legacy]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Sub catalog`)
    assert.equal(entry.categoryDefinition.id, 'depth')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds (verbatim from AC_PosControl.cpp).
  assert.equal(metadata.parameters.PSC_D_POS_P.minimum, 0.5)
  assert.equal(metadata.parameters.PSC_D_POS_P.maximum, 4)
  assert.equal(metadata.parameters.PSC_D_ACC_P.minimum, 0.01)
  assert.equal(metadata.parameters.PSC_D_ACC_P.maximum, 0.25)
  assert.equal(metadata.parameters.PSC_JERK_D.maximum, 50)

  // depth sorts ahead of power/failsafe and is a Tuning-view category.
  const depthCat = metadata.categories.find((c) => c.id === 'depth')
  assert.ok(depthCat && depthCat.viewId === 'tuning')
})

test('ardusubMetadata exposes the frame/joystick-button/sensor catalog (source-verified)', () => {
  const metadata = normalizeFirmwareMetadata(ardusubMetadata)

  // FRAME_CONFIG @Values verbatim from ArduSub/Parameters.cpp: the first cut
  // was missing 5:SimpleROV-5 and put Custom at 6 instead of 7.
  const frame = metadata.parameters.FRAME_CONFIG
  assert.equal(frame.categoryDefinition.viewId, 'motors')
  assert.equal(frame.rebootRequired, true)
  assert.equal(frame.options.length, 8)
  assert.equal(frame.options.find((o) => o.value === 1).label, 'Vectored')
  assert.equal(frame.options.find((o) => o.value === 4).label, 'SimpleROV-3')
  assert.equal(frame.options.find((o) => o.value === 5).label, 'SimpleROV-4')
  assert.equal(frame.options.find((o) => o.value === 6).label, 'SimpleROV-5')
  assert.equal(frame.options.find((o) => o.value === 7).label, 'Custom')
  // 6 must NOT still read 'Custom' (the corrected first-cut mislabel).
  assert.notEqual(frame.options.find((o) => o.value === 6).label, 'Custom')

  // All 32 joystick buttons expose FUNCTION + SFUNCTION under the joystick
  // category (Receiver view) with the shared AP_JSButton @Values map.
  for (const button of [0, 7, 15, 31]) {
    for (const suffix of ['FUNCTION', 'SFUNCTION']) {
      const entry = metadata.parameters[`BTN${button}_${suffix}`]
      assert.ok(entry, `expected BTN${button}_${suffix} in the Sub catalog`)
      assert.equal(entry.categoryDefinition.id, 'joystick')
      assert.equal(entry.categoryDefinition.viewId, 'receiver')
    }
  }
  // Button index stops at 31 (BTN0_..BTN31_ in ArduSub/Parameters.cpp).
  assert.ok(!metadata.parameters.BTN32_FUNCTION, 'Sub registers BTN0_..BTN31_ only')

  // Button-function @Values: verbatim AP_JSButton snake_case tokens, sparse
  // numbering. Spot-check the mode and action bindings a Sub pilot relies on.
  const fn = metadata.parameters.BTN0_FUNCTION.options
  assert.equal(fn.find((o) => o.value === 0).label, 'Disabled')
  assert.equal(fn.find((o) => o.value === 1).label, 'shift')
  assert.equal(fn.find((o) => o.value === 3).label, 'arm')
  assert.equal(fn.find((o) => o.value === 7).label, 'mode_depth_hold')
  assert.equal(fn.find((o) => o.value === 21).label, 'mount_center')
  assert.equal(fn.find((o) => o.value === 42).label, 'gain_inc')
  assert.equal(fn.find((o) => o.value === 138).label, 'actuator_6_max_toggle')
  // Unassigned firmware numbers stay gaps (no invented labels).
  assert.equal(fn.find((o) => o.value === 14), undefined)
  assert.equal(fn.find((o) => o.value === 50), undefined)
  // SFUNCTION shares the identical value set.
  assert.equal(metadata.parameters.BTN0_SFUNCTION.options.length, fn.length)

  // New pilot/depth/joystick scalars carry source @Range/@Units verbatim.
  assert.equal(metadata.parameters.PILOT_SPEED_UP.minimum, 20)
  assert.equal(metadata.parameters.PILOT_SPEED_UP.unit, 'cm/s')
  assert.equal(metadata.parameters.PILOT_SPEED_DN.minimum, 20)
  assert.equal(metadata.parameters.PILOT_SPEED.minimum, 10)
  assert.equal(metadata.parameters.PILOT_THR_FILT.maximum, 10)
  assert.equal(metadata.parameters.PILOT_THR_FILT.unit, 'Hz')
  assert.equal(metadata.parameters.SURFACE_MAX_THR.maximum, 1)
  assert.equal(metadata.parameters.JS_LIGHTS_STEPS.unit, 'PWM')
  assert.equal(metadata.parameters.JS_LIGHTS_STEPS.maximum, 10)

  // Mission yaw + crosstrack land in navigation; terrain/pilot-timeout in failsafe.
  assert.equal(metadata.parameters.WP_YAW_BEHAVIOR.categoryDefinition.id, 'navigation')
  assert.equal(metadata.parameters.WP_YAW_BEHAVIOR.options.find((o) => o.value === 4).label, 'Correct crosstrack error')
  assert.equal(metadata.parameters.XTRACK_ANG_LIM.minimum, 10)
  assert.equal(metadata.parameters.XTRACK_ANG_LIM.maximum, 90)
  assert.equal(metadata.parameters.FS_PILOT_TIMEOUT.categoryDefinition.id, 'failsafe')
  assert.equal(metadata.parameters.FS_PILOT_TIMEOUT.maximum, 3)
  assert.equal(metadata.parameters.FS_TERRAIN_ENAB.options.find((o) => o.value === 2).label, 'Surface')
})

test('battery-failsafe action enums are vehicle-correct (not the Copter set)', () => {
  // Verbatim from ArduPilot AP_BattMonitor_Params.cpp @Values. The Copter
  // enum (2:RTL) was previously reused for every vehicle — a dangerous
  // mislabel (Plane 2 is Land, Rover 2 is Hold, Sub 2 is Disarm).
  const labelFor = (bundle, paramId, value) => {
    const metadata = normalizeFirmwareMetadata(bundle)
    return metadata.parameters[paramId].options.find((option) => option.value === value)?.label
  }

  // Copter (the control) is unchanged.
  assert.equal(labelFor(arducopterMetadata, 'BATT_FS_LOW_ACT', 2), 'RTL')

  // Plane: 1:RTL, 2:Land; critical value 5 differs from low (Parachute vs
  // Parachute release).
  assert.equal(labelFor(arduplaneMetadata, 'BATT_FS_LOW_ACT', 1), 'RTL')
  assert.equal(labelFor(arduplaneMetadata, 'BATT_FS_LOW_ACT', 2), 'Land')
  assert.equal(labelFor(arduplaneMetadata, 'BATT_FS_LOW_ACT', 5), 'Parachute release')
  assert.equal(labelFor(arduplaneMetadata, 'BATT_FS_CRT_ACT', 5), 'Parachute')

  // Rover: 2:Hold.
  assert.equal(labelFor(arduroverMetadata, 'BATT_FS_LOW_ACT', 2), 'Hold')
  assert.equal(labelFor(arduroverMetadata, 'BATT_FS_CRT_ACT', 2), 'Hold')

  // Sub: 2:Disarm, 3:Enter surface mode, and no value 1.
  assert.equal(labelFor(ardusubMetadata, 'BATT_FS_LOW_ACT', 2), 'Disarm')
  assert.equal(labelFor(ardusubMetadata, 'BATT_FS_LOW_ACT', 3), 'Enter surface mode')
  assert.equal(labelFor(ardusubMetadata, 'BATT_FS_LOW_ACT', 1), undefined)

  // The safety point: a non-Copter value 2 must NOT read as the Copter label.
  for (const bundle of [arduplaneMetadata, arduroverMetadata, ardusubMetadata]) {
    assert.notEqual(labelFor(bundle, 'BATT_FS_LOW_ACT', 2), 'RTL')
  }
})

test('non-Copter FS_* action enums match ArduPilot Parameters.cpp @Values', () => {
  const labelFor = (bundle, paramId, value) => {
    const metadata = normalizeFirmwareMetadata(bundle)
    return metadata.parameters[paramId].options.find((option) => option.value === value)?.label
  }
  const valuesOf = (bundle, paramId) => {
    const metadata = normalizeFirmwareMetadata(bundle)
    return metadata.parameters[paramId].options.map((option) => option.value).sort((a, b) => a - b)
  }

  // Rover FS_ACTION (Rover/Parameters.cpp @Param: FS_ACTION @Values):
  // 0:Nothing,1:RTL,2:Hold,3:SmartRTL or RTL,4:SmartRTL or Hold,5:Terminate,6:Loiter or Hold
  assert.equal(labelFor(arduroverMetadata, 'FS_ACTION', 3), 'SmartRTL or RTL')
  assert.equal(labelFor(arduroverMetadata, 'FS_ACTION', 6), 'Loiter or Hold')
  assert.deepEqual(valuesOf(arduroverMetadata, 'FS_ACTION'), [0, 1, 2, 3, 4, 5, 6])
  // FS_CRASH_CHECK and FS_EKF_ACTION have their OWN value sets (not FS_ACTION's).
  assert.equal(labelFor(arduroverMetadata, 'FS_CRASH_CHECK', 2), 'HoldAndDisarm')
  assert.equal(labelFor(arduroverMetadata, 'FS_EKF_ACTION', 2), 'ReportOnly')
  assert.deepEqual(valuesOf(arduroverMetadata, 'FS_EKF_ACTION'), [0, 1, 2])

  // Sub failsafe params have genuinely different value sets per ArduSub/Parameters.cpp.
  // FS_GCS_ENABLE: 0:Disabled,1:Warn only,2:Disarm,3:Enter depth hold mode,4:Enter surface mode
  assert.equal(labelFor(ardusubMetadata, 'FS_GCS_ENABLE', 3), 'Enter depth hold mode')
  assert.equal(labelFor(ardusubMetadata, 'FS_GCS_ENABLE', 4), 'Enter surface mode')
  assert.deepEqual(valuesOf(ardusubMetadata, 'FS_GCS_ENABLE'), [0, 1, 2, 3, 4])
  // FS_PRESS_ENABLE / FS_TEMP_ENABLE only support 0:Disabled,1:Warn only.
  assert.deepEqual(valuesOf(ardusubMetadata, 'FS_PRESS_ENABLE'), [0, 1])
  assert.deepEqual(valuesOf(ardusubMetadata, 'FS_TEMP_ENABLE'), [0, 1])
  // FS_PILOT_INPUT / FS_CRASH_CHECK: 0:Disabled,1:Warn only,2:Disarm.
  assert.equal(labelFor(ardusubMetadata, 'FS_PILOT_INPUT', 2), 'Disarm')
  assert.equal(labelFor(ardusubMetadata, 'FS_CRASH_CHECK', 2), 'Disarm')
  assert.deepEqual(valuesOf(ardusubMetadata, 'FS_CRASH_CHECK'), [0, 1, 2])
  // FS_LEAK_ENABLE: 0:Disabled,1:Warn only,2:Enter surface mode.
  assert.equal(labelFor(ardusubMetadata, 'FS_LEAK_ENABLE', 2), 'Enter surface mode')
})

test('arduplaneMetadata catalog exposes representative parameters on the expected product surfaces', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // QuadPlane enable lands under the Outputs / Airframe surface.
  assert.equal(metadata.parameters.Q_ENABLE.categoryDefinition.id, 'airframe')
  assert.equal(metadata.parameters.Q_ENABLE.categoryDefinition.viewId, 'motors')
  assert.equal(metadata.parameters.Q_ENABLE.options.length, 2)

  // Battery monitoring lands under the Power surface.
  assert.equal(metadata.parameters.BATT_MONITOR.categoryDefinition.id, 'power')
  assert.equal(metadata.parameters.BATT_MONITOR.categoryDefinition.viewId, 'power')

  // Plane long failsafe sits in the failsafe category, surfaced under the
  // dedicated Failsafe tab now (used to flow through the Power tab).
  const longFs = metadata.parameters.FS_LONG_ACTN
  assert.equal(longFs.categoryDefinition.id, 'failsafe')
  assert.equal(longFs.categoryDefinition.viewId, 'failsafe')
  assert.equal(longFs.options.length, 6)
  assert.equal(longFs.options[0].label, 'Continue')
  assert.equal(longFs.options[2].label, 'Glide')
  assert.equal(longFs.options[5].label, 'AUTOLAND')

  // OSD and Serial port families resolve to the dedicated FPV surfaces.
  assert.equal(metadata.parameters.OSD_TYPE.categoryDefinition.viewId, 'osd')
  assert.equal(metadata.parameters.SERIAL1_PROTOCOL.categoryDefinition.viewId, 'ports')
  assert.ok(metadata.parameters.SERIAL1_PROTOCOL.options.length > 0)
  assert.ok(metadata.parameters.BRD_SER1_RTSCTS, 'expected BRD_SER1_RTSCTS in the Plane catalog')

  // Logging maps to the parameters surface like ArduCopter.
  assert.equal(metadata.parameters.LOG_BACKEND_TYPE.categoryDefinition.id, 'logging')
  assert.equal(metadata.parameters.LOG_BACKEND_TYPE.categoryDefinition.viewId, 'parameters')

  // The Plane flight-mode slots use the Plane mode table, not the Copter one.
  const fltMode1Options = metadata.parameters.FLTMODE1.options
  assert.ok(fltMode1Options.some((option) => option.label === 'Manual'))
  assert.ok(fltMode1Options.some((option) => option.label === 'QStabilize'))
})

test('arduplaneMetadata exposes the QuadPlane VTOL tuning group on the Tuning surface', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // VTOL rate PIDs land in the dedicated vtol-pid category under the Tuning view.
  for (const id of ['Q_A_RAT_RLL_P', 'Q_A_RAT_PIT_I', 'Q_A_RAT_YAW_D', 'Q_A_RAT_RLL_FF']) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'vtol-pid')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Angle-loop gains and response limits sit in the vtol-attitude category.
  assert.equal(metadata.parameters.Q_A_ANG_RLL_P.categoryDefinition.id, 'vtol-attitude')
  assert.equal(metadata.parameters.Q_A_ANG_RLL_P.categoryDefinition.viewId, 'tuning')
  assert.equal(metadata.parameters.Q_A_RATE_RLL_MAX.unit, 'deg/s')
  assert.equal(metadata.parameters.Q_ANGLE_MAX.unit, 'cdeg')

  // VTOL filters and slew limits group under vtol-filters.
  assert.equal(metadata.parameters.Q_A_RAT_RLL_FLTD.categoryDefinition.id, 'vtol-filters')
  assert.equal(metadata.parameters.Q_A_RAT_RLL_FLTD.unit, 'Hz')
  assert.equal(metadata.parameters.Q_A_RAT_YAW_SMAX.categoryDefinition.id, 'vtol-filters')

  // Lift-motor outputs reuse the shared Outputs surface like ArduCopter's MOT_*.
  const motorPwmType = metadata.parameters.Q_M_PWM_TYPE
  assert.equal(motorPwmType.categoryDefinition.id, 'outputs')
  assert.equal(motorPwmType.categoryDefinition.viewId, 'motors')
  assert.equal(motorPwmType.rebootRequired, true)
  assert.equal(motorPwmType.options[0].label, 'Normal')
  assert.equal(motorPwmType.options[motorPwmType.options.length - 1].label, 'PWMRange')
  assert.equal(metadata.parameters.Q_M_THST_HOVER.categoryDefinition.id, 'outputs')

  // Position/waypoint and assist/autotune knobs resolve to their Tuning categories.
  assert.equal(metadata.parameters.Q_P_POSXY_P.categoryDefinition.id, 'vtol-position')
  assert.equal(metadata.parameters.Q_WP_SPEED.unit, 'cm/s')
  assert.equal(metadata.parameters.Q_ASSIST_SPEED.categoryDefinition.id, 'vtol-assist')
  assert.equal(metadata.parameters.Q_ASSIST_SPEED.unit, 'm/s')
  assert.equal(metadata.parameters.Q_AUTOTUNE_AXES.categoryDefinition.id, 'vtol-assist')

  // The Tuning view is now backed by the VTOL categories rather than a placeholder.
  const tuningCategories = metadata.categories.filter((category) => category.viewId === 'tuning')
  assert.ok(tuningCategories.some((category) => category.id === 'vtol-pid'))
  assert.ok(tuningCategories.some((category) => category.id === 'vtol-assist'))
})

test('arduplaneMetadata exposes the fixed-wing surface tuning catalog (Phase 3 depth)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // Fixed-wing rate PIDs (RLL/PTCH/YAW _RATE_ P/I/D/FF/IMAX) land in the
  // dedicated fixed-wing-pid category under the Tuning view — these are the
  // primary forward-flight tuning gains a real Plane reports and were
  // entirely absent from the first-cut catalog (the "only 221 params"
  // gap: previously raw/uncatalogued for a connected Plane).
  for (const id of [
    'RLL_RATE_P', 'RLL_RATE_I', 'RLL_RATE_D', 'RLL_RATE_FF', 'RLL_RATE_IMAX',
    'PTCH_RATE_P', 'PTCH_RATE_FF', 'YAW_RATE_P', 'YAW_RATE_FF'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'fixed-wing-pid')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Attitude time constants, rate maxima, and bank/pitch limits group under
  // fixed-wing-attitude with the ArduPilot-sourced editor bounds.
  const tconst = metadata.parameters.RLL2SRV_TCONST
  assert.equal(tconst.categoryDefinition.id, 'fixed-wing-attitude')
  assert.equal(tconst.minimum, 0.4)
  assert.equal(tconst.maximum, 1)
  const bank = metadata.parameters.LIM_ROLL_CD
  assert.equal(bank.categoryDefinition.id, 'fixed-wing-attitude')
  assert.equal(bank.maximum, 9000)
  assert.equal(metadata.parameters.LIM_PITCH_MIN.minimum, -9000)
  assert.equal(metadata.parameters.PTCH2SRV_RMAX_UP.categoryDefinition.viewId, 'tuning')

  // Fixed-wing tuning categories sort ahead of the VTOL ones (a Plane is
  // fixed-wing first), and these are NOT Copter/QuadPlane-only keys.
  const tuning = metadata.categories.filter((category) => category.viewId === 'tuning')
  const fwPid = tuning.find((category) => category.id === 'fixed-wing-pid')
  const vtolPid = tuning.find((category) => category.id === 'vtol-pid')
  assert.ok(fwPid && vtolPid)
  assert.ok(fwPid.order < vtolPid.order)
})

test('arduplaneMetadata exposes the airspeed + cruise catalog (Phase 3 slice 2)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // Airspeed sensor + envelope land in the dedicated airspeed category;
  // both the modern (AIRSPEED_*) and legacy (ARSPD_FBW_*/TRIM_ARSPD_CM)
  // names are catalogued so a connected Plane on either firmware version
  // gets a real label instead of a raw parameter.
  for (const id of ['ARSPD_TYPE', 'ARSPD_USE', 'AIRSPEED_MIN', 'ARSPD_FBW_MIN', 'AIRSPEED_CRUISE', 'TRIM_ARSPD_CM', 'STALL_PREVENTION']) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'airspeed')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // ARSPD_TYPE / ARSPD_USE carry the ArduPilot-sourced enum labels.
  assert.equal(metadata.parameters.ARSPD_TYPE.options.find((o) => o.value === 1).label, 'I2C-MS4525D0')
  assert.equal(metadata.parameters.ARSPD_TYPE.options.find((o) => o.value === 100).label, 'SITL')
  assert.equal(metadata.parameters.ARSPD_USE.options.find((o) => o.value === 2).label, 'Use when zero throttle')

  // Cruise/throttle + level-flight pitch trim group under the cruise
  // category with the sourced bounds; legacy cd name kept alongside.
  for (const id of ['TRIM_THROTTLE', 'THR_MIN', 'THR_MAX', 'THR_SLEWRATE', 'THROTTLE_NUDGE', 'PTCH_TRIM_DEG', 'TRIM_PITCH_CD']) {
    assert.equal(metadata.parameters[id].categoryDefinition.id, 'cruise', `${id} in cruise`)
  }
  assert.equal(metadata.parameters.THR_MIN.minimum, -100)
  assert.equal(metadata.parameters.THR_SLEWRATE.maximum, 500)
  assert.equal(metadata.parameters.PTCH_TRIM_DEG.minimum, -45)
  assert.equal(metadata.parameters.TRIM_PITCH_CD.minimum, -4500)

  // airspeed + cruise sort ahead of the VTOL tuning categories.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const air = tuning.find((c) => c.id === 'airspeed')
  const vtolPid = tuning.find((c) => c.id === 'vtol-pid')
  assert.ok(air && vtolPid && air.order < vtolPid.order)
})

test('arduplaneMetadata exposes the TECS + L1 navigation catalog (Phase 3 slice 3)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // TECS total-energy controller lands in the dedicated tecs category;
  // these auto-flight speed/height gains were uncatalogued for a
  // connected Plane (the "only 221 params" gap).
  for (const id of [
    'TECS_CLMB_MAX', 'TECS_SINK_MIN', 'TECS_SINK_MAX', 'TECS_TIME_CONST',
    'TECS_THR_DAMP', 'TECS_PTCH_DAMP', 'TECS_INTEG_GAIN', 'TECS_SPDWEIGHT',
    'TECS_PITCH_MAX', 'TECS_PITCH_MIN', 'TECS_RLL2THR'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'tecs')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // L1 path-tracking controller in the navigation category.
  for (const id of ['NAVL1_PERIOD', 'NAVL1_DAMPING', 'NAVL1_XTRACK_I', 'NAVL1_LIM_BANK']) {
    assert.equal(metadata.parameters[id].categoryDefinition.id, 'navigation', `${id} in navigation`)
  }

  // Sourced editor bounds (verbatim from AP_TECS.cpp / AP_L1_Control.cpp).
  assert.equal(metadata.parameters.TECS_CLMB_MAX.maximum, 20)
  assert.equal(metadata.parameters.TECS_TIME_CONST.minimum, 3)
  assert.equal(metadata.parameters.TECS_PITCH_MIN.minimum, -45)
  assert.equal(metadata.parameters.NAVL1_PERIOD.maximum, 60)
  assert.equal(metadata.parameters.NAVL1_DAMPING.minimum, 0.6)

  // tecs + navigation sort ahead of the VTOL tuning categories.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const tecs = tuning.find((c) => c.id === 'tecs')
  const vtolPid = tuning.find((c) => c.id === 'vtol-pid')
  assert.ok(tecs && vtolPid && tecs.order < vtolPid.order)
})

test('arduplaneMetadata exposes the TECS landing / takeoff / advanced-cruise catalog', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // Advanced cruise TECS params — added alongside the existing 11 so the
  // "TECS feels mushy / spikes in turns" tuning workflow has the
  // filter-frequency, vertical-accel and pitch-feedforward knobs that
  // map directly to AP_TECS.cpp var_info[]. All land in the existing
  // 'tecs' category so cruise tuning stays in one card.
  for (const id of [
    'TECS_VERT_ACC',
    'TECS_HGT_OMEGA',
    'TECS_SPD_OMEGA',
    'TECS_HDEM_TCONST',
    'TECS_PTCH_FF_V0',
    'TECS_PTCH_FF_K'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'tecs', `${id} should be in the cruise tecs category`)
  }

  // TECS landing-stage params — separated into 'tecs-landing' so they
  // cluster in a dedicated card the operator only tunes when working
  // the auto-landing approach. Verbatim from AP_TECS.cpp.
  const landingIds = [
    'TECS_LAND_ARSPD',
    'TECS_LAND_THR',
    'TECS_LAND_DAMP',
    'TECS_LAND_PMAX',
    'TECS_LAND_TCONST',
    'TECS_LAND_TDAMP',
    'TECS_LAND_IGAIN',
    'TECS_LAND_PDAMP',
    'TECS_APPR_SMAX',
    'TECS_FLARE_HGT'
  ]
  for (const id of landingIds) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'tecs-landing', `${id} should be in the tecs-landing category`)
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // TECS takeoff integrator — its own category so its independence
  // from cruise integrator wind-up is visible in the UI.
  const takeoff = metadata.parameters.TECS_TKOFF_IGAIN
  assert.ok(takeoff, 'expected TECS_TKOFF_IGAIN in the Plane catalog')
  assert.equal(takeoff.categoryDefinition.id, 'tecs-takeoff')
  assert.equal(takeoff.categoryDefinition.viewId, 'tuning')

  // Source-cited editor bounds (verbatim from AP_TECS.cpp @Param blocks).
  assert.equal(metadata.parameters.TECS_VERT_ACC.maximum, 10, 'TECS_VERT_ACC @Range 1 10')
  assert.equal(metadata.parameters.TECS_VERT_ACC.minimum, 1)
  assert.equal(metadata.parameters.TECS_HGT_OMEGA.maximum, 5, 'TECS_HGT_OMEGA @Range 1.0 5.0')
  assert.equal(metadata.parameters.TECS_SPD_OMEGA.maximum, 2, 'TECS_SPD_OMEGA @Range 0.5 2.0')
  assert.equal(metadata.parameters.TECS_LAND_ARSPD.minimum, -1, 'TECS_LAND_ARSPD @Range -1 127 (negative = AIRSPEED_MIN..CRUISE midpoint, NOT inherit)')
  assert.match(
    metadata.parameters.TECS_LAND_ARSPD.description ?? '',
    /midpoint between AIRSPEED_MIN and AIRSPEED_CRUISE/,
    'conformance fix: negative LAND_ARSPD is the min..cruise midpoint, not an inherit-cruise sentinel'
  )
  assert.equal(metadata.parameters.TECS_LAND_THR.minimum, -1, 'TECS_LAND_THR: -1 means "inherit TRIM_THROTTLE"')
  // Conformance fix: upstream LAND_TDAMP @Range is 0.1 1.0 with ZERO as
  // the inherit sentinel ("When set to 0 landing throttle damping is
  // controlled by TECS_THR_DAMP"). The old entry documented -1 as the
  // sentinel — upstream only special-cases 0, so -1 would have been a
  // REAL inverted damping gain during auto-land.
  assert.equal(metadata.parameters.TECS_LAND_TDAMP.minimum, 0, 'TECS_LAND_TDAMP: 0 (not -1) inherits TECS_THR_DAMP')
  assert.match(metadata.parameters.TECS_LAND_TDAMP.description ?? '', /0 inherits TECS_THR_DAMP/)
  // Conformance fix: HDEM_TCONST @Range 1.0 5.0, @Increment 0.2 (was an
  // invented 0.1 floor 10x below the documented lower bound).
  assert.equal(metadata.parameters.TECS_HDEM_TCONST.minimum, 1, 'TECS_HDEM_TCONST @Range 1.0 5.0')
  assert.equal(metadata.parameters.TECS_HDEM_TCONST.step, 0.2, 'TECS_HDEM_TCONST @Increment 0.2')
  assert.equal(metadata.parameters.TECS_LAND_PMAX.maximum, 40, 'TECS_LAND_PMAX @Range -5 40')
  assert.equal(metadata.parameters.TECS_FLARE_HGT.maximum, 15, 'TECS_FLARE_HGT @Range 0 15')
  assert.equal(metadata.parameters.TECS_TKOFF_IGAIN.maximum, 0.5, 'TECS_TKOFF_IGAIN @Range 0.0 0.5')

  // tecs-landing / tecs-takeoff sort between cruise tecs and navigation
  // so the card order in TuningPlaneSection reads cruise → landing →
  // takeoff → L1 navigation.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const tecs = tuning.find((c) => c.id === 'tecs')
  const tecsLanding = tuning.find((c) => c.id === 'tecs-landing')
  const tecsTakeoff = tuning.find((c) => c.id === 'tecs-takeoff')
  const navigation = tuning.find((c) => c.id === 'navigation')
  assert.ok(tecs && tecsLanding && tecsTakeoff && navigation, 'all four categories exist on the tuning view')
  assert.ok(
    tecs.order < tecsLanding.order && tecsLanding.order < tecsTakeoff.order && tecsTakeoff.order < navigation.order,
    `expected cruise → landing → takeoff → navigation order, got ${tecs.order}, ${tecsLanding.order}, ${tecsTakeoff.order}, ${navigation.order}`
  )
})

test('arduplaneMetadata exposes the mission & navigation catalog (Phase 3 slice 4)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // Waypoint/RTL geometry lands in the dedicated mission category — these
  // were uncatalogued for a connected Plane (the "only 221 params" gap).
  for (const id of ['WP_RADIUS', 'WP_MAX_RADIUS', 'WP_LOITER_RAD', 'RTL_RADIUS', 'RTL_AUTOLAND']) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'mission')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds + the RTL_AUTOLAND enum (verbatim from Parameters.cpp).
  assert.equal(metadata.parameters.WP_RADIUS.minimum, 1)
  assert.equal(metadata.parameters.WP_LOITER_RAD.minimum, -32767)
  assert.equal(metadata.parameters.RTL_AUTOLAND.options.find((o) => o.value === 0).label, 'Disabled')
  assert.equal(
    metadata.parameters.RTL_AUTOLAND.options.find((o) => o.value === 4).label,
    'Go directly to landing sequence (DO_RETURN_PATH_START)'
  )
  // ALT_HOLD_RTL was removed from modern ArduPlane — must not be catalogued.
  assert.equal(metadata.parameters.ALT_HOLD_RTL, undefined)

  // mission sorts ahead of the VTOL tuning categories.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const mission = tuning.find((c) => c.id === 'mission')
  const vtolPid = tuning.find((c) => c.id === 'vtol-pid')
  assert.ok(mission && vtolPid && mission.order < vtolPid.order)
})

test('arduplaneMetadata exposes the auto-landing catalog (Phase 3 slice 5)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // The fixed-wing auto-landing family lands in the dedicated landing
  // category — uncatalogued before (the "only 221 params" gap).
  for (const id of [
    'LAND_TYPE', 'LAND_SLOPE_RCALC', 'LAND_ABORT_DEG', 'LAND_PITCH_DEG',
    'LAND_FLARE_ALT', 'LAND_FLARE_SEC', 'LAND_PF_ALT', 'LAND_PF_SEC',
    'LAND_PF_ARSPD', 'LAND_THR_SLEW', 'LAND_DISARMDELAY', 'LAND_THEN_NEUTRL',
    'LAND_ABORT_THR', 'LAND_FLAP_PERCNT', 'LAND_FLARE_AIM', 'LAND_WIND_COMP'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'landing')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds + enums (verbatim from AP_Landing.cpp).
  assert.equal(metadata.parameters.LAND_PITCH_DEG.minimum, -20)
  assert.equal(metadata.parameters.LAND_THR_SLEW.maximum, 500)
  assert.equal(metadata.parameters.LAND_TYPE.options.find((o) => o.value === 1).label, 'Deepstall')
  assert.equal(metadata.parameters.LAND_THEN_NEUTRL.options.find((o) => o.value === 2).label, 'Servos to zero PWM')
  assert.equal(metadata.parameters.LAND_ABORT_THR.options.length, 2)

  // landing sorts ahead of the VTOL tuning categories.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const landing = tuning.find((c) => c.id === 'landing')
  const vtolPid = tuning.find((c) => c.id === 'vtol-pid')
  assert.ok(landing && vtolPid && landing.order < vtolPid.order)
})

test('arduplaneMetadata exposes the control-mixing catalog (Phase 3 slice 6)', () => {
  const metadata = normalizeFirmwareMetadata(arduplaneMetadata)

  // Control-mixing + flap schedule lands in the dedicated mixing
  // category — the final fixed-wing family that was uncatalogued for a
  // connected Plane (the "only 221 params" gap).
  for (const id of [
    'KFF_RDDRMIX', 'KFF_THR2PTCH', 'MIXING_GAIN', 'RUDD_DT_GAIN',
    'FLAP_1_PERCNT', 'FLAP_1_SPEED', 'FLAP_2_PERCNT', 'FLAP_2_SPEED'
  ]) {
    const entry = metadata.parameters[id]
    assert.ok(entry, `expected ${id} in the Plane catalog`)
    assert.equal(entry.categoryDefinition.id, 'mixing')
    assert.equal(entry.categoryDefinition.viewId, 'tuning')
  }

  // Sourced bounds (verbatim from ArduPlane Parameters.cpp).
  assert.equal(metadata.parameters.KFF_THR2PTCH.minimum, -5)
  assert.equal(metadata.parameters.MIXING_GAIN.minimum, 0.5)
  assert.equal(metadata.parameters.MIXING_GAIN.maximum, 1.2)

  // mixing sorts ahead of the VTOL tuning categories.
  const tuning = metadata.categories.filter((c) => c.viewId === 'tuning')
  const mixing = tuning.find((c) => c.id === 'mixing')
  const vtolPid = tuning.find((c) => c.id === 'vtol-pid')
  assert.ok(mixing && vtolPid && mixing.order < vtolPid.order)
})

test('SERVOn_FUNCTION resolves universal labels (any ArduPilot vehicle, not just Copter)', () => {
  // SERVOn_FUNCTION is a single universal output-function enum shared by
  // Copter / Plane / Rover / Sub. A real ArduPlane reported SERVO1..4 =
  // 4 / 19 / 70 / 21 and these previously rendered as "Unknown" because
  // the shared label map only carried the Copter-relevant subset.
  assert.equal(formatArducopterServoFunction(4), 'Aileron')
  assert.equal(formatArducopterServoFunction(19), 'Elevator')
  assert.equal(formatArducopterServoFunction(21), 'Rudder')
  assert.equal(formatArducopterServoFunction(70), 'Throttle')
  // Other common fixed-wing / rover / boat surfaces.
  assert.equal(formatArducopterServoFunction(2), 'Flap')
  assert.equal(formatArducopterServoFunction(24), 'Flaperon Left')
  assert.equal(formatArducopterServoFunction(77), 'Elevon Left')
  assert.equal(formatArducopterServoFunction(79), 'VTail Left')
  assert.equal(formatArducopterServoFunction(26), 'Ground Steering')
  assert.equal(formatArducopterServoFunction(89), 'Main Sail')
  // Motors still resolve.
  assert.equal(formatArducopterServoFunction(33), 'Motor 1')
  // Graceful fallback for genuinely-unknown codes — never "Unknown".
  assert.equal(formatArducopterServoFunction(250), 'Function 250')
  assert.equal(formatArducopterServoFunction(undefined), 'Unknown')
})

test('SERIALn_BAUD: 12.5 MBaud is the literal coded value 12500000; coded 12500 is 12,500 baud (AP_SerialManager map_baudrate)', () => {
  // Conformance-audit fix: this test previously locked the INVERSE
  // (12500 <-> 12500000) — but upstream map_baudrate() has no
  // `case 12500`; any coded value > 2000 is a DIRECT baudrate, and the
  // @Values line encodes 12.5 MBaud as '12500000:12.5MBaud'. With the
  // old mapping, picking the 12.5M preset staged SERIALn_BAUD=12500 and
  // the real port ran at 12,500 baud — three orders of magnitude off.
  assert.equal(arducopterSerialBaudRate(12500000), 12500000, '12500000 is direct baud (the 12.5M code)')
  assert.equal(encodeArducopterSerialBaud(12500000), 12500000, '12.5M preset encodes to the upstream coded value')
  assert.equal(arducopterSerialBaudRate(12500), 12500, 'coded 12500 means 12,500 baud on real ArduPilot')
  // Upstream `if (rate <= 0) { rate = 57; }` — zero/negative runs at 57600.
  assert.equal(arducopterSerialBaudRate(0), 57600)
  assert.equal(arducopterSerialBaudRate(-1), 57600)
  // Existing codes still resolve.
  assert.equal(arducopterSerialBaudRate(115), 115200)
  assert.equal(encodeArducopterSerialBaud(2000000), 2000)
})

test('SERIALn_PROTOCOL labels match AP_SerialManager @Values for the audit-corrected entries', () => {
  // Spot-lock the 18 entries the conformance audit found diverged, plus
  // the two that were already right in the same neighborhood. Source:
  // AP_SerialManager.cpp SERIALn_PROTOCOL @Values (master, 2026-06).
  const expected = {
    9: 'Rangefinder',
    10: 'FrSky SPort Passthrough',
    11: 'Lidar360',
    18: 'OpticalFlow',
    19: 'RobotisServo',
    21: 'WindVane',
    25: 'LTM',
    30: 'Generator',
    31: 'Winch',
    33: 'DJI FPV',
    35: 'ADSB',
    36: 'AHRS',
    39: 'Torqeedo',
    40: 'AIS',
    41: 'CoDevESC',
    42: 'DisplayPort',
    43: 'MAVLink High Latency',
    44: 'IRC Tramp',
    45: 'DDS XRCE',
    46: 'IMUDATA'
  }
  for (const [value, label] of Object.entries(expected)) {
    assert.equal(
      ARDUCOPTER_SERIAL_PROTOCOL_LABELS[Number(value)],
      label,
      `SERIALn_PROTOCOL ${value} must read '${label}' per AP_SerialManager @Values`
    )
  }
})

test('SERIALn_OPTIONS bit labels match AP_SerialManager @Bitmask ordering', () => {
  // Source: AP_SerialManager.cpp SERIALn_OPTIONS @Bitmask. The audit
  // found 11 of 13 bits misaligned (bit 0 was labeled Half Duplex but is
  // InvertRX upstream — ticking it killed RX). These back editable
  // checkboxes, so positions are load-bearing.
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[0], 'Invert RX')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[1], 'Invert TX')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[2], 'Half Duplex')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[3], 'Swap RX/TX')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[4], 'RX Pull-down')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[5], 'RX Pull-up')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[6], 'TX Pull-down')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[7], 'TX Pull-up')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[8], 'RX No DMA')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[9], 'TX No DMA')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[10], 'Disable MAVLink Forwarding')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[11], 'Disable FIFO')
  assert.equal(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS[12], 'Ignore Streamrate')
})

test('Serial protocol options put the common roles first, then alphabetical', () => {
  const labels = arducopterSerialProtocolOptions().map((o) => o.label)
  // None, then the priority group in order.
  assert.deepEqual(labels.slice(0, 10), [
    'None', 'MAVLink2', 'GPS', 'ESC Telemetry', 'RCIN', 'Scripting', 'MSP', 'SmartAudio', 'DisplayPort', 'PPP'
  ])
  // The tail is sorted alphabetically (ADSB before Airspeed before ...).
  const tail = labels.slice(10)
  const sortedTail = [...tail].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(tail, sortedTail)
  // No duplicates and every label present.
  assert.equal(new Set(labels).size, labels.length)
})

test('FLTMODE_CH offers a Disable option, and unknown flight modes have no label', () => {
  // #76: the mode-channel selector must list "Disabled" (FLTMODE_CH = 0).
  const fltModeCh = arducopterMetadata.parameters.FLTMODE_CH
  assert.ok(
    (fltModeCh.options ?? []).some((option) => option.value === 0 && option.label === 'Disabled'),
    'FLTMODE_CH options should include a Disabled (0) entry'
  )
  // #74: known modes resolve to a label; unknown/gap values return undefined
  // so the UI can render them as "—" instead of a fake "Mode N".
  assert.equal(arducopterFlightModeLabel(0), 'Stabilize')
  assert.equal(arducopterFlightModeLabel(6), 'RTL')
  assert.equal(arducopterFlightModeLabel(8), undefined) // gap in the copter mode list
  assert.equal(arducopterFlightModeLabel(99), undefined)
})

test('arducopter catalog covers SERVO1..32 with FUNCTION/MIN/MAX/TRIM/REVERSED metadata', () => {
  // Real-FC audit follow-up: the catalog only carried SERVO1..16_FUNCTION
  // metadata, so any board with more channels (Cube Orange + PWM expansion,
  // CAN ESC arrays) lost curated labels for the extras. The runtime already
  // filters by what the FC actually reports, so this is pure metadata
  // coverage — high-output boards now get proper labels + PWM bounds and
  // the Output Reversed enum, low-output boards see no behavior change.
  const params = arducopterMetadata.parameters
  for (const channel of [1, 11, 14, 16, 24, 32]) {
    assert.ok(params[`SERVO${channel}_FUNCTION`], `SERVO${channel}_FUNCTION present`)
    assert.equal(params[`SERVO${channel}_FUNCTION`]?.label, `Output ${channel} Function`)
    assert.ok((params[`SERVO${channel}_FUNCTION`]?.options ?? []).length > 0, `SERVO${channel}_FUNCTION has options`)
    assert.equal(params[`SERVO${channel}_MIN`]?.unit, 'us')
    assert.equal(params[`SERVO${channel}_MAX`]?.unit, 'us')
    assert.equal(params[`SERVO${channel}_TRIM`]?.unit, 'us')
    // REVERSED has a Normal/Reversed enum rather than a unit.
    const reversedOptions = params[`SERVO${channel}_REVERSED`]?.options ?? []
    assert.equal(reversedOptions.length, 2)
    assert.equal(reversedOptions[0].label, 'Normal')
    assert.equal(reversedOptions[1].label, 'Reversed')
  }
})

test('arduplane catalog covers BOTH legacy Q_WP_(SPEED|ACCEL|RADIUS) and modern Q_WP_(SPD|ACC|RADIUS_M) cm->m renames', () => {
  // ArduPlane 4.5+ renamed the QuadPlane waypoint nav family AND switched
  // the unit from cm-based to m-based (factor 100). Catalog both name
  // variants with correct per-form units. Alias shim deliberately NOT
  // wired up — a raw value mirror would be 100x off.
  const params = arduplaneMetadata.parameters
  // Legacy (cm-based)
  for (const id of ['Q_WP_SPEED', 'Q_WP_SPEED_UP', 'Q_WP_SPEED_DN']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'cm/s')
    assert.match(params[id]?.label ?? '', /legacy/i)
  }
  assert.equal(params.Q_WP_ACCEL?.unit, 'cm/s²')
  assert.equal(params.Q_WP_RADIUS?.unit, 'cm')
  // Modern (m-based)
  for (const id of ['Q_WP_SPD', 'Q_WP_SPD_UP', 'Q_WP_SPD_DN']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'm/s')
  }
  assert.equal(params.Q_WP_ACC?.unit, 'm/s²')
  assert.equal(params.Q_WP_RADIUS_M?.unit, 'm')
  // Bound shifts mirror the unit change (factor 100 for speed/accel, factor
  // 100 with rounding for radius).
  assert.equal(params.Q_WP_SPEED?.maximum, 2000)
  assert.equal(params.Q_WP_SPD?.maximum, 20)
})

test('arduplane catalog covers BOTH legacy Q_P_(POSXY/POSZ/VELXY/ACCZ) and modern Q_P_(NE_POS/D_POS/NE_VEL/D_ACC) NED-axis rename', () => {
  // ArduPlane 4.5 renamed the QuadPlane position-controller axis labels to
  // the NED convention (XY -> NE, Z -> D) alongside a controller retune that
  // narrowed safe gain bounds — most dramatically the Z-accel loop (~6x).
  // Catalog both forms with their own bounds. Alias shim deliberately NOT
  // wired up — a raw value mirror could push a legacy Q_P_ACCZ_P=1.0 into
  // Q_P_D_ACC_P=1.0 (4x the modern safe max) and dangerously detune.
  const params = arduplaneMetadata.parameters
  // Legacy XY/Z
  for (const id of ['Q_P_POSXY_P', 'Q_P_POSZ_P', 'Q_P_VELXY_P', 'Q_P_VELXY_I', 'Q_P_ACCZ_P', 'Q_P_ACCZ_I']) {
    assert.ok(params[id], `${id} present`)
    assert.match(params[id]?.label ?? '', /legacy/i)
  }
  // Modern NE/D
  for (const id of ['Q_P_NE_POS_P', 'Q_P_D_POS_P', 'Q_P_NE_VEL_P', 'Q_P_NE_VEL_I', 'Q_P_D_ACC_P', 'Q_P_D_ACC_I']) {
    assert.ok(params[id], `${id} present`)
  }
  // Bound retune for the D-accel loop is the safety-critical delta.
  assert.equal(params.Q_P_ACCZ_P?.maximum, 1.5)
  assert.equal(params.Q_P_D_ACC_P?.maximum, 0.25)
  assert.equal(params.Q_P_ACCZ_I?.maximum, 3)
  assert.equal(params.Q_P_D_ACC_I?.maximum, 0.5)
})

test('arduplane catalog covers BOTH legacy Q_A_(RATE/ACCEL)_*_MAX and modern Q_A_(RATE/ACC)_*_MAX', () => {
  // ArduPlane 4.5+ shortened the QuadPlane attitude-limit names — RLL/PIT/YAW
  // -> R/P/Y, ACCEL -> ACC — AND changed the accel unit (cd/s² -> deg/s², a
  // 100x bound difference). Catalog both name variants so the curated UI
  // works on any firmware. Alias shim only mirrors the RATE form (same unit
  // deg/s); ACC must be edited under whichever name the FC actually streams.
  const params = arduplaneMetadata.parameters
  for (const id of ['Q_A_RATE_RLL_MAX', 'Q_A_RATE_PIT_MAX', 'Q_A_RATE_YAW_MAX']) {
    assert.ok(params[id], `${id} present`)
    assert.match(params[id]?.label ?? '', /legacy/i)
  }
  for (const id of ['Q_A_RATE_R_MAX', 'Q_A_RATE_P_MAX', 'Q_A_RATE_Y_MAX']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'deg/s')
    assert.equal(params[id]?.maximum, 1080)
  }
  for (const id of ['Q_A_ACCEL_R_MAX', 'Q_A_ACCEL_P_MAX', 'Q_A_ACCEL_Y_MAX']) {
    assert.ok(params[id], `${id} present (legacy)`)
    assert.equal(params[id]?.unit, 'cd/s²')
  }
  for (const id of ['Q_A_ACC_R_MAX', 'Q_A_ACC_P_MAX', 'Q_A_ACC_Y_MAX']) {
    assert.ok(params[id], `${id} present (modern)`)
    assert.equal(params[id]?.unit, 'deg/s²')
  }
  // Bound difference reflects the unit change cd -> deg (factor 100).
  assert.equal(params.Q_A_ACCEL_R_MAX?.maximum, 180000)
  assert.equal(params.Q_A_ACC_R_MAX?.maximum, 1800)
})

test('arduplane catalog covers BOTH legacy LIM_*_CD and modern *_DEG attitude-limit names', () => {
  // ArduPlane 4.5+ renamed the attitude-limit params from centidegrees
  // (LIM_ROLL_CD / LIM_PITCH_MAX / LIM_PITCH_MIN) to degrees
  // (ROLL_LIMIT_DEG / PTCH_LIM_MAX_DEG / PTCH_LIM_MIN_DEG). Catalog both so
  // the curated UI works on any firmware version. Alias shim deliberately
  // does NOT mirror these — the unit changed (cd -> deg) and mirroring the
  // raw value would display 100x wrong.
  const params = arduplaneMetadata.parameters
  for (const id of ['LIM_ROLL_CD', 'LIM_PITCH_MAX', 'LIM_PITCH_MIN']) {
    assert.ok(params[id], `${id} present`)
    assert.match(params[id]?.label ?? '', /legacy/i, `${id} label flags it as legacy`)
  }
  for (const id of ['ROLL_LIMIT_DEG', 'PTCH_LIM_MAX_DEG', 'PTCH_LIM_MIN_DEG']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'deg', `${id} unit is deg, not cd`)
  }
  // Spot-check the bounds reflect the unit difference (90 deg vs 9000 cd).
  assert.equal(params.LIM_ROLL_CD?.maximum, 9000)
  assert.equal(params.ROLL_LIMIT_DEG?.maximum, 90)
})

test('catalog flags removed-on-modern-firmware passthrough entries (ARMING_REQUIRE on Copter, RC_SPEED on Plane)', () => {
  // Defensive catalog entries for params that were removed/renamed in modern
  // firmware but still appear under their old name on older builds. Each
  // entry must be labelled "(legacy)" so the curated UI signals to the
  // operator that the field will be empty on a modern FC, not that the
  // metadata is broken.
  //
  //   Copter ARMING_REQUIRE   removed >=4.0 (motors always require arming)
  //   Plane  RC_SPEED         renamed -> SERVO_RATE (narrower bounds, no alias)
  //
  // FS_SHORT_TIMEOUT was previously thought to have been retired in 4.5, but
  // live-FC verification on an ArduPlane (2026-05-28) showed it still
  // streamed — the catalog entry now carries no "(legacy)" tag.
  const cop = arducopterMetadata.parameters
  const pln = arduplaneMetadata.parameters
  assert.ok(cop.ARMING_REQUIRE, 'Copter ARMING_REQUIRE present')
  assert.match(cop.ARMING_REQUIRE?.label ?? '', /legacy/i)
  assert.ok(pln.RC_SPEED, 'Plane RC_SPEED present')
  assert.match(pln.RC_SPEED?.label ?? '', /legacy/i)
  // FS_SHORT_TIMEOUT must STAY in the catalog (it still ships on Plane stable)
  // but must NOT wear a "(legacy)" tag — verified on a real Plane.
  assert.ok(pln.FS_SHORT_TIMEOUT, 'Plane FS_SHORT_TIMEOUT present')
  assert.doesNotMatch(pln.FS_SHORT_TIMEOUT?.label ?? '', /legacy/i, 'FS_SHORT_TIMEOUT is NOT legacy (still streams on real Plane 2026-05-28)')
})

test('arduplane catalog covers BOTH legacy Q_ANGLE_MAX (cdeg) and modern Q_A_ANGLE_MAX (deg) QuadPlane lean-angle rename', () => {
  // ArduPlane 4.5 renamed the QuadPlane max-lean-angle param AND switched
  // the unit cdeg -> deg (factor 100), mirroring the Copter ANGLE_MAX ->
  // ATC_ANGLE_MAX rename. Catalog both forms with their own units. Alias
  // shim deliberately omitted — a raw value mirror would be 100x off.
  const params = arduplaneMetadata.parameters
  assert.equal(params.Q_ANGLE_MAX?.unit, 'cdeg')
  assert.match(params.Q_ANGLE_MAX?.label ?? '', /legacy/i)
  assert.equal(params.Q_ANGLE_MAX?.maximum, 8000)
  assert.equal(params.Q_A_ANGLE_MAX?.unit, 'deg')
  assert.doesNotMatch(params.Q_A_ANGLE_MAX?.label ?? '', /legacy/i)
  assert.equal(params.Q_A_ANGLE_MAX?.maximum, 80)
})

test('arducopter catalog covers BOTH legacy SYSID_* / MODE_CH and modern MAV_* / FLTMODE_CH identifier renames', () => {
  // ArduCopter 4.5+ renamed the MAVLink identifiers and the flight-mode
  // channel param. Same range (1..255 for SYSID; channel for MODE_CH) and
  // no unit change, so the runtime alias shim mirrors raw values between
  // them. Catalog keeps both forms; both must have identical ranges for
  // the alias-safety invariant to hold.
  const params = arducopterMetadata.parameters
  // SYSID rename is master-only as of stable 4.6 (verified on a real
  // Radix 2 HD 2026-05-27 — FC streamed SYSID_THISMAV / SYSID_MYGCS, NOT
  // the MAV_* forms). Stable-side entries carry no "(legacy)" tag — the
  // forward-readiness counterparts wear "(master)" instead.
  for (const id of ['SYSID_THISMAV', 'SYSID_MYGCS']) {
    assert.ok(params[id], `${id} present`)
    assert.doesNotMatch(params[id]?.label ?? '', /legacy/i, `${id} is stable, must NOT say legacy`)
  }
  for (const id of ['MAV_SYSID', 'MAV_GCS_SYSID']) {
    assert.ok(params[id], `${id} present`)
    assert.match(params[id]?.label ?? '', /master/i, `${id} is master-only, must say master`)
  }
  // MODE_CH -> FLTMODE_CH already shipped (verified — FC streams FLTMODE_CH only).
  assert.ok(params.MODE_CH, 'MODE_CH present')
  assert.match(params.MODE_CH?.label ?? '', /legacy/i, 'MODE_CH must say legacy (rename has shipped)')
  assert.ok(params.FLTMODE_CH, 'FLTMODE_CH present')
  assert.doesNotMatch(params.FLTMODE_CH?.label ?? '', /legacy/i)
  // Range invariants — alias is only safe iff both forms share ranges.
  assert.equal(params.SYSID_THISMAV?.maximum, params.MAV_SYSID?.maximum)
  assert.equal(params.SYSID_THISMAV?.minimum, params.MAV_SYSID?.minimum)
  assert.equal(params.SYSID_MYGCS?.maximum, params.MAV_GCS_SYSID?.maximum)
  assert.equal(params.SYSID_MYGCS?.minimum, params.MAV_GCS_SYSID?.minimum)
  assert.equal(params.MODE_CH?.maximum, params.FLTMODE_CH?.maximum)
  assert.equal(params.MODE_CH?.minimum, params.FLTMODE_CH?.minimum)
})

test('arducopter catalog covers calibration-output and 4.5+ GPS antenna params', () => {
  // Real-FC audit follow-up: the curated catalog must surface the values the
  // calibration flows write (so the operator can verify a cal landed plausible
  // numbers) and the new per-instance GPS antenna-position params introduced
  // in ArduPilot 4.5+. These have no legacy equivalents and previously fell
  // through to the raw Parameters tab without metadata.
  const params = arducopterMetadata.parameters
  // Level cal output
  assert.equal(params.AHRS_TRIM_X?.unit, 'rad')
  assert.equal(params.AHRS_TRIM_Y?.unit, 'rad')
  assert.ok(params.AHRS_TRIM_X?.notes?.some((note) => /level calibration/i.test(note)))
  // Primary compass cal output
  assert.equal(params.COMPASS_OFS_X?.unit, 'mGauss')
  assert.equal(params.COMPASS_OFS_Y?.unit, 'mGauss')
  assert.equal(params.COMPASS_OFS_Z?.unit, 'mGauss')
  // 4.5+ GPS antenna position + delay
  assert.equal(params.GPS1_POS_X?.unit, 'm')
  assert.equal(params.GPS1_POS_Y?.unit, 'm')
  assert.equal(params.GPS1_POS_Z?.unit, 'm')
  assert.equal(params.GPS2_POS_X?.unit, 'm')
  assert.equal(params.GPS1_DELAY_MS?.unit, 'ms')
  assert.equal(params.GPS1_DELAY_MS?.maximum, 250)
})

test('ardurover catalog flags Rover 4.3 nav-refactor casualties (WP_OVERSHOOT, NAVL1_*) and keeps TURN_MAX_G / ATC_TURN_MAX_G in sync', () => {
  // Rover 4.3 retired the L1 nav controller (NAVL1_*) and the overshoot-permissive
  // cornering knob (WP_OVERSHOOT) in favor of the s-curve kinematic path planner
  // (WP_ACCEL/WP_JERK). TURN_MAX_G was rehomed under AR_AttitudeControl as
  // ATC_TURN_MAX_G — same unit (g) and same range, so this one is alias-safe.
  const params = arduroverMetadata.parameters
  for (const id of ['WP_OVERSHOOT', 'TURN_MAX_G', 'NAVL1_PERIOD', 'NAVL1_DAMPING', 'NAVL1_XTRACK_I']) {
    assert.ok(params[id], `${id} present`)
    assert.match(params[id]?.label ?? '', /legacy/i, `${id} label must include "legacy"`)
  }
  assert.ok(params.ATC_TURN_MAX_G, 'ATC_TURN_MAX_G present')
  // Modern entry must NOT be labelled legacy.
  assert.doesNotMatch(params.ATC_TURN_MAX_G?.label ?? '', /legacy/i)
  // Range invariant — alias-safe iff both forms share the same range.
  assert.equal(params.TURN_MAX_G?.maximum, params.ATC_TURN_MAX_G?.maximum)
  assert.equal(params.TURN_MAX_G?.minimum, params.ATC_TURN_MAX_G?.minimum)
})

test('ardusub catalog covers BOTH legacy WPNAV_(SPEED|ACCEL|RADIUS) and modern WP_(SPD|ACC|RADIUS_M) cm->m renames', () => {
  // ArduSub 4.5+ renamed the waypoint nav family in lock-step with Plane Q_WP_*
  // — name shortened AND unit switched cm-based -> m-based (factor 100).
  // Catalog both forms with their own units. Alias shim deliberately NOT
  // wired up — a raw value mirror would be 100x off.
  const params = ardusubMetadata.parameters
  for (const id of ['WPNAV_SPEED', 'WPNAV_SPEED_UP', 'WPNAV_SPEED_DN']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'cm/s')
    assert.match(params[id]?.label ?? '', /legacy/i)
  }
  assert.equal(params.WPNAV_ACCEL?.unit, 'cm/s²')
  assert.equal(params.WPNAV_RADIUS?.unit, 'cm')
  for (const id of ['WP_SPD', 'WP_SPD_UP', 'WP_SPD_DN']) {
    assert.ok(params[id], `${id} present`)
    assert.equal(params[id]?.unit, 'm/s')
  }
  assert.equal(params.WP_ACC?.unit, 'm/s²')
  assert.equal(params.WP_RADIUS_M?.unit, 'm')
  // Factor-100 bound shift is the safety-critical invariant.
  assert.equal(params.WPNAV_SPEED?.maximum, 1000)
  assert.equal(params.WP_SPD?.maximum, 20)
})

test('arducopter catalog covers BOTH stable ANGLE_MAX / ATC_ACCEL_*_MAX and forward-readiness ATC_ANGLE_MAX / ATC_ACC_*_MAX', () => {
  // ArduPilot master renamed the max-lean-angle and angular-accel limits
  // AND switched cdeg/cd-s² -> deg/deg-s² (factor 100), but the rename has
  // NOT yet shipped in stable. Verified on a real Radix 2 HD running 4.6.3
  // on 2026-05-27 — FC streamed ANGLE_MAX (cdeg) and ATC_ACCEL_R/P/Y_MAX
  // (cd/s²), NOT the ATC_ANGLE_MAX / ATC_ACC_* forms.
  //
  // So the stable-side entries are NOT tagged "(legacy)" — they ARE the
  // current names. The forward-readiness counterparts carry "(master)"
  // instead. Alias shim deliberately omitted across this whole family —
  // raw mirror would be 100x off across the unit shift.
  //
  // Pre-existing bug also fixed: the cd/s² entries used to claim unit
  // "deg/s²" with cd/s² bounds (1000..220000) — now correctly "cd/s²".
  const params = arducopterMetadata.parameters
  // Stable (currently shipping)
  assert.equal(params.ANGLE_MAX?.unit, 'cdeg')
  assert.doesNotMatch(params.ANGLE_MAX?.label ?? '', /legacy/i)
  assert.equal(params.ANGLE_MAX?.maximum, 8000)
  for (const id of ['ATC_ACCEL_R_MAX', 'ATC_ACCEL_P_MAX', 'ATC_ACCEL_Y_MAX']) {
    assert.equal(params[id]?.unit, 'cd/s²', `${id} unit must be cd/s²`)
    assert.doesNotMatch(params[id]?.label ?? '', /legacy/i, `${id} is stable, must NOT say legacy`)
    assert.equal(params[id]?.maximum, 220000)
  }
  // Master / forward-readiness
  assert.equal(params.ATC_ANGLE_MAX?.unit, 'deg')
  assert.match(params.ATC_ANGLE_MAX?.label ?? '', /master/i)
  assert.equal(params.ATC_ANGLE_MAX?.maximum, 80)
  assert.equal(params.ATC_ACC_R_MAX?.unit, 'deg/s²')
  assert.match(params.ATC_ACC_R_MAX?.label ?? '', /master/i)
  assert.equal(params.ATC_ACC_R_MAX?.maximum, 1800)
  assert.equal(params.ATC_ACC_P_MAX?.maximum, 1800)
  assert.equal(params.ATC_ACC_Y_MAX?.maximum, 720)
})

test('serial-port template does NOT emit SERIAL0_OPTIONS on any vehicle (Console UART has no OPTIONS register)', () => {
  // Real ArduPilot firmware only exposes _OPTIONS on SERIAL1..N. Emitting
  // SERIAL0_OPTIONS from the catalog template surfaces a ghost entry under
  // the raw Parameters tab that never matches anything the FC streams.
  // Regression sentinel — keep _OPTIONS gated to portNumber > 0 in all 4
  // per-vehicle templates.
  for (const meta of [arducopterMetadata, arduplaneMetadata, arduroverMetadata, ardusubMetadata]) {
    assert.equal(meta.parameters?.SERIAL0_OPTIONS, undefined, `${meta.firmware} must not emit SERIAL0_OPTIONS`)
    // Sanity: SERIAL1_OPTIONS / SERIAL1_PROTOCOL / SERIAL0_PROTOCOL still exist.
    assert.ok(meta.parameters?.SERIAL1_OPTIONS, `${meta.firmware} SERIAL1_OPTIONS present`)
    assert.ok(meta.parameters?.SERIAL0_PROTOCOL, `${meta.firmware} SERIAL0_PROTOCOL present`)
    assert.ok(meta.parameters?.SERIAL0_BAUD, `${meta.firmware} SERIAL0_BAUD present`)
  }
})

test('Plane failsafe formatting stays user-facing', () => {
  // FS_LONG_ACTN (ArduPlane/Parameters.cpp @Param: FS_LONG_ACTN @Values)
  assert.equal(formatArduplaneLongFailsafeAction(0), 'Continue')
  assert.equal(formatArduplaneLongFailsafeAction(1), 'RTL')
  assert.equal(formatArduplaneLongFailsafeAction(2), 'Glide')
  assert.equal(formatArduplaneLongFailsafeAction(3), 'Deploy Parachute')
  assert.equal(formatArduplaneLongFailsafeAction(4), 'Auto')
  assert.equal(formatArduplaneLongFailsafeAction(5), 'AUTOLAND')
  assert.equal(formatArduplaneLongFailsafeAction(undefined), 'Unknown')
  assert.equal(formatArduplaneLongFailsafeAction(99), 'Action 99')

  // FS_SHORT_ACTN (ArduPlane/Parameters.cpp @Param: FS_SHORT_ACTN @Values):
  // 0:Circle/no change, 1:Circle, 2:FBWA at zero throttle, 3:Disable, 4:FBWB
  assert.equal(formatArduplaneShortFailsafeAction(0), 'Circle / no change (if already in Auto, Guided or Loiter)')
  assert.equal(formatArduplaneShortFailsafeAction(1), 'Circle')
  assert.equal(formatArduplaneShortFailsafeAction(2), 'FBWA at zero throttle')
  assert.equal(formatArduplaneShortFailsafeAction(3), 'Disable')
  assert.equal(formatArduplaneShortFailsafeAction(4), 'FBWB')
  assert.equal(formatArduplaneShortFailsafeAction(undefined), 'Unknown')
  assert.equal(formatArduplaneShortFailsafeAction(99), 'Action 99')
})
