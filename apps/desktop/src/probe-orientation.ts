// Read-only bench probe for board-orientation detection.
//
// Streams SCALED_IMU from a real flight controller, prints the accelerometer in
// the units the runtime produces, and captures labelled poses so the detector
// can be checked against a board whose mounting is actually known.
//
// It reads AHRS_ORIENTATION. It never writes anything.
//
// Usage (props off, vehicle on the bench):
//   npm --workspace @arduconfig/desktop run probe:orientation -- --path=/dev/tty.usbmodem1101
//
// Hold each pose still, then press the key:
//   l = level   n = nose-down   u = nose-up   e/r = left/right side   b = on its back
//   d = dump captured samples   q = quit

import {
  MavlinkSession,
  MavlinkV2Codec,
  MAVLINK_MESSAGE_IDS,
  type MavlinkEnvelope
} from '@arduconfig/protocol-mavlink'

import { NativeSerialTransport } from './native-serial-transport.js'

/** Matches ArduPilot's GRAVITY_MSS, and the runtime's own conversion. */
const GRAVITY_MSS = 9.80665

/** MAV_CMD_SET_MESSAGE_INTERVAL. SCALED_IMU does not stream unless asked. */
const MAV_CMD_SET_MESSAGE_INTERVAL = 511

const POSE_KEYS: Record<string, string> = {
  l: 'level',
  n: 'nose-down',
  u: 'nose-up',
  e: 'left',
  r: 'right',
  b: 'back'
}

interface Options {
  path: string
  baudRate: number
  /** Non-interactive: stream for this many seconds, print a summary, exit.
   *  Use when driving the probe from a script rather than by hand. */
  watchSeconds?: number
}

function parseArgs(argv: string[]): Options {
  const options: Options = { path: '/dev/tty.usbmodem1101', baudRate: 115200 }
  for (const argument of argv) {
    const [rawKey, rawValue] = argument.split('=')
    if (rawValue === undefined) continue
    const key = rawKey.replace(/^--/, '')
    if (key === 'path') options.path = rawValue
    if (key === 'baud') options.baudRate = Number(rawValue)
    if (key === 'watch') options.watchSeconds = Number(rawValue)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const transport = new NativeSerialTransport('orientation-probe', {
    path: options.path,
    baudRate: options.baudRate
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())

  let latest: { x: number; y: number; z: number } | undefined
  let orientation: number | undefined
  let temperatureC: number | undefined
  let imuFrames = 0
  let requested = false
  const captured: { pose: string; accel: [number, number, number] }[] = []

  const unsubscribe = session.onMessage((envelope: MavlinkEnvelope) => {
    const message = envelope.message

    if (message.type === 'HEARTBEAT' && !requested) {
      requested = true
      const target = { targetSystem: envelope.header.systemId, targetComponent: envelope.header.componentId }
      // 100000 us = 10 Hz.
      void session.send({
        type: 'COMMAND_LONG',
        ...target,
        command: MAV_CMD_SET_MESSAGE_INTERVAL,
        confirmation: 0,
        params: [MAVLINK_MESSAGE_IDS.SCALED_IMU, 100000, 0, 0, 0, 0, 0]
      })
      void session.send({ type: 'PARAM_REQUEST_READ', ...target, paramId: 'AHRS_ORIENTATION', paramIndex: -1 })
      console.log('[probe] requested SCALED_IMU at 10 Hz and AHRS_ORIENTATION')
    }

    if (message.type === 'SCALED_IMU') {
      imuFrames += 1
      latest = {
        x: (message.accelMg.x / 1000) * GRAVITY_MSS,
        y: (message.accelMg.y / 1000) * GRAVITY_MSS,
        z: (message.accelMg.z / 1000) * GRAVITY_MSS
      }
      if (message.temperatureCdeg !== 0) temperatureC = message.temperatureCdeg / 100
    }

    if (message.type === 'PARAM_VALUE' && message.paramId === 'AHRS_ORIENTATION') {
      orientation = message.paramValue
    }
  })

  console.log(`[probe] opening ${options.path} at ${options.baudRate} baud (read-only)`)
  await session.connect()

  if (options.watchSeconds !== undefined) {
    // Non-interactive: report what the accelerometer is doing, and whether it
    // is steady enough for a pose capture, once a second.
    const started = Date.now()
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000
      if (latest) {
        const magnitude = Math.hypot(latest.x, latest.y, latest.z)
        const steady = Math.abs(magnitude - GRAVITY_MSS) < GRAVITY_MSS * 0.15
        console.log(
          `[t+${elapsed.toFixed(0)}s] x=${latest.x.toFixed(2)} y=${latest.y.toFixed(2)} ` +
            `z=${latest.z.toFixed(2)} |a|=${magnitude.toFixed(2)} ${steady ? 'steady' : 'MOVING'}`
        )
      } else {
        console.log(`[t+${elapsed.toFixed(0)}s] no SCALED_IMU yet (frames=${imuFrames})`)
      }
      if (elapsed >= options.watchSeconds!) {
        clearInterval(timer)
        unsubscribe()
        void session.disconnect().then(() => {
          session.destroy()
          console.log(`[probe] AHRS_ORIENTATION=${orientation ?? 'unknown'} imu_frames=${imuFrames}`)
          process.exit(0)
        })
      }
    }, 1000)
    return
  }

  console.log('[probe] l=level n=nose-down u=nose-up e=left r=right b=back | d=dump q=quit')

  const printer = setInterval(() => {
    if (!latest) return
    const magnitude = Math.hypot(latest.x, latest.y, latest.z)
    process.stdout.write(
      `\r[accel] x=${latest.x.toFixed(2)} y=${latest.y.toFixed(2)} z=${latest.z.toFixed(2)} ` +
        `|a|=${magnitude.toFixed(2)} m/s2  AHRS_ORIENTATION=${orientation ?? '?'}  ` +
        `frames=${imuFrames}  ${temperatureC !== undefined ? `${temperatureC.toFixed(1)}C` : ''}    `
    )
  }, 250)

  const finish = async (): Promise<void> => {
    clearInterval(printer)
    unsubscribe()
    await session.disconnect()
    session.destroy()
    console.log(`\n[probe] samples: ${JSON.stringify(captured)}`)
    console.log(`[probe] AHRS_ORIENTATION=${orientation ?? 'unknown'} imu_frames=${imuFrames}`)
    process.exit(0)
  }

  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (key: string) => {
    if (key === 'q' || key === '') {
      void finish()
      return
    }
    const pose = POSE_KEYS[key]
    if (pose && latest) {
      captured.push({ pose, accel: [latest.x, latest.y, latest.z] })
      console.log(`\n[probe] captured ${pose}: ${JSON.stringify(latest)}`)
    }
    if (key === 'd') {
      console.log(`\n[probe] ${JSON.stringify(captured, null, 2)}`)
    }
  })
}

main().catch((error) => {
  console.error('[probe] failed:', error)
  process.exit(1)
})
