export const ARDUCOPTER_FLIGHT_MODE_LABELS: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  7: 'Circle',
  9: 'Land',
  11: 'Drift',
  13: 'Sport',
  14: 'Flip',
  15: 'AutoTune',
  16: 'PosHold',
  17: 'Brake',
  18: 'Throw',
  19: 'Avoid ADS-B',
  20: 'Guided NoGPS',
  21: 'SmartRTL',
  22: 'FlowHold',
  23: 'Follow',
  24: 'ZigZag',
  25: 'SystemID',
  26: 'Heli Autorotate',
  27: 'Auto RTL',
  28: 'Turtle'
}

export const ARDUCOPTER_FRAME_CLASS_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Quad',
  2: 'Hexa',
  3: 'Octa',
  4: 'OctaQuad',
  5: 'Y6',
  6: 'Heli',
  7: 'Tri',
  8: 'SingleCopter',
  9: 'CoaxCopter',
  10: 'BiCopter',
  11: 'Heli Dual',
  12: 'DodecaHexa',
  13: 'HeliQuad',
  14: 'Deca',
  15: 'Scripting Matrix',
  16: '6DoF Scripting',
  17: 'Dynamic Scripting Matrix'
}

export const ARDUCOPTER_FRAME_TYPE_LABELS: Record<number, string> = {
  0: 'Plus',
  1: 'X',
  2: 'V',
  3: 'H',
  4: 'V-Tail',
  5: 'A-Tail',
  10: 'Y6B',
  11: 'Y6F',
  12: 'BetaFlight X',
  13: 'DJI X',
  14: 'Clockwise X',
  15: 'I',
  18: 'BetaFlight X Reversed',
  19: 'Y4'
}

export const ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Land',
  2: 'RTL',
  3: 'SmartRTL or RTL',
  4: 'SmartRTL or Land',
  5: 'Terminate',
  6: 'Auto DO_LAND_START or RTL',
  7: 'Brake or Land'
}

export const ARDUCOPTER_BATTERY_MONITOR_LABELS: Record<number, string> = {
  0: 'Disabled',
  3: 'Analog Voltage Only',
  4: 'Analog Voltage and Current',
  5: 'Solo',
  6: 'Bebop',
  7: 'SMBus-Generic',
  8: 'DroneCAN BatteryInfo',
  9: 'ESC Telemetry',
  10: 'Sum Of Selected Monitors',
  11: 'Fuel Flow',
  12: 'Fuel Level PWM',
  13: 'SMBus SUI3',
  14: 'SMBus SUI6',
  15: 'NeoDesign',
  16: 'SMBus Maxell',
  17: 'Generator Electrical',
  18: 'Generator Fuel',
  19: 'Rotoye',
  20: 'MPPT',
  21: 'INA2XX',
  22: 'LTC2946',
  23: 'Torqeedo',
  24: 'Fuel Level Analog'
}

export const ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS: Record<number, string> = {
  0: 'Raw Voltage',
  1: 'Sag Compensated Voltage'
}

export const ARDUCOPTER_THROTTLE_FAILSAFE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Always RTL',
  2: 'Continue Mission in Auto (removed in 4.0+)',
  3: 'Always Land',
  4: 'SmartRTL or RTL',
  5: 'SmartRTL or Land',
  6: 'Auto DO_LAND_START or RTL',
  7: 'Brake or Land'
}

export const ARDUCOPTER_FS_GCS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Always RTL',
  2: 'Continue Mission in Auto (removed in 4.0+)',
  3: 'SmartRTL or RTL',
  4: 'SmartRTL or Land',
  5: 'Always Land',
  6: 'Auto DO_LAND_START or RTL',
  7: 'Brake or Land'
}

export const ARDUCOPTER_FS_EKF_ACTION_LABELS: Record<number, string> = {
  1: 'Land',
  2: 'AltHold',
  3: 'Land Even In Stabilize'
}

export const ARDUCOPTER_MOT_PWM_TYPE_LABELS: Record<number, string> = {
  0: 'Normal',
  1: 'OneShot',
  2: 'OneShot125',
  3: 'Brushed',
  4: 'DShot150',
  5: 'DShot300',
  6: 'DShot600',
  7: 'DShot1200',
  8: 'PWMRange'
}

