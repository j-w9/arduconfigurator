// Config-tab section catalog factored out of App.tsx. The Config view renders a
// BetaFlight-style grab-bag of editable parameter sections; this hook builds the
// id-keyed parameter map, the (mostly static, vehicle-aware) section definitions,
// and the membership predicate that the single "Apply Config" press uses to pull
// every staged config-section field. Output values are byte-identical to the
// inline App.tsx originals.

import { useCallback, useMemo } from 'react'

import { firmwareVersionAtLeast, type ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { ConfigCategoryId, ConfigSection } from '../views/Config'

// Categories that render on the PERIPHERALS tab instead of Config. Both tabs
// are ConfigView instances over this one section list; membership here is what
// decides which half a section lands in, so a section moves between tabs by
// changing its category and nothing else.
export const PERIPHERAL_CATEGORY_IDS: readonly ConfigCategoryId[] = [
  'gps',
  'compass',
  'gimbal',
  'flow-lidar',
  'alerts',
  'relays'
]

function isPeripheralCategory(category: ConfigCategoryId | undefined): boolean {
  return category !== undefined && PERIPHERAL_CATEGORY_IDS.includes(category)
}

// Which top-tab group each section belongs to. Sections not listed fall back to
// 'system' (the catch-all), so a new section is never orphaned off the tabs.
const CATEGORY_BY_SECTION: Record<string, ConfigCategoryId> = {
  frame: 'airframe',
  'board-orientation': 'airframe',
  'esc-dshot': 'airframe',
  // Compass is attached hardware (very often an external mag on the GPS mast),
  // so it moved with GPS onto the Peripherals tab.
  compass: 'compass',
  // Scheduler and IMU settings are SYSTEM settings, not sensor setup.
  //
  // "System rates" is the main (PID) loop frequency, the gyro update rate and
  // the fast-sample mask — how hard the flight controller runs, which is the
  // same kind of decision as logging or board identity. Field report asked for
  // these under System, and the Sensors tab is becoming Peripherals (attached
  // hardware: GPS, compass, flow, lidar, gimbal), where an onboard IMU and a
  // scheduler rate plainly do not belong.
  'active-imu': 'system',
  'system-rates': 'system',
  'fast-loop-rate': 'system',
  gps: 'gps',
  'receiver-signal': 'rc',
  arming: 'arming',
  identity: 'system',
  logging: 'system',
  // A triggered camera is attached hardware, and it sits beside the mount that
  // carries it: Peripherals ▸ Camera & Gimbal.
  'camera-trigger': 'gimbal'
}

// Rarely-touched fields folded into each card's "Advanced" disclosure, so a card
// leads with the knobs an operator actually reaches for. Everything not listed
// stays in the always-visible common set.
//
// Field feedback: this was folding away far too much. The disclosure mechanism
// is worth keeping — some of these genuinely are set-once-and-forget — but the
// bar is now "an operator would have to go looking for this", not "it isn't one
// of the first two knobs". Notably RC and Arming are fully visible (an operator
// tuning a radio needs the protocol and options in front of them), and the
// logging + gyro-rate settings are visible because they are routinely changed
// per-build rather than once at bring-up.
const ADVANCED_FIELDS: Record<string, readonly string[]> = {
  compass: ['COMPASS_AUTO_ROT', 'COMPASS_DISBLMSK'],
  'esc-dshot': ['SERVO_BLH_POLES', 'SERVO_BLH_BDMASK', 'SERVO_BLH_RVMASK'],
  // INS_GYRO_RATE moved out: it is a selectable per-build choice (and the
  // field report asked for it directly under Sensors).
  'system-rates': ['INS_FAST_SAMPLE'],
  'fast-loop-rate': ['FSTRATE_DIV'],
  'active-imu': [],
  gps: ['GPS_GNSS_MODE'],
  // RC + Arming: everything visible, per the field report.
  'receiver-signal': [],
  arming: [],
  identity: ['SYSID_MYGCS', 'BRD_BOOT_DELAY'],
  // LOG_DISARMED / LOG_REPLAY are routinely set per-build (LOG_DISARMED=2 +
  // LOG_REPLAY=1 is a common "full logs" pairing), so they lead the card.
  logging: ['LOG_BITMASK'],
  // Camera: everything visible, same call as RC and Arming above. Folding four
  // of the five fields left the card showing only the trigger type — an
  // operator wiring a shutter needs the pulse width and the servo endpoints in
  // front of them, and the card is `wide`, so there is room to show them.
  'camera-trigger': []
}

// Tag a built section with its category + which of its fields are advanced.
// Centralised here so the section definitions below stay declarative.
function categorize(section: ConfigSection): ConfigSection {
  const advanced = ADVANCED_FIELDS[section.id]
  return {
    ...section,
    category: CATEGORY_BY_SECTION[section.id] ?? 'system',
    fields: advanced
      ? section.fields.map((field) => (advanced.includes(field.paramId) ? { ...field, advanced: true } : field))
      : section.fields
  }
}

export function useConfigSections(snapshot: ConfiguratorSnapshot) {
  const activeVehicle = snapshot.vehicle?.vehicle
  const configParametersById = useMemo(
    () => new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter])),
    [snapshot.parameters]
  )
  // The fast-rate PID thread (FSTRATE_*) is a Copter feature, but it is also a
  // build-time option — plenty of Copter builds (e.g. the RADIX 2 HD) compile
  // without it and never stream FSTRATE_ENABLE. Gate the section on the param
  // actually being present so those FCs don't render an empty "(not reported)"
  // Fast loop rate card.
  const hasFastRate = configParametersById.has('FSTRATE_ENABLE')
  // Compass section — gate on COMPASS_USE (present whenever a compass subsystem
  // is compiled in). Extra compasses / the disable mask only render when the FC
  // actually reports them, so a single-compass board stays uncluttered.
  const hasCompass = configParametersById.has('COMPASS_USE')
  // Frame class/type — present on Copter (and Heli); Plane/Rover use different
  // frame params, so gate on FRAME_CLASS actually being in the synced tree.
  const hasFrame = configParametersById.has('FRAME_CLASS')
  // Pre-arm checks bitmask: ArduPilot 4.7 replaced ARMING_CHECK (checks to
  // PERFORM, with an "All" bit) with ARMING_SKIPCHK (checks to SKIP, inverted,
  // no "All"; default 0 = run everything). Can't be aliased — the meaning
  // inverts — so detect the firmware version and bind the right param, falling
  // back to which one the FC actually streams when the version is unknown.
  const armingIsSkip =
    firmwareVersionAtLeast(snapshot.hardware.board?.firmwareVersionParts, 4, 7) ??
    configParametersById.has('ARMING_SKIPCHK')
  const armingChecksParamId = armingIsSkip ? 'ARMING_SKIPCHK' : 'ARMING_CHECK'
  const armingChecksLabel = armingIsSkip ? 'Checks to skip' : 'Check bitmask'
  const armingDescription = armingIsSkip
    ? 'Pre-arm checks to skip + which inputs may arm. ARMING_SKIPCHK = 0 runs every check (recommended); set bits skip individual checks (ArduPilot 4.7+).'
    : 'Pre-arm checks bitmask + which inputs are allowed to arm. ARMING_CHECK "All checks" runs every check; clear it to disable individual checks.'
  const configSections: readonly ConfigSection[] = useMemo(() => ([
    ...(hasFrame
      ? [
          {
            id: 'frame',
            title: 'Frame',
            description:
              'Airframe geometry. FRAME_CLASS picks the motor count/layout family (Quad, Hexa, Y6, Octa, …) and FRAME_TYPE the arrangement (X, Plus, V, H, …). Changing these restructures the motor outputs — reboot and re-verify motor order/spin before flying.',
            fields: [
              { paramId: 'FRAME_CLASS', label: 'Frame class', digits: 0 },
              { paramId: 'FRAME_TYPE', label: 'Frame type', digits: 0 }
            ]
          }
        ]
      : []),
    {
      id: 'board-orientation',
      title: 'Board orientation',
      description: 'Which way the flight controller is mounted relative to the airframe.',
      // The AHRS_TRIM_X/Y/Z trims used to sit here behind Advanced. They are
      // OUTPUTS of level calibration, not settings: Calibration writes them, and
      // an operator who wants a different value re-levels rather than typing
      // radians. AHRS_TRIM_Z was never even that — ArduPilot documents it as
      // "@Description: Not Used" (AP_AHRS.cpp) with no @User line at all.
      // Offering three number fields invited hand-editing a calibration result,
      // which is how a vehicle ends up flying with a trim nobody can explain.
      // They remain reachable in the raw Parameters tab for anyone who needs
      // them.
      fields: [{ paramId: 'AHRS_ORIENTATION', label: 'Orientation', digits: 0 }]
    },
    ...(hasCompass
      ? [
          {
            id: 'compass',
            title: 'Compass',
            description:
              'Which compasses to use for yaw, how the primary external compass is mounted, and (advanced) which driver types to block. ArduPilot auto-detects compasses — internal ones follow the board orientation; an external one uses its own orientation below.',
            fields: [
              { paramId: 'COMPASS_USE', label: 'Use compass 1', digits: 0 },
              ...(configParametersById.has('COMPASS_USE2')
                ? [{ paramId: 'COMPASS_USE2', label: 'Use compass 2', digits: 0 }]
                : []),
              ...(configParametersById.has('COMPASS_USE3')
                ? [{ paramId: 'COMPASS_USE3', label: 'Use compass 3', digits: 0 }]
                : []),
              { paramId: 'COMPASS_AUTODEC', label: 'Auto declination', digits: 0 },
              { paramId: 'COMPASS_EXTERNAL', label: 'Compass 1 mounting', digits: 0 },
              { paramId: 'COMPASS_ORIENT', label: 'Compass 1 orientation', digits: 0 },
              { paramId: 'COMPASS_AUTO_ROT', label: 'Auto-check orientation', digits: 0 },
              ...(configParametersById.has('COMPASS_DISBLMSK')
                ? [{ paramId: 'COMPASS_DISBLMSK', label: 'Disabled compass drivers', digits: 0 }]
                : [])
            ]
          }
        ]
      : []),
    {
      id: 'esc-dshot',
      title: 'ESC & DShot',
      description: 'Output protocol and DShot/BLHeli behavior — set this before motor testing. DShot rate is a multiple of the main loop rate (System ▸ System rates); the resulting output rate should never fall below 500 Hz. Bidirectional DShot needs a DShot protocol; check it on the first 4 outputs (some boards do 8) and enable BLHeli auto. ESC type must be set (not "None") for reverse/3D DShot commands to be sent at all. Reverse a motor here instead of swapping wires.',
      fields: [
        { paramId: 'MOT_PWM_TYPE', label: 'ESC protocol', digits: 0 },
        // SCHED_LOOP_RATE used to be mirrored here, because DShot rate is a
        // MULTIPLE of it. Field report: it now lives on System (System rates)
        // and having it in two tabs was the confusing part, not the help. The
        // DShot rate row below names the relationship instead.
        { paramId: 'SERVO_DSHOT_RATE', label: 'DShot rate', digits: 0 },
        { paramId: 'SERVO_DSHOT_ESC', label: 'ESC type', digits: 0 },
        { paramId: 'SERVO_BLH_AUTO', label: 'BLHeli auto', digits: 0 },
        { paramId: 'SERVO_BLH_POLES', label: 'Motor poles', digits: 0 },
        { paramId: 'SERVO_BLH_BDMASK', label: 'Bidirectional DShot outputs', digits: 0 },
        { paramId: 'SERVO_BLH_RVMASK', label: 'Reverse motor outputs', digits: 0 }
      ]
    },
    {
      id: 'system-rates',
      title: 'System rates',
      description: 'Main (PID) loop frequency, gyro update rate, and fast-sampling IMU mask. Higher rates cost CPU and need capable hardware; changes take effect after a reboot.',
      fields: [
        { paramId: 'SCHED_LOOP_RATE', label: 'Main loop rate', unit: 'Hz', digits: 0 },
        { paramId: 'INS_GYRO_RATE', label: 'Gyro update rate', digits: 0 },
        { paramId: 'INS_FAST_SAMPLE', label: 'Fast sampling (IMU mask)', digits: 0 }
      ]
    },
    // Fast-rate thread is ArduCopter-only (FSTRATE_* is not exposed on
    // Plane/Rover/Sub upstream). Keep it as its own section so the Copter
    // System Rates card stays uncluttered and non-Copter vehicles don't
    // render a misleading "missing" row.
    ...(activeVehicle === 'ArduCopter' && hasFastRate
      ? [
          {
            id: 'fast-loop-rate',
            title: 'Fast loop rate',
            description: 'Separate fast-rate PID thread (FSTRATE_*). Enables a higher-rate PID loop divided down from the gyro rate. Reboot required.',
            fields: [
              { paramId: 'FSTRATE_ENABLE', label: 'Enable fast rate', digits: 0 },
              { paramId: 'FSTRATE_DIV', label: 'Fast rate divisor', digits: 0 }
            ]
          }
        ]
      : []),
    // Pilot rates (PILOT_Y_RATE/EXPO, the lean-angle limit, ACRO_* rates/expo)
    // used to be mirrored here as a third card on the RC tab. Field report:
    // they read as the FIRST thing on a tab whose job is getting a radio
    // talking, which is the wrong order — and they were only ever a mirror of
    // the Tuning tab, which already renders every one of those params
    // (TUNING_FLIGHT_FEEL_PARAM_IDS + TUNING_ACRO_PARAM_IDS) with sliders,
    // unit handling and the 4.5+/4.7 ANGLE_MAX -> ATC_ANGLE_MAX rename already
    // covered. Stick shaping is a tuning job, so Tuning is the home; the mirror
    // is dropped rather than moved to another Config tab so there is exactly one
    // place these are edited. Nothing became unreachable.
    {
      id: 'active-imu',
      title: 'Active IMU',
      description: 'Which onboard IMUs the EKF/AHRS uses. Disable a noisy or failed IMU here; reboot required. At least one IMU must stay enabled.',
      fields: [
        { paramId: 'INS_USE', label: 'Use IMU 1', digits: 0 },
        { paramId: 'INS_USE2', label: 'Use IMU 2', digits: 0 },
        { paramId: 'INS_USE3', label: 'Use IMU 3', digits: 0 }
      ]
    },
    {
      id: 'gps',
      title: 'GPS behavior',
      description: 'GPS driver type + auto-config + update rate, plus multi-GPS behavior (which receiver is primary and how the FC switches between them).',
      fields: [
        { paramId: 'GPS_TYPE', label: 'GPS type', digits: 0 },
        { paramId: 'GPS_AUTO_CONFIG', label: 'Auto config', digits: 0 },
        { paramId: 'GPS_RATE_MS', label: 'Update rate', unit: 'ms', digits: 0 },
        { paramId: 'GPS_GNSS_MODE', label: 'GNSS mode', digits: 0 },
        { paramId: 'GPS_AUTO_SWITCH', label: 'Auto switch', digits: 0 },
        { paramId: 'GPS_PRIMARY', label: 'Primary GPS', digits: 0 }
      ]
    },
    {
      id: 'receiver-signal',
      title: 'Receiver & signal',
      description: 'RC link and signal settings, mirrored from the Receiver tab so they can be reviewed alongside the rest of the config. Set the accepted RC protocols and RC options first — radio calibration cannot run until the link is actually decoding. Use the Receiver tab for the guided stage/review signal-setup flow; RSSI source and mode channel are here too.',
      fields: [
        // Protocol + options lead the card. Earlier ordering put RC_PROTOCOLS at
        // the BOTTOM on the theory that it is set once at install — but the
        // field report is that radio calibration is impossible until the
        // protocol is right, so the operator who most needs this knob is
        // exactly the one who cannot yet see any RC values on screen. Reading
        // order now matches setup order: make the link decode, then shape it.
        // (Display order only — writes are staged/applied from the draft pool,
        // which is keyed by parameter id and unaffected by card layout.)
        { paramId: 'RC_PROTOCOLS', label: 'RC protocols (type)', digits: 0 },
        // Mode channel param is vehicle-specific: Rover uses MODE_CH, Copter/
        // Plane use FLTMODE_CH, and Sub has no RC mode channel (button modes).
        //
        // Second, not last. RC_OPTIONS is a tall bitmask, so in the card's
        // column flow a trailing field wrapped to the bottom of the first
        // column, under all of it — reported as "a little hidden". It is also
        // the knob an operator reaches for right after the protocol.
        ...(activeVehicle === 'ArduSub'
          ? []
          : [{ paramId: activeVehicle === 'ArduRover' ? 'MODE_CH' : 'FLTMODE_CH', label: 'Flight-mode channel', digits: 0 }]),
        { paramId: 'RC_OPTIONS', label: 'RC options', digits: 0 },
        // One cell, stacked: the channel is only meaningful as a property of
        // the source. Flowing separately put it under the protocol list, four
        // columns from the setting it belongs to.
        { paramId: 'RSSI_TYPE', label: 'RSSI source', digits: 0, group: 'rssi' },
        { paramId: 'RSSI_CHANNEL', label: 'RSSI channel', digits: 0, group: 'rssi' }
      ]
    },
    {
      id: 'arming',
      title: 'Arming behavior',
      description: armingDescription,
      fields: [
        { paramId: armingChecksParamId, label: armingChecksLabel, digits: 0 },
        { paramId: 'ARMING_REQUIRE', label: 'Require arming', digits: 0 },
        { paramId: 'ARMING_RUDDER', label: 'Rudder arm', digits: 0 }
      ]
    },
    {
      id: 'identity',
      title: 'System identity',
      description: 'MAVLink identity. Change SYSID_THISMAV to coordinate a swarm; SYSID_MYGCS pins which GCS is trusted for failsafe.',
      fields: [
        { paramId: 'SYSID_THISMAV', label: 'This system id', digits: 0 },
        { paramId: 'SYSID_MYGCS', label: 'Trusted GCS id', digits: 0 },
        { paramId: 'BRD_BOOT_DELAY', label: 'Boot delay', unit: 'ms', digits: 0 }
      ]
    },
    {
      id: 'logging',
      title: 'Logging',
      description: 'Where (and what) the autopilot writes to the dataflash log. LOG_DISARMED = 1 keeps logging while disarmed for bench debugging.',
      fields: [
        { paramId: 'LOG_BACKEND_TYPE', label: 'Backend', digits: 0 },
        { paramId: 'LOG_BITMASK', label: 'Bitmask', digits: 0 },
        { paramId: 'LOG_DISARMED', label: 'Log while disarmed', digits: 0 },
        { paramId: 'LOG_REPLAY', label: 'Replay log', digits: 0 }
      ]
    },
    {
      id: 'camera-trigger',
      title: 'Camera trigger',
      description: 'Triggered camera shutter behavior — type/duration/auto. Pair with a SERVOn_FUNCTION = 10 (Camera Trigger) output.',
      // Full width, so the five fields flow into columns instead of a tall
      // single-file list with the rest of the row empty. The Camera & Gimbal
      // sub-tab also holds the (wide) metadata-driven gimbal panel, so the
      // one-card `config-grid--wide` path does not apply here.
      wide: true,
      fields: [
        { paramId: 'CAM_TRIGG_TYPE', label: 'Trigger type', digits: 0 },
        { paramId: 'CAM_DURATION', label: 'Pulse duration', unit: 's·10', digits: 0 },
        { paramId: 'CAM_AUTO_ONLY', label: 'Auto only', digits: 0 },
        { paramId: 'CAM_SERVO_ON', label: 'Servo ON PWM', unit: 'µs', digits: 0 },
        { paramId: 'CAM_SERVO_OFF', label: 'Servo OFF PWM', unit: 'µs', digits: 0 }
      ]
    },
    // Statistics (STAT_*) moved to the Setup view's side panel — lifetime
    // counters read better next to the live instruments than buried in the
    // Config grab-bag.
  ] as readonly ConfigSection[]).map(categorize), [
    activeVehicle,
    hasFastRate,
    hasFrame,
    // hasCompass and configParametersById were MISSING here, and it was a real
    // bug, not a tidy-up: the compass card is gated on hasCompass and its extra
    // rows on configParametersById (COMPASS_USE2 / USE3 / DISBLMSK). If the
    // sections were first built before COMPASS_USE had arrived in the sync, the
    // memo never recomputed when it did — every other dependency is stable
    // after connect — so the compass card stayed absent for the whole session.
    // Caught as an intermittently missing Compass sub-tab on Peripherals; the
    // same staleness could drop the card from Config before the move.
    hasCompass,
    configParametersById,
    armingChecksParamId,
    armingChecksLabel,
    armingDescription
  ])
  const configTabSections = useMemo(
    () => configSections.filter((section) => !isPeripheralCategory(section.category)),
    [configSections]
  )
  const peripheralSections = useMemo(
    () => configSections.filter((section) => isPeripheralCategory(section.category)),
    [configSections]
  )
  // The Config scope covers every editable section's paramId set —
  // staged drafts in any of them apply through a single "Apply Config"
  // press. STAT_* + any other readOnly-section ids are deliberately
  // excluded so a misclick on a read-only row never costs anything.
  // (The draft pool itself is selected later, after parameterDraftEntries
  // is declared — declaration order forced by the existing layout.)
  const isConfigParamId = useCallback((paramId: string): boolean => {
    return configTabSections.some(
      (section) => !section.readOnly && section.fields.some((field) => field.paramId === paramId)
    )
  }, [configTabSections])

  // Peripherals applies its own drafts, so a staged GPS change is never
  // swept up by a press of Apply on the Config tab (and vice versa).
  const isPeripheralParamId = useCallback((paramId: string): boolean => {
    return peripheralSections.some(
      (section) => !section.readOnly && section.fields.some((field) => field.paramId === paramId)
    )
  }, [peripheralSections])

  return {
    configParametersById,
    configSections: configTabSections,
    peripheralSections,
    isConfigParamId,
    isPeripheralParamId
  }
}
