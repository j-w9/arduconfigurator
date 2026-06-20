import { MavlinkSession, MavlinkV2Codec, type MavlinkEnvelope } from '@arduconfig/protocol-mavlink'

import { NativeSerialTransport } from './native-serial-transport.js'

interface ProbeOptions {
  path: string
  baudRate: number
  durationMs: number
  requestParams: boolean
}

const defaults: ProbeOptions = {
  path: '/dev/tty.usbmodem1101',
  baudRate: 115200,
  durationMs: 8000,
  requestParams: false
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const transport = new NativeSerialTransport('probe', {
    path: options.path,
    baudRate: options.baudRate
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())

  let heartbeatCount = 0
  let paramValueCount = 0
  let requestSent = false
  const messageCounts = new Map<string, number>()

  const unsubscribe = session.onMessage((envelope: MavlinkEnvelope) => {
    messageCounts.set(envelope.message.type, (messageCounts.get(envelope.message.type) ?? 0) + 1)

    if (envelope.message.type === 'HEARTBEAT') {
      heartbeatCount += 1
      console.log(
        `[heartbeat ${heartbeatCount}] sys=${envelope.header.systemId} comp=${envelope.header.componentId} autopilot=${envelope.message.autopilot} vehicle=${envelope.message.vehicleType} base_mode=${envelope.message.baseMode} custom_mode=${envelope.message.customMode} status=${envelope.message.systemStatus}`
      )

      if (options.requestParams && !requestSent) {
        requestSent = true
        void session.send({
          type: 'PARAM_REQUEST_LIST',
          targetSystem: envelope.header.systemId,
          targetComponent: envelope.header.componentId
        })
        console.log('[probe] sent PARAM_REQUEST_LIST')
      }
    }

    if (envelope.message.type === 'PARAM_VALUE') {
      paramValueCount += 1
      if (paramValueCount <= 12 || paramValueCount % 50 === 0) {
        console.log(
          `[param ${paramValueCount}] ${envelope.message.paramId}=${envelope.message.paramValue} (${envelope.message.paramIndex + 1}/${envelope.message.paramCount})`
        )
      }
    }

    if (envelope.message.type === 'STATUSTEXT') {
      console.log(`[statustext] severity=${envelope.message.severity} text="${envelope.message.text}"`)
    }
  })

  console.log(
    `[probe] opening ${options.path} at ${options.baudRate} baud for ${(options.durationMs / 1000).toFixed(1)}s${options.requestParams ? ' with PARAM_REQUEST_LIST' : ''}`
  )

  await session.connect()

  await new Promise((resolve) => setTimeout(resolve, options.durationMs))

  unsubscribe()
  await session.disconnect()
  session.destroy()

  console.log(`[probe] heartbeats=${heartbeatCount} param_values=${paramValueCount}`)
  console.log(`[probe] message_counts=${JSON.stringify(Object.fromEntries(messageCounts), null, 2)}`)
}

function parseArgs(argv: string[]): ProbeOptions {
  const options = { ...defaults }

  for (const argument of argv) {
    if (argument === '--request-params') {
      options.requestParams = true
      continue
    }

    const [rawKey, rawValue] = argument.split('=')
    const key = rawKey.replace(/^--/, '')
    if (rawValue === undefined) {
      continue
    }

    switch (key) {
      case 'path':
        options.path = rawValue
        break
      case 'baud':
        options.baudRate = Number(rawValue)
        break
      case 'duration-ms':
        options.durationMs = Number(rawValue)
        break
      default:
        break
    }
  }

  return options
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
