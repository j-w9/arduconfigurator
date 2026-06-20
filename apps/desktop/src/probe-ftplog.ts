// Read-only live-FC probe for the MAVFTP and onboard-log-download paths.
//
// Builds the real runtime over NativeSerialTransport (same path as
// runtime-serial), syncs parameters, then exercises — without writing
// anything to the vehicle:
//   1. MAVFTP LIST_DIRECTORY of @SYS
//   2. MAVFTP read of @SYS/uarts.txt (the serial-port enrichment file)
//   3. LOG_REQUEST_LIST (onboard dataflash log list)
//   4. LOG_REQUEST_DATA of the most recent log, verifying the byte count
//      matches the advertised size and the dataflash FMT header (0xA3 0x95).
//
// Usage: npm run probe:ftplog --workspace @arduconfig/desktop -- --path=/dev/cu.usbmodemXXX

import { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { arducopterMetadata, arduplaneMetadata } from '@arduconfig/param-metadata'
import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'

import { NativeSerialTransport } from './native-serial-transport.js'

interface ProbeOptions {
  path: string
  baudRate: number
  heartbeatTimeoutMs: number
  parameterTimeoutMs: number
  maxLogDownloadBytes: number
}

const defaults: ProbeOptions = {
  path: '/dev/cu.usbmodem101',
  baudRate: 115200,
  heartbeatTimeoutMs: 8000,
  parameterTimeoutMs: 30000,
  maxLogDownloadBytes: 4 * 1024 * 1024
}

function parseArgs(argv: string[]): ProbeOptions {
  const options = { ...defaults }
  for (const argument of argv) {
    const [rawKey, rawValue] = argument.split('=')
    if (rawValue === undefined) {
      continue
    }
    const key = rawKey.replace(/^--/, '')
    switch (key) {
      case 'path':
        options.path = rawValue
        break
      case 'baud':
        options.baudRate = Number(rawValue)
        break
      case 'heartbeat-timeout-ms':
        options.heartbeatTimeoutMs = Number(rawValue)
        break
      case 'parameter-timeout-ms':
        options.parameterTimeoutMs = Number(rawValue)
        break
      case 'max-log-bytes':
        options.maxLogDownloadBytes = Number(rawValue)
        break
      default:
        break
    }
  }
  return options
}

function nonZeroRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0
  }
  let nonZero = 0
  for (const byte of bytes) {
    if (byte !== 0) {
      nonZero += 1
    }
  }
  return nonZero / bytes.length
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const transport = new NativeSerialTransport('probe-ftplog', {
    path: options.path,
    baudRate: options.baudRate
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata
    }
  })

  try {
    console.log(`[ftplog] opening ${options.path} at ${options.baudRate} baud`)
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: options.heartbeatTimeoutMs })
    console.log(`[ftplog] vehicle=${vehicle.vehicle} firmware=${vehicle.firmware} armed=${vehicle.armed} mode="${vehicle.flightMode}"`)

    await runtime.requestParameterList({ timeoutMs: options.heartbeatTimeoutMs })
    const stats = await runtime.waitForParameterSync({ timeoutMs: options.parameterTimeoutMs })
    console.log(`[ftplog] parameter sync ${stats.downloaded}/${stats.total} duplicates=${stats.duplicateFrames}`)

    // 1. MAVFTP directory listing of @SYS
    console.log('\n[ftplog] === MAVFTP LIST_DIRECTORY @SYS ===')
    try {
      const entries = await runtime.listRemoteDirectory('@SYS')
      console.log(`[ftplog] @SYS has ${entries.length} entries:`)
      for (const entry of entries) {
        console.log(`  ${entry.kind.padEnd(5)} ${entry.name}${entry.sizeBytes !== undefined ? ` (${entry.sizeBytes}B)` : ''}`)
      }
    } catch (error) {
      console.error(`[ftplog] LIST_DIRECTORY failed: ${(error as Error).message}`)
    }

    // 2. MAVFTP read of @SYS/uarts.txt
    console.log('\n[ftplog] === MAVFTP READ @SYS/uarts.txt ===')
    try {
      const bytes = await runtime.downloadRemoteFile('@SYS/uarts.txt')
      const text = new TextDecoder().decode(bytes)
      console.log(`[ftplog] @SYS/uarts.txt = ${bytes.length} bytes:`)
      console.log(text.split('\n').map((line) => `  | ${line}`).join('\n'))
    } catch (error) {
      console.error(`[ftplog] READ @SYS/uarts.txt failed: ${(error as Error).message}`)
    }

    // 3. Onboard dataflash log list
    console.log('\n[ftplog] === LOG_REQUEST_LIST ===')
    let logs: Awaited<ReturnType<typeof runtime.listOnboardLogs>> = []
    try {
      logs = await runtime.listOnboardLogs()
      console.log(`[ftplog] ${logs.length} onboard log(s):`)
      for (const log of logs) {
        console.log(`  id=${log.id} size=${log.sizeBytes}B timeUtc=${log.timeUtc}`)
      }
    } catch (error) {
      console.error(`[ftplog] LOG_REQUEST_LIST failed: ${(error as Error).message}`)
    }

    // 4. Download the most recent log, verify length + dataflash header
    if (logs.length > 0) {
      const target = logs.reduce((latest, log) => (log.id > latest.id ? log : latest), logs[0])
      console.log(`\n[ftplog] === LOG_REQUEST_DATA id=${target.id} (${target.sizeBytes}B advertised) ===`)
      if (target.sizeBytes > options.maxLogDownloadBytes) {
        console.log(`[ftplog] skipping download: ${target.sizeBytes}B exceeds --max-log-bytes=${options.maxLogDownloadBytes}`)
      } else {
        try {
          let lastPct = -1
          const bytes = await runtime.downloadOnboardLog(target.id, target.sizeBytes, (progress) => {
            const pct = progress.totalBytes > 0 ? Math.floor((progress.bytesReceived / progress.totalBytes) * 100) : 0
            if (pct >= lastPct + 25) {
              lastPct = pct
              console.log(`[ftplog]   download ${pct}% (${progress.bytesReceived}/${progress.totalBytes})`)
            }
          })
          const header = `0x${bytes[0]?.toString(16).padStart(2, '0')} 0x${bytes[1]?.toString(16).padStart(2, '0')}`
          const lengthExact = bytes.length === target.sizeBytes
          const headerOk = bytes[0] === 0xa3 && bytes[1] === 0x95
          console.log(`[ftplog] downloaded ${bytes.length}B (advertised ${target.sizeBytes}B) length-exact=${lengthExact}`)
          console.log(`[ftplog] dataflash header ${header} valid=${headerOk} non-zero=${(nonZeroRatio(bytes) * 100).toFixed(1)}%`)
        } catch (error) {
          console.error(`[ftplog] LOG_REQUEST_DATA failed: ${(error as Error).message}`)
        }
      }
    } else {
      console.log('\n[ftplog] no onboard logs to download (FC may have none recorded)')
    }
  } finally {
    await runtime.disconnect()
    runtime.destroy()
    console.log('\n[ftplog] done')
  }
}

main().catch((error) => {
  console.error(`[ftplog] fatal: ${(error as Error).message}`)
  process.exitCode = 1
})
