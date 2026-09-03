// Does the RUNTIME see the accelerometer on this vehicle?
//
// The bench probe proved the flight controller sends SCALED_IMU when asked at
// 10 Hz. That is a different question from whether the configurator's own
// runtime — which asks for it once, at 1 Hz, in its live-telemetry request run
// — ends up with liveVerification.accelMss populated. The board-orientation
// capture reads exactly that field, so this is the check that says whether the
// feature has any input at all.
//
// Read-only. Requests a stream rate and reads parameters; writes nothing.
//
//   npm --workspace @arduconfig/desktop run probe:accel -- --path=/dev/tty.usbmodem1101

import { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'
import { arducopterMetadata } from '@arduconfig/param-metadata'

import { NativeSerialTransport } from './native-serial-transport.js'

const SCALED_IMU_ID = 26

function parseArgs(argv: string[]): { path: string; baudRate: number; boost: boolean } {
  const options = { path: '/dev/tty.usbmodem1101', baudRate: 115200, boost: false }
  for (const argument of argv) {
    if (argument === '--boost') {
      options.boost = true
      continue
    }
    const [rawKey, rawValue] = argument.split('=')
    if (rawValue === undefined) continue
    const key = rawKey.replace(/^--/, '')
    if (key === 'path') options.path = rawValue
    if (key === 'baud') options.baudRate = Number(rawValue)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const transport = new NativeSerialTransport('accel-stream-probe', {
    path: options.path,
    baudRate: options.baudRate
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  console.log(`[probe] connecting to ${options.path} (read-only)`)
  await runtime.connect()

  const report = (label: string): void => {
    const snapshot = runtime.getSnapshot()
    const accel = snapshot.liveVerification.accelMss
    const temperature = snapshot.liveVerification.imuTemperatureC
    console.log(
      `[${label}] accelMss=${accel ? `x ${accel.x.toFixed(2)} y ${accel.y.toFixed(2)} z ${accel.z.toFixed(2)}` : 'UNSET'}` +
        `  imuTemperatureC=${temperature ?? 'UNSET'}` +
        `  params=${snapshot.parameterStats.status}`
    )
  }

  // What the app gets on its own: LIVE_TELEMETRY_REQUESTS only.
  for (const seconds of [3, 6, 10]) {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 - (seconds === 3 ? 0 : 3000)))
    report(`t+${seconds}s baseline`)
  }

  if (options.boost) {
    // What the calibration capture asks for while it runs.
    const result = await runtime.requestMessageInterval(SCALED_IMU_ID, 100000)
    console.log(`[probe] requestMessageInterval(26, 100000) -> ${JSON.stringify(result)}`)
    await new Promise((resolve) => setTimeout(resolve, 4000))
    report('after boost')
  }

  await runtime.disconnect()
  process.exit(0)
}

main().catch((error) => {
  console.error('[probe] failed:', error)
  process.exit(1)
})