// Verbatim from ArduPilot libraries/AP_SerialManager/AP_SerialManager.cpp
// SERIALn_PROTOCOL @Values. Conformance-audit fix: 18 entries previously
// diverged (e.g. 9 read 'Lidar360' — upstream 9 is Rangefinder; 41 read
// 'RangeFinder' — upstream 41 is CoDevESC). This table backs the EDITABLE
// Ports-tab function picker, so a wrong label here writes a wrong
// SERIALn_PROTOCOL number to the FC — keep it byte-faithful to upstream.
export const ARDUCOPTER_SERIAL_PROTOCOL_LABELS: Record<number, string> = {
  [-1]: 'None',
  1: 'MAVLink1',
  2: 'MAVLink2',
  3: 'FrSky D',
  4: 'FrSky SPort',
  5: 'GPS',
  7: 'AlexMos Gimbal',
  8: 'SToRM32 Gimbal',
  9: 'Rangefinder',
  10: 'FrSky SPort Passthrough',
  11: 'Lidar360',
  13: 'Beacon',
  14: 'Volz',
  15: 'SBus Servo Out',
  16: 'ESC Telemetry',
  17: 'Devo Telemetry',
  18: 'OpticalFlow',
  19: 'RobotisServo',
  20: 'NMEA Output',
  21: 'WindVane',
  22: 'SLCAN',
  23: 'RCIN',
  24: 'EFI Serial',
  25: 'LTM',
  26: 'RunCam',
  27: 'HottTelem',
  28: 'Scripting',
  29: 'Crossfire VTX',
  30: 'Generator',
  31: 'Winch',
  32: 'MSP',
  33: 'DJI FPV',
  34: 'Airspeed',
  35: 'ADSB',
  36: 'AHRS',
  37: 'SmartAudio',
  38: 'FETtec OneWire',
  39: 'Torqeedo',
  40: 'AIS',
  41: 'CoDevESC',
  42: 'DisplayPort',
  43: 'MAVLink High Latency',
  44: 'IRC Tramp',
  45: 'DDS XRCE',
  46: 'IMUDATA',
  48: 'PPP',
  49: 'i-BUS Telemetry',
  50: 'IOMCU'
}

export const ARDUCOPTER_SERIAL_BAUD_LABELS: Record<number, string> = {
  1: '1,200',
  2: '2,400',
  4: '4,800',
  9: '9,600',
  19: '19,200',
  38: '38,400',
  57: '57,600',
  111: '111,100',
  115: '115,200',
  230: '230,400',
  256: '256,000',
  460: '460,800',
  500: '500,000',
  921: '921,600',
  1500: '1,500,000',
  2000: '2,000,000',
  // Conformance-audit fix: upstream @Values encodes 12.5 MBaud as the
  // literal coded value 12500000 ('12500000:12.5MBaud'); map_baudrate
  // treats any rate > 2000 as a DIRECT baudrate, so a coded 12500 means
  // 12,500 baud on real ArduPilot — NOT 12.5 MBaud as this table
  // previously claimed.
  12500000: '12,500,000'
}

export const ARDUCOPTER_SERIAL_RTSCTS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled',
  2: 'Auto',
  3: 'RS-485 RTS'
}

// Verbatim from AP_SerialManager.cpp SERIALn_OPTIONS @Bitmask:
//   0:InvertRX, 1:InvertTX, 2:HalfDuplex, 3:SwapTXRX, 4:RX_PullDown,
//   5:RX_PullUp, 6:TX_PullDown, 7:TX_PullUp, 8:RX_NoDMA, 9:TX_NoDMA,
//   10:Don't forward mavlink to/from, 11:DisableFIFO, 12:Ignore Streamrate
// Conformance-audit fix: 11 of 13 bits were previously misaligned (e.g.
// bit 0 was labeled 'Half Duplex' but is InvertRX upstream — ticking it
// killed RX on a normal UART). These back EDITABLE checkboxes in the
// Ports tab, so bit positions must match upstream exactly. Bits 10/12
// moved to MAVn_OPTIONS in ArduPilot >4.7 but remain honored here.
export const ARDUCOPTER_SERIAL_OPTION_BIT_LABELS: Record<number, string> = {
  0: 'Invert RX',
  1: 'Invert TX',
  2: 'Half Duplex',
  3: 'Swap RX/TX',
  4: 'RX Pull-down',
  5: 'RX Pull-up',
  6: 'TX Pull-down',
  7: 'TX Pull-up',
  8: 'RX No DMA',
  9: 'TX No DMA',
  10: 'Disable MAVLink Forwarding',
  11: 'Disable FIFO',
  12: 'Ignore Streamrate'
}

