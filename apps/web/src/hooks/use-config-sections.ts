// Config-tab section catalog factored out of App.tsx. The Config view renders a
// BetaFlight-style grab-bag of editable parameter sections; this hook builds the
// id-keyed parameter map, the (mostly static, vehicle-aware) section definitions,
// and the membership predicate that the single "Apply Config" press uses to pull
// every staged config-section field. Output values are byte-identical to the
// inline App.tsx originals.

import { useCallback, useMemo } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { ConfigSection } from '../views/Config'

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
  // Fast loop rate card. Pilot-rate params are always present on Copter, but
  // gate on PILOT_Y_RATE too for symmetry / partial param tables.
  const hasFastRate = configParametersById.has('FSTRATE_ENABLE')
  const hasPilotRates = configParametersById.has('PILOT_Y_RATE')
  // Frame class/type — present on Copter (and Heli); Plane/Rover use different
  // frame params, so gate on FRAME_CLASS actually being in the synced tree.
  const hasFrame = configParametersById.has('FRAME_CLASS')
  // Max lean angle was renamed ANGLE_MAX (cdeg) -> ATC_ANGLE_MAX (deg) in
  // ArduPilot 4.7. Bind the field to whichever the FC actually streams so it
  // stops reading "(not reported)" on 4.7+.
  const leanAngleParamId = configParametersById.has('ATC_ANGLE_MAX') ? 'ATC_ANGLE_MAX' : 'ANGLE_MAX'
  const leanAngleUnit = leanAngleParamId === 'ATC_ANGLE_MAX' ? 'deg' : 'cdeg'
  const leanAngleDigits = leanAngleParamId === 'ATC_ANGLE_MAX' ? 1 : 0
  const configSections: readonly ConfigSection[] = useMemo(() => [
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
      description: 'AHRS_ORIENTATION dropdown + per-axis trims (radians). Pick the FC mounting orientation; trims fine-tune level after accel calibration.',
      fields: [
        { paramId: 'AHRS_ORIENTATION', label: 'Orientation', digits: 0 },
        { paramId: 'AHRS_TRIM_X', label: 'Roll trim', unit: 'rad', digits: 4 },
        { paramId: 'AHRS_TRIM_Y', label: 'Pitch trim', unit: 'rad', digits: 4 },
        { paramId: 'AHRS_TRIM_Z', label: 'Yaw trim', unit: 'rad', digits: 4 }
      ]
    },
    {
      id: 'esc-dshot',
      title: 'ESC & DShot',
      description: 'Output protocol and DShot/BLHeli behavior — set this before motor testing. Bidirectional DShot needs a DShot protocol; check it on the first 4 outputs (some boards do 8) and enable BLHeli auto. Reverse a motor here instead of swapping wires.',
      fields: [
        { paramId: 'MOT_PWM_TYPE', label: 'ESC protocol', digits: 0 },
        { paramId: 'SERVO_DSHOT_RATE', label: 'DShot rate', digits: 0 },
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
    // Pilot rates — the same curated knobs the Tuning tab exposes
    // (PILOT_Y_RATE/EXPO yaw stick shaping, ANGLE_MAX lean limit, ACRO_*
    // acro rates/expo), mirrored here so they can be reviewed alongside the
    // rest of the config. Copter-only; ACRO_*/PILOT_Y_* are not Plane/Rover
    // params.
    ...(activeVehicle === 'ArduCopter' && hasPilotRates
      ? [
          {
            id: 'pilot-rates',
            title: 'Pilot rates',
            description: 'Stick-response shaping: yaw rate/expo, the max lean angle, and acro roll/pitch/yaw rates + expo. Mirrored from the Tuning tab for review alongside the rest of the config.',
            fields: [
              { paramId: 'PILOT_Y_RATE', label: 'Pilot yaw rate', unit: 'deg/s', digits: 0 },
              { paramId: 'PILOT_Y_EXPO', label: 'Pilot yaw expo', digits: 2 },
              { paramId: leanAngleParamId, label: 'Max lean angle', unit: leanAngleUnit, digits: leanAngleDigits },
              { paramId: 'ACRO_RP_RATE', label: 'Acro roll/pitch rate', unit: 'deg/s', digits: 0 },
              { paramId: 'ACRO_Y_RATE', label: 'Acro yaw rate', unit: 'deg/s', digits: 0 },
              { paramId: 'ACRO_RP_EXPO', label: 'Acro roll/pitch expo', digits: 2 },
              { paramId: 'ACRO_Y_EXPO', label: 'Acro yaw expo', digits: 2 }
            ]
          }
        ]
      : []),
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
      description: 'RC link and signal settings, mirrored from the Receiver tab so they can be reviewed alongside the rest of the config. Use the Receiver tab for the guided stage/review signal-setup flow; RSSI source, mode channel, RC options, and accepted RC protocols are all here too.',
      fields: [
        { paramId: 'RSSI_TYPE', label: 'RSSI source', digits: 0 },
        { paramId: 'RSSI_CHANNEL', label: 'RSSI channel', digits: 0 },
        // Mode channel param is vehicle-specific: Rover uses MODE_CH, Copter/
        // Plane use FLTMODE_CH, and Sub has no RC mode channel (button modes).
        ...(activeVehicle === 'ArduSub'
          ? []
          : [{ paramId: activeVehicle === 'ArduRover' ? 'MODE_CH' : 'FLTMODE_CH', label: 'Flight-mode channel', digits: 0 }]),
        { paramId: 'RC_OPTIONS', label: 'RC options', digits: 0 },
        // RC protocol bitmask moves to the BOTTOM of the section so the
        // higher-frequency knobs (RSSI / mode channel / RC options) stay
        // above the fold — RC_PROTOCOLS is set once at install and rarely
        // touched afterwards.
        { paramId: 'RC_PROTOCOLS', label: 'RC protocols (type)', digits: 0 }
      ]
    },
    {
      id: 'arming',
      title: 'Arming behavior',
      description: 'Pre-arm checks bitmask + which inputs are allowed to arm. ARMING_CHECK = 1 enables all checks; specific bits disable individual checks.',
      fields: [
        { paramId: 'ARMING_CHECK', label: 'Check bitmask', digits: 0 },
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
      id: 'beeper',
      title: 'Beeper / notification',
      description: 'Buzzer + LED notification volumes. Same params are also reachable from Servos → Peripherals; surfaced here for BF parity.',
      fields: [
        { paramId: 'NTF_BUZZ_VOLUME', label: 'Buzzer volume', unit: '%', digits: 0 },
        { paramId: 'NTF_BUZZ_TYPES', label: 'Buzzer types', digits: 0 },
        { paramId: 'NTF_LED_BRIGHT', label: 'LED brightness', digits: 0 }
      ]
    },
    {
      id: 'camera-trigger',
      title: 'Camera trigger',
      description: 'Triggered camera shutter behavior — type/duration/auto. Pair with a SERVOn_FUNCTION = 10 (Camera Trigger) output.',
      fields: [
        { paramId: 'CAM_TRIGG_TYPE', label: 'Trigger type', digits: 0 },
        { paramId: 'CAM_DURATION', label: 'Pulse duration', unit: 's·10', digits: 0 },
        { paramId: 'CAM_AUTO_ONLY', label: 'Auto only', digits: 0 },
        { paramId: 'CAM_SERVO_ON', label: 'Servo ON PWM', unit: 'us', digits: 0 },
        { paramId: 'CAM_SERVO_OFF', label: 'Servo OFF PWM', unit: 'us', digits: 0 }
      ]
    },
    // Statistics (STAT_*) moved to the Setup view's side panel — lifetime
    // counters read better next to the live instruments than buried in the
    // Config grab-bag.
  ], [activeVehicle, hasFastRate, hasPilotRates, hasFrame, leanAngleParamId, leanAngleUnit, leanAngleDigits])
  // The Config scope covers every editable section's paramId set —
  // staged drafts in any of them apply through a single "Apply Config"
  // press. STAT_* + any other readOnly-section ids are deliberately
  // excluded so a misclick on a read-only row never costs anything.
  // (The draft pool itself is selected later, after parameterDraftEntries
  // is declared — declaration order forced by the existing layout.)
  const isConfigParamId = useCallback((paramId: string): boolean => {
    return configSections.some(
      (section) => !section.readOnly && section.fields.some((field) => field.paramId === paramId)
    )
  }, [configSections])

  return { configParametersById, configSections, isConfigParamId }
}
