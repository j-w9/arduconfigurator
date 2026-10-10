// Live MAVLink for the Plot tab: our decoder names fields for the app
// (ATTITUDE.rollRad, GPS_RAW_INT.latitudeE7), but MAVExplorer's graphs -- and
// anyone who knows MAVLink -- use the spec's names (ATTITUDE.roll,
// GPS_RAW_INT.lat). This puts each decoded message back into the spec's
// shape: a flat record of numbers under MAVLink field names. Pure.

type Decoded = Record<string, unknown> & { type?: unknown }

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Spelled out where our names differ from the spec's; arrays fan out to chanN_raw / servoN_raw. */
const RENAMES: Record<string, Record<string, string>> = {
  ATTITUDE: {
    timeBootMs: 'time_boot_ms',
    rollRad: 'roll',
    pitchRad: 'pitch',
    yawRad: 'yaw',
    rollSpeedRadS: 'rollspeed',
    pitchSpeedRadS: 'pitchspeed',
    yawSpeedRadS: 'yawspeed'
  },
  GLOBAL_POSITION_INT: {
    timeBootMs: 'time_boot_ms',
    latitudeE7: 'lat',
    longitudeE7: 'lon',
    altitudeMm: 'alt',
    relativeAltitudeMm: 'relative_alt',
    velocityXcms: 'vx',
    velocityYcms: 'vy',
    velocityZcms: 'vz',
    headingCdeg: 'hdg'
  },
  GPS_RAW_INT: {
    timeUsec: 'time_usec',
    fixType: 'fix_type',
    latitudeE7: 'lat',
    longitudeE7: 'lon',
    altitudeMm: 'alt',
    eph: 'eph',
    epv: 'epv',
    vel: 'vel',
    cog: 'cog',
    satellitesVisible: 'satellites_visible'
  },
  SYS_STATUS: {
    sensorsPresent: 'onboard_control_sensors_present',
    sensorsEnabled: 'onboard_control_sensors_enabled',
    sensorsHealth: 'onboard_control_sensors_health',
    load: 'load',
    voltageBatteryMv: 'voltage_battery',
    currentBatteryCa: 'current_battery',
    batteryRemaining: 'battery_remaining',
    dropRateComm: 'drop_rate_comm',
    errorsComm: 'errors_comm'
  },
  RC_CHANNELS: { timeBootMs: 'time_boot_ms', channelCount: 'chancount', rssi: 'rssi' },
  RC_CHANNELS_RAW: { timeBootMs: 'time_boot_ms', port: 'port', rssi: 'rssi' },
  SERVO_OUTPUT_RAW: { timeUsec: 'time_usec', port: 'port' },
  SCALED_IMU: { timeBootMs: 'time_boot_ms', temperatureCdeg: 'temperature' },
  DISTANCE_SENSOR: {
    timeBootMs: 'time_boot_ms',
    minDistanceCm: 'min_distance',
    maxDistanceCm: 'max_distance',
    currentDistanceCm: 'current_distance',
    sensorType: 'type',
    id: 'id',
    orientation: 'orientation',
    covariance: 'covariance',
    signalQuality: 'signal_quality'
  },
  OPTICAL_FLOW: {
    timeUsec: 'time_usec',
    sensorId: 'sensor_id',
    flowX: 'flow_x',
    flowY: 'flow_y',
    flowCompMx: 'flow_comp_m_x',
    flowCompMy: 'flow_comp_m_y',
    groundDistance: 'ground_distance',
    quality: 'quality',
    flowRateX: 'flow_rate_x',
    flowRateY: 'flow_rate_y'
  }
}

/** Messages that are plumbing, not telemetry: never offered for plotting. */
const NOT_TELEMETRY = new Set([
  'PARAM_VALUE',
  'PARAM_SET',
  'PARAM_REQUEST_LIST',
  'PARAM_REQUEST_READ',
  'COMMAND_LONG',
  'COMMAND_ACK',
  'FILE_TRANSFER_PROTOCOL',
  'LOG_DATA',
  'LOG_ENTRY',
  'LOG_ERASE',
  'LOG_REQUEST_DATA',
  'LOG_REQUEST_END',
  'LOG_REQUEST_LIST',
  'CAN_FRAME',
  'CANFD_FRAME',
  'STATUSTEXT',
  'SETUP_SIGNING',
  'AUTOPILOT_VERSION'
])

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** A decoded message as MAVLink names it, or undefined when it is not plottable telemetry. */
export function mavlinkRecordForPlot(message: Decoded): { name: string; record: Record<string, number> } | undefined {
  const name = typeof message.type === 'string' ? message.type : undefined
  if (!name || NOT_TELEMETRY.has(name)) return undefined
  const renames = RENAMES[name]
  const record: Record<string, number> = {}
  for (const [key, value] of Object.entries(message)) {
    if (key === 'type') continue
    if (Array.isArray(value)) {
      // RC channels and servo outputs: the spec has one field per channel.
      if (key === 'channels') value.forEach((entry, index) => num(entry) !== undefined && (record[`chan${index + 1}_raw`] = entry as number))
      if (key === 'servos') value.forEach((entry, index) => num(entry) !== undefined && (record[`servo${index + 1}_raw`] = entry as number))
      continue
    }
    if (value && typeof value === 'object') {
      // SCALED_IMU's accelMg {x,y,z} is the spec's xacc / yacc / zacc.
      if (name === 'SCALED_IMU' && key === 'accelMg') {
        const vector = value as { x?: unknown; y?: unknown; z?: unknown }
        if (num(vector.x) !== undefined) record.xacc = vector.x as number
        if (num(vector.y) !== undefined) record.yacc = vector.y as number
        if (num(vector.z) !== undefined) record.zacc = vector.z as number
      }
      continue
    }
    const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : num(value)
    if (numeric === undefined) continue
    record[renames?.[key] ?? snake(key)] = numeric
  }
  return Object.keys(record).length > 0 ? { name, record } : undefined
}