export const ARDUCOPTER_GPS_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Auto',
  2: 'u-blox',
  3: 'SBF',
  4: 'GSOF',
  5: 'NMEA',
  6: 'SiRF',
  7: 'HIL',
  8: 'SwiftNav',
  9: 'DroneCAN',
  10: 'MAV',
  11: 'ERB',
  13: 'Nova',
  14: 'Hemisphere NMEA',
  15: 'u-blox Moving Baseline Base',
  16: 'u-blox Moving Baseline Rover',
  17: 'MSP',
  18: 'AllyStar',
  19: 'ExternalAHRS',
  20: 'NMEA Unicore',
  21: 'Rover Moving Baseline Base',
  22: 'Rover Moving Baseline Rover',
  23: 'Septentrio',
  24: 'Unicore Moving Baseline Base',
  25: 'Unicore Moving Baseline Rover'
}

export const ARDUCOPTER_GPS_AUTO_CONFIG_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Serial GPS Only',
  2: 'Serial + DroneCAN',
  3: 'Clear Non-ArduPilot Config'
}

export const ARDUCOPTER_GPS_AUTO_SWITCH_LABELS: Record<number, string> = {
  0: 'Use Primary',
  1: 'Use Best',
  2: 'Blend',
  4: 'Primary if 3D Fix+'
}

export const ARDUCOPTER_GPS_PRIMARY_LABELS: Record<number, string> = {
  0: 'First GPS',
  1: 'Second GPS'
}

export const ARDUCOPTER_GPS_RATE_MS_LABELS: Record<number, string> = {
  50: '20 Hz',
  100: '10 Hz',
  125: '8 Hz',
  200: '5 Hz'
}

export const ARDUCOPTER_OSD_TYPE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'MAX7456',
  2: 'SITL',
  3: 'MSP',
  4: 'TXONLY',
  5: 'MSP DisplayPort'
}

export const ARDUCOPTER_OSD_CHANNEL_LABELS: Record<number, string> = {
  0: 'Disabled',
  5: 'Channel 5',
  6: 'Channel 6',
  7: 'Channel 7',
  8: 'Channel 8',
  9: 'Channel 9',
  10: 'Channel 10',
  11: 'Channel 11',
  12: 'Channel 12',
  13: 'Channel 13',
  14: 'Channel 14',
  15: 'Channel 15',
  16: 'Channel 16'
}

export const ARDUCOPTER_OSD_SWITCH_METHOD_LABELS: Record<number, string> = {
  0: 'Advance On Change',
  1: 'Select By PWM Range',
  2: 'Advance On High Pulse'
}

export const ARDUCOPTER_MSP_OSD_CELL_COUNT_LABELS: Record<number, string> = {
  0: 'Auto',
  1: '1 cell',
  2: '2 cells',
  3: '3 cells',
  4: '4 cells',
  5: '5 cells',
  6: '6 cells',
  7: '7 cells',
  8: '8 cells',
  9: '9 cells',
  10: '10 cells',
  11: '11 cells',
  12: '12 cells',
  13: '13 cells',
  14: '14 cells'
}

export const ARDUCOPTER_VTX_ENABLE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled'
}

// ArduCopter ARMING_CHECK bitmask (bit index -> label). Bit 0 ("All")
// is special: when set, ArduPilot runs every pre-arm check regardless of
// the other bits. Surfaced as a checkbox like the rest.
export const ARDUCOPTER_ARMING_CHECK_BIT_LABELS: Record<number, string> = {
  0: 'All checks',
  1: 'Barometer',
  2: 'Compass',
  3: 'GPS lock',
  4: 'INS (gyro/accel)',
  5: 'Parameters',
  6: 'RC channels',
  7: 'Board voltage',
  8: 'Battery level',
  10: 'Logging available',
  11: 'Hardware safety switch',
  12: 'GPS configuration',
  13: 'System',
  14: 'Mission',
  15: 'Rangefinder',
  16: 'Camera',
  17: 'Aux authentication',
  18: 'Visual odometry',
  19: 'FFT'
}

export const ARDUCOPTER_SCHED_LOOP_RATE_LABELS: Record<number, string> = {
  50: '50 Hz',
  100: '100 Hz',
  200: '200 Hz',
  250: '250 Hz',
  300: '300 Hz',
  400: '400 Hz'
}

export const ARDUCOPTER_INS_GYRO_RATE_LABELS: Record<number, string> = {
  0: '1 kHz',
  1: '2 kHz',
  2: '4 kHz',
  3: '8 kHz'
}

export const ARDUCOPTER_INS_USE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled'
}

export const ARDUCOPTER_ARMING_REQUIRE_LABELS: Record<number, string> = {
  0: 'Disabled (no arming required)',
  1: 'Arm then THR_MIN PWM',
  2: 'Arm then 0 PWM'
}

export const ARDUCOPTER_ARMING_RUDDER_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Arm only',
  2: 'Arm or Disarm'
}

// ArduCopter FS_OPTIONS bitmask (bit index -> label).
export const ARDUCOPTER_FS_OPTIONS_BIT_LABELS: Record<number, string> = {
  0: 'Continue if in Auto on RC failsafe',
  1: 'Continue if in Auto on GCS failsafe',
  2: 'Continue if in Guided on RC failsafe',
  3: 'Continue if landing on any failsafe',
  4: 'Continue in pilot modes on GCS failsafe',
  5: 'Release gripper on failsafe'
}

export const ARDUCOPTER_MSP_OPTION_BIT_LABELS: Record<number, string> = {
  0: 'Telemetry Mode',
  1: 'Disable DJI Workarounds',
  2: 'Alternate FPV Fonts'
}

export const ARDUCOPTER_RSSI_TYPE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Analog Pin',
  2: 'RC Channel PWM',
  3: 'Receiver Protocol',
  4: 'PWM Input Pin'
}

export const ARDUCOPTER_DSHOT_RATE_LABELS: Record<number, string> = {
  0: '1x loop rate',
  1: '2x loop rate',
  2: '3x loop rate',
  3: '4x loop rate',
  4: '5x loop rate',
  5: '6x loop rate',
  6: '7x loop rate',
  7: '8x loop rate'
}

export const ARDUCOPTER_BLH_AUTO_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled (all DShot outputs)'
}

// Per-output channel bit labels for the BLHeli bidirectional-DShot
// (SERVO_BLH_BDMASK) and reverse (SERVO_BLH_RVMASK) masks. Bit 0 = output 1.
// Most boards support bidirectional DShot on the first 4 outputs only.
export const ARDUCOPTER_OUTPUT_CHANNEL_BIT_LABELS: Record<number, string> = {
  0: 'Output 1',
  1: 'Output 2',
  2: 'Output 3',
  3: 'Output 4',
  4: 'Output 5',
  5: 'Output 6',
  6: 'Output 7',
  7: 'Output 8'
}

// ArduPilot RC_OPTIONS bitmask (bit index -> label), per the RC_Channels
// Options enum.
export const ARDUCOPTER_RC_OPTIONS_BIT_LABELS: Record<number, string> = {
  0: 'Ignore RC Receiver',
  1: 'Ignore RC Overrides',
  2: 'Ignore RC Failsafe',
  3: 'FPort pad',
  4: 'Log raw RC data',
  5: 'Arming check throttle',
  6: 'Skip arming RPY check',
  7: 'Allow switch reverse',
  8: 'CRSF custom telemetry',
  9: 'Suppress CRSF mode/rate messages',
  10: 'Multiple receiver support',
  11: 'Use CRSF LQ as RSSI',
  12: 'CRSF flight-mode disarm star',
  13: 'ELRS 420kbaud'
}

export const ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS: Record<number, string> = {
  0: 'Built-in LED',
  5: 'DroneCAN',
  8: 'NeoPixel',
  9: 'ProfiLED',
  10: 'Scripting',
  11: 'DShot',
  12: 'ProfiLED SPI'
}

export const ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS: Record<number, string> = {
  0: 'Built-in Buzzer',
  1: 'DShot',
  2: 'DroneCAN'
}

export const ARDUCOPTER_NOTIFICATION_LED_BRIGHTNESS_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'Low',
  2: 'Medium',
  3: 'High'
}

export const ARDUCOPTER_NOTIFICATION_LED_OVERRIDE_LABELS: Record<number, string> = {
  0: 'Standard',
  1: 'MAVLink / Scripting / AP_Periph',
  2: 'Outback Challenge',
  3: 'Traffic Light'
}

export const ARDUCOPTER_FLTMODE_CHANNEL_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Channel 1',
  2: 'Channel 2',
  3: 'Channel 3',
  4: 'Channel 4',
  5: 'Channel 5',
  6: 'Channel 6',
  7: 'Channel 7',
  8: 'Channel 8',
  9: 'Channel 9',
  10: 'Channel 10',
  11: 'Channel 11',
  12: 'Channel 12',
  13: 'Channel 13',
  14: 'Channel 14',
  15: 'Channel 15',
  16: 'Channel 16'
}

export const ARDUCOPTER_SERVO_FUNCTION_LABELS: Record<number, string> = {
  [-1]: 'GPIO',
  0: 'Disabled',
  1: 'RCPassThru',
  // SERVOn_FUNCTION is a UNIVERSAL ArduPilot output-function enum — the
  // same numeric code means the same thing on Copter / Plane / Rover /
  // Sub. The fixed-wing control surfaces below were missing, so an
  // ArduPlane's SERVO1_FUNCTION=4 etc. rendered as "Unknown" in the
  // Servos tab even though the FC reported them correctly.
  2: 'Flap',
  3: 'Flap Auto',
  4: 'Aileron',
  6: 'Mount Yaw',
  7: 'Mount Pitch',
  8: 'Mount Roll',
  9: 'Mount Deploy/Retract',
  10: 'Camera Trigger',
  12: 'Mount2 Yaw',
  13: 'Mount2 Pitch',
  14: 'Mount2 Roll',
  15: 'Mount2 Deploy/Retract',
  16: 'Differential Spoiler 1',
  17: 'Differential Spoiler 2',
  19: 'Elevator',
  21: 'Rudder',
  22: 'Sprayer Pump',
  23: 'Sprayer Spinner',
  24: 'Flaperon Left',
  25: 'Flaperon Right',
  26: 'Ground Steering',
  27: 'Parachute Release',
  28: 'Gripper',
  29: 'Landing Gear',
  30: 'Motor Enable Switch',
  31: 'Rotor Head Speed',
  32: 'Tail Rotor Speed',
  33: 'Motor 1',
  34: 'Motor 2',
  35: 'Motor 3',
  36: 'Motor 4',
  37: 'Motor 5',
  38: 'Motor 6',
  39: 'Motor 7',
  40: 'Motor 8',
  41: 'Motor Tilt',
  45: 'Tilt Motor Rear',
  46: 'Tilt Motor Rear Left',
  47: 'Tilt Motor Rear Right',
  51: 'RCPassThru1',
  52: 'RCPassThru2',
  53: 'RCPassThru3',
  54: 'RCPassThru4',
  55: 'RCPassThru5',
  56: 'RCPassThru6',
  57: 'RCPassThru7',
  58: 'RCPassThru8',
  59: 'RCPassThru9',
  60: 'RCPassThru10',
  61: 'RCPassThru11',
  62: 'RCPassThru12',
  63: 'RCPassThru13',
  64: 'RCPassThru14',
  65: 'RCPassThru15',
  66: 'RCPassThru16',
  70: 'Throttle',
  71: 'Tracker Yaw',
  72: 'Tracker Pitch',
  73: 'Throttle Left',
  74: 'Throttle Right',
  75: 'Tilt Motor Left',
  76: 'Tilt Motor Right',
  77: 'Elevon Left',
  78: 'Elevon Right',
  79: 'VTail Left',
  80: 'VTail Right',
  81: 'Boost Engine Throttle',
  89: 'Main Sail',
  82: 'Motor 9',
  83: 'Motor 10',
  84: 'Motor 11',
  85: 'Motor 12',
  160: 'Motor 13',
  161: 'Motor 14',
  162: 'Motor 15',
  163: 'Motor 16',
  164: 'Motor 17',
  165: 'Motor 18',
  166: 'Motor 19',
  167: 'Motor 20',
  168: 'Motor 21',
  169: 'Motor 22',
  170: 'Motor 23',
  171: 'Motor 24',
  172: 'Motor 25',
  173: 'Motor 26',
  174: 'Motor 27',
  175: 'Motor 28',
  176: 'Motor 29',
  177: 'Motor 30',
  178: 'Motor 31',
  179: 'Motor 32',
  88: 'Winch',
  90: 'Camera ISO',
  91: 'Camera Aperture',
  92: 'Camera Focus',
  93: 'Camera Shutter Speed',
  120: 'NeoPixel 1',
  121: 'NeoPixel 2',
  122: 'NeoPixel 3',
  123: 'NeoPixel 4',
  140: 'RCIN1Scaled',
  141: 'RCIN2Scaled',
  142: 'RCIN3Scaled',
  143: 'RCIN4Scaled',
  144: 'RCIN5Scaled',
  145: 'RCIN6Scaled',
  146: 'RCIN7Scaled',
  147: 'RCIN8Scaled',
  148: 'RCIN9Scaled',
  149: 'RCIN10Scaled',
  150: 'RCIN11Scaled',
  151: 'RCIN12Scaled',
  152: 'RCIN13Scaled',
  153: 'RCIN14Scaled',
  154: 'RCIN15Scaled',
  155: 'RCIN16Scaled'
}

export function arducopterFlightModeLabel(modeNumber: number | undefined): string | undefined {
  if (modeNumber === undefined) {
    return undefined
  }

  return ARDUCOPTER_FLIGHT_MODE_LABELS[modeNumber]
}

export function arducopterFrameClassLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_FRAME_CLASS_LABELS[value]
}

export function arducopterFrameTypeLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_FRAME_TYPE_LABELS[value]
}

export function formatArducopterFrameClass(value: number | undefined): string {
  return arducopterFrameClassLabel(value) ?? (value === undefined ? 'Unknown' : `Frame class ${value}`)
}

export function formatArducopterFrameType(value: number | undefined): string {
  return arducopterFrameTypeLabel(value) ?? (value === undefined ? 'Unknown' : `Frame type ${value}`)
}

export function expectedMotorCountForArducopterFrameClass(value: number | undefined): number | undefined {
  switch (value) {
    case 1:
      return 4
    case 2:
      return 6
    case 3:
      return 8
    case 4:
      return 8
    case 5:
      return 6
    case 7:
      return 3
    case 8:
      return 1
    case 9:
      return 2
    case 10:
      return 2
    case 12:
      return 12
    case 14:
      return 10
    default:
      return undefined
  }
}

export function isArducopterFrameTypeIgnored(frameClass: number | undefined): boolean {
  return frameClass === 5 || frameClass === 6 || frameClass === 7 || frameClass === 8 || frameClass === 9 || frameClass === 10
}

export function arducopterServoFunctionLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_SERVO_FUNCTION_LABELS[value]
}

export function arducopterMotorPwmTypeLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_MOT_PWM_TYPE_LABELS[value]
}

export function formatArducopterMotorPwmType(value: number | undefined): string {
  return arducopterMotorPwmTypeLabel(value) ?? (value === undefined ? 'Unknown' : `PWM type ${value}`)
}

export function arducopterSerialProtocolLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_SERIAL_PROTOCOL_LABELS[value]
}

export function formatArducopterSerialProtocol(value: number | undefined): string {
  return arducopterSerialProtocolLabel(value) ?? (value === undefined ? 'Unknown' : `Protocol ${value}`)
}

// The handful of serial roles operators reach for most, pinned to the top
// of the Ports function dropdown (in this order) ahead of the long
// alphabetical tail. Values index ARDUCOPTER_SERIAL_PROTOCOL_LABELS:
// MAVLink2, GPS, ESC Telemetry, RCIN, Scripting, MSP, SmartAudio,
// DisplayPort, PPP.
const SERIAL_PROTOCOL_PRIORITY_VALUES = [2, 5, 16, 23, 28, 32, 37, 42, 48] as const

/**
 * SERIALn_PROTOCOL options ordered for the Ports function picker: "None"
 * first, then the common-roles priority group, then everything else
 * alphabetically by label (so it reads A→Z instead of by raw enum number).
 */
export function arducopterSerialProtocolOptions(): { value: number; label: string }[] {
  const all = Object.entries(ARDUCOPTER_SERIAL_PROTOCOL_LABELS).map(([value, label]) => ({
    value: Number(value),
    label
  }))
  const none = all.filter((option) => option.value === -1)
  const priority = SERIAL_PROTOCOL_PRIORITY_VALUES.map((value) =>
    all.find((option) => option.value === value)
  ).filter((option): option is { value: number; label: string } => option !== undefined)
  const pinned = new Set<number>([-1, ...SERIAL_PROTOCOL_PRIORITY_VALUES])
  const rest = all
    .filter((option) => !pinned.has(option.value))
    .sort((left, right) => left.label.localeCompare(right.label))
  return [...none, ...priority, ...rest]
}

export function arducopterSerialBaudLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_SERIAL_BAUD_LABELS[value]
}

export function arducopterSerialBaudRate(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }

  const normalized = Math.round(value)
  // Upstream AP_SerialManager map_baudrate(): `if (rate <= 0) { rate = 57; }`
  // — a zero/negative SERIALn_BAUD runs the port at 57600 on real
  // hardware, so display the truth instead of "0 baud".
  if (normalized <= 0) {
    return 57600
  }
  switch (normalized) {
    case 1:
      return 1200
    case 2:
      return 2400
    case 4:
      return 4800
    case 9:
      return 9600
    case 19:
      return 19200
    case 38:
      return 38400
    case 57:
      return 57600
    case 100:
      return 100000
    case 111:
      return 111100
    case 115:
      return 115200
    case 230:
      return 230400
    case 256:
      return 256000
    case 460:
      return 460800
    case 500:
      return 500000
    case 921:
      return 921600
    case 1500:
      return 1500000
    case 2000:
      return 2000000
    default:
      // Upstream: any coded value > 2000 is a DIRECT baudrate (this is
      // how 12500000 = 12.5 MBaud is encoded — there is deliberately
      // no `case 12500` here; that coded value means 12,500 baud).
      if (normalized > 2000) {
        return normalized
      }

      return normalized * 1000
  }
}

export function encodeArducopterSerialBaud(baudRate: number | undefined): number | undefined {
  if (baudRate === undefined || !Number.isFinite(baudRate)) {
    return undefined
  }

  const normalized = Math.max(1, Math.round(baudRate))
  const exactMatch = Object.keys(ARDUCOPTER_SERIAL_BAUD_LABELS).find(
    (encodedValue) => arducopterSerialBaudRate(Number(encodedValue)) === normalized
  )
  if (exactMatch !== undefined) {
    return Number(exactMatch)
  }

  if (normalized % 1000 === 0) {
    const kbaudValue = normalized / 1000
    if (kbaudValue >= 1 && kbaudValue <= 2000) {
      return kbaudValue
    }
  }

  return normalized
}

export function formatArducopterSerialBaud(value: number | undefined): string {
  const baudRate = arducopterSerialBaudRate(value)
  return baudRate === undefined ? 'Unknown' : `${baudRate.toLocaleString()} baud`
}

export function arducopterSerialRtsctsLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_SERIAL_RTSCTS_LABELS[value]
}

export function formatArducopterSerialRtscts(value: number | undefined): string {
  return arducopterSerialRtsctsLabel(value) ?? (value === undefined ? 'Unknown' : `Flow ${value}`)
}

export function arducopterGpsTypeLabel(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ARDUCOPTER_GPS_TYPE_LABELS[value]
}

export function formatArducopterGpsType(value: number | undefined): string {
  return arducopterGpsTypeLabel(value) ?? (value === undefined ? 'Unknown' : `GPS ${value}`)
}

export function formatArducopterGpsAutoConfig(value: number | undefined): string {
  return ARDUCOPTER_GPS_AUTO_CONFIG_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Auto config ${value}`)
}

export function formatArducopterGpsAutoSwitch(value: number | undefined): string {
  return ARDUCOPTER_GPS_AUTO_SWITCH_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Switch ${value}`)
}

export function formatArducopterGpsPrimary(value: number | undefined): string {
  return ARDUCOPTER_GPS_PRIMARY_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Primary ${value}`)
}

export function formatArducopterGpsRateMs(value: number | undefined): string {
  const label = ARDUCOPTER_GPS_RATE_MS_LABELS[value ?? Number.NaN]
  return label ?? (value === undefined ? 'Unknown' : `${value} ms`)
}

export function formatArducopterOsdType(value: number | undefined): string {
  return ARDUCOPTER_OSD_TYPE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `OSD ${value}`)
}

export function formatArducopterOsdChannel(value: number | undefined): string {
  return ARDUCOPTER_OSD_CHANNEL_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Channel ${value}`)
}

export function formatArducopterOsdSwitchMethod(value: number | undefined): string {
  return ARDUCOPTER_OSD_SWITCH_METHOD_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Method ${value}`)
}

export function formatArducopterMspOsdCellCount(value: number | undefined): string {
  return ARDUCOPTER_MSP_OSD_CELL_COUNT_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `${value} cells`)
}

export function formatArducopterVtxEnable(value: number | undefined): string {
  return ARDUCOPTER_VTX_ENABLE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `State ${value}`)
}

export function formatArducopterRssiType(value: number | undefined): string {
  return ARDUCOPTER_RSSI_TYPE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `RSSI ${value}`)
}

export function formatArducopterNotificationLedBrightness(value: number | undefined): string {
  return ARDUCOPTER_NOTIFICATION_LED_BRIGHTNESS_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Brightness ${value}`)
}

export function formatArducopterNotificationLedOverride(value: number | undefined): string {
  return ARDUCOPTER_NOTIFICATION_LED_OVERRIDE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Source ${value}`)
}

export function formatArducopterFlightModeChannel(value: number | undefined): string {
  return ARDUCOPTER_FLTMODE_CHANNEL_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Channel ${value}`)
}

export function arducopterMotorNumberForServoFunction(value: number | undefined): number | undefined {
  switch (value) {
    case 33:
      return 1
    case 34:
      return 2
    case 35:
      return 3
    case 36:
      return 4
    case 37:
      return 5
    case 38:
      return 6
    case 39:
      return 7
    case 40:
      return 8
    case 82:
      return 9
    case 83:
      return 10
    case 84:
      return 11
    case 85:
      return 12
  }
  // Motors 13-32 occupy a separate contiguous block in ArduPilot's SRV_Channel
  // function enum (k_motor13=160 .. k_motor32=179), distinct from the 33-40 /
  // 82-85 blocks above. Rare on standard frames (the largest stock copter is
  // DodecaHexa = 12 motors) but used by scripting / custom motor matrices.
  if (value !== undefined && value >= 160 && value <= 179) {
    return value - 147
  }
  return undefined
}

export function formatArducopterServoFunction(value: number | undefined): string {
  return arducopterServoFunctionLabel(value) ?? (value === undefined ? 'Unknown' : `Function ${value}`)
}

export function formatArducopterFlightMode(modeNumber: number | undefined): string {
  return arducopterFlightModeLabel(modeNumber) ?? (modeNumber === undefined ? 'Unknown' : `Mode ${modeNumber}`)
}

export function formatArducopterBatteryFailsafeAction(value: number | undefined): string {
  return ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Action ${value}`)
}

export function formatArducopterBatteryMonitor(value: number | undefined): string {
  return ARDUCOPTER_BATTERY_MONITOR_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Monitor ${value}`)
}

export function formatArducopterBatteryVoltageSource(value: number | undefined): string {
  return ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Source ${value}`)
}

export function formatArducopterThrottleFailsafe(value: number | undefined): string {
  return ARDUCOPTER_THROTTLE_FAILSAFE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Setting ${value}`)
}

export function formatArducopterGcsFailsafe(value: number | undefined): string {
  return ARDUCOPTER_FS_GCS_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Setting ${value}`)
}

export function formatArducopterEkfFailsafeAction(value: number | undefined): string {
  return ARDUCOPTER_FS_EKF_ACTION_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Action ${value}`)
}

export const ARDUCOPTER_LOG_BACKEND_LABELS: Record<number, string> = {
  0: 'None',
  1: 'File',
  2: 'MAVLink',
  3: 'File + MAVLink',
  4: 'Block'
}

export function formatArducopterLogBackend(value: number | undefined): string {
  return ARDUCOPTER_LOG_BACKEND_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Backend ${value}`)
}

// ArduPilot LOG_BITMASK bit positions, sourced from libraries/AP_Logger/AP_Logger.cpp.
// Each bit toggles whether the corresponding message family is written to the log.
// The Configurator surfaces these as a checkbox grid in the Logs view; the raw
// integer value remains the source of truth on the firmware side.
export const ARDUCOPTER_LOG_BITMASK_LABELS: Record<number, string> = {
  0: 'Fast attitude',
  1: 'Medium attitude',
  2: 'GPS',
  3: 'Performance monitor',
  4: 'Control tuning',
  5: 'Nav tuning',
  6: 'RC input',
  7: 'IMU',
  8: 'Commands',
  9: 'Battery current',
  10: 'RC output',
  11: 'Optical flow',
  12: 'PID',
  13: 'Compass',
  15: 'Camera',
  17: 'Motor / battery',
  18: 'Fast IMU',
  19: 'Raw IMU',
  20: 'Video stabilisation',
  21: 'FFT notch tuning'
}

// AUTOTUNE_AXES: which axes the multirotor AutoTune mode refines. Verbatim
// from libraries/AC_AutoTune/AC_AutoTune_Multi.cpp var_info[] @Bitmask
// (0:Roll,1:Pitch,2:Yaw,3:YawD).
export const ARDUCOPTER_AUTOTUNE_AXES_BIT_LABELS: Record<number, string> = {
  0: 'Roll',
  1: 'Pitch',
  2: 'Yaw',
  3: 'YawD'
}
