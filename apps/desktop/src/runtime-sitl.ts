import {
  ArduPilotConfiguratorRuntime,
  deriveEscSetupSummary,
  deriveRcAxisChannelMap,
  type ConfiguratorSnapshot
} from '@arduconfig/ardupilot-core'
import { arducopterMetadata, arduplaneMetadata } from '@arduconfig/param-metadata'
import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'
import {
  TcpTransport,
  UdpTransport,
  launchArduPilotDirectBinary,
  launchArduPilotSITL,
  type ArduPilotSITLProcess
} from '@arduconfig/sitl-harness'
import {
  listSnapshotLibraryFile,
  maybeRunSnapshotOperations,
  type SnapshotCommandOptions,
  type SnapshotRestoreDecision,
} from './snapshot-ops.js'

type SnapshotFormat = 'off' | 'pretty' | 'json'
type RuntimeSITLTransport = 'tcp' | 'udp'
type RuntimeSITLLaunchMode = 'direct-binary' | 'sim-vehicle'

interface RuntimeSITLOptions extends SnapshotCommandOptions {
  repoPath?: string
  pythonExecutable: string
  launchMode: RuntimeSITLLaunchMode
  transport: RuntimeSITLTransport
  host: string
  port: number
  launchWaitPort: number
  vehicle: string
  frame: string
  launchTimeoutMs: number
  heartbeatTimeoutMs: number
  parameterTimeoutMs: number
  parameterWriteVerifyTimeoutMs: number
  speedup: number
  wipe: boolean
  requestParams: boolean
  snapshot: SnapshotFormat
  holdOpenMs: number
  validateParameterId?: string
  validateParameterValue?: number
  executeParameterValidation: boolean
  restoreAfterValidation: boolean
}

const defaults: RuntimeSITLOptions = {
  pythonExecutable: 'python3',
  launchMode: 'direct-binary',
  transport: 'tcp',
  host: '127.0.0.1',
  port: 5760,
  launchWaitPort: 5760,
  vehicle: 'ArduCopter',
  frame: 'quad',
  launchTimeoutMs: 120000,
  heartbeatTimeoutMs: 10000,
  parameterTimeoutMs: 30000,
  parameterWriteVerifyTimeoutMs: 3000,
  speedup: 1,
  wipe: false,
  requestParams: true,
  snapshot: 'pretty',
  holdOpenMs: 0,
  executeParameterValidation: false,
  restoreAfterValidation: true,
  captureSnapshot: false,
  listSnapshotLibrary: false,
  compareSnapshot: false,
  restoreSnapshot: false,
  executeSnapshotRestore: false,
  snapshotTags: [],
  snapshotProtected: false
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  let sitl: ArduPilotSITLProcess | undefined
  let runtime: ArduPilotConfiguratorRuntime | undefined

  if (options.listSnapshotLibrary) {
    await listSnapshotLibraryFile(options.snapshotLibraryFile, '[sitl]')
    return
  }

  try {
    if (options.repoPath) {
      console.log(`[sitl] launching ${options.vehicle} ${options.frame} from ${options.repoPath}`)
      sitl =
        options.launchMode === 'sim-vehicle'
          ? await launchArduPilotSITL({
              repoPath: options.repoPath,
              pythonExecutable: options.pythonExecutable,
              vehicle: options.vehicle,
              frame: options.frame,
              host: options.host,
              port: options.launchWaitPort,
              speedup: options.speedup,
              wipe: options.wipe,
              launchTimeoutMs: options.launchTimeoutMs
            })
          : await launchArduPilotDirectBinary({
              repoPath: options.repoPath,
              vehicle: options.vehicle,
              frame: options.frame,
              host: options.host,
              port: options.launchWaitPort,
              speedup: options.speedup,
              wipe: options.wipe,
              launchTimeoutMs: options.launchTimeoutMs
            })
      console.log(`[sitl] ready at tcp://${sitl.host}:${sitl.port}`)
    } else {
      console.log(`[sitl] attaching to existing tcp://${options.host}:${options.port}`)
    }

    const transport =
      options.transport === 'udp'
        ? new UdpTransport('sitl-udp', {
            bindHost: options.host,
            bindPort: options.port
          })
        : new TcpTransport('sitl-tcp', {
            host: options.host,
            port: options.port,
            connectTimeoutMs: options.heartbeatTimeoutMs
          })
    const session = new MavlinkSession(transport, new MavlinkV2Codec())
    runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
      metadataByVehicle: {
        ArduCopter: arducopterMetadata,
        ArduPlane: arduplaneMetadata
      }
    })

    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: options.heartbeatTimeoutMs })
    console.log(
      `[sitl] vehicle=${vehicle.vehicle} firmware=${vehicle.firmware} sys=${vehicle.systemId} comp=${vehicle.componentId} armed=${vehicle.armed} mode="${vehicle.flightMode}"`
    )

    if (options.requestParams) {
      await runtime.requestParameterList({ timeoutMs: options.heartbeatTimeoutMs })
      const parameterStats = await runtime.waitForParameterSync({ timeoutMs: options.parameterTimeoutMs })
      console.log(
        `[sitl] parameter sync complete ${parameterStats.downloaded}/${parameterStats.total} duplicates=${parameterStats.duplicateFrames}`
      )
    }

    await maybeValidateParameterWrite(runtime, options)
    const snapshotAfterWrites = await maybeRunSnapshotOperations(runtime, runtime.getSnapshot(), options, {
      logPrefix: '[sitl]',
      evaluateRestore: evaluateSnapshotRestoreDecision
    })
    renderSnapshot(snapshotAfterWrites, options.snapshot)

    if (options.holdOpenMs > 0) {
      console.log(`[sitl] holding link open for ${options.holdOpenMs}ms`)
      await sleep(options.holdOpenMs)
    }
  } catch (error) {
    if (sitl && sitl.output.length > 0) {
      console.error('[sitl] recent sim_vehicle.py output:')
      sitl.output.slice(-40).forEach((line) => {
        console.error(line)
      })
    }
    throw error
  } finally {
    await runtime?.disconnect().catch(() => {})
    runtime?.destroy()
    if (sitl) {
      await sitl.stop().catch(() => {})
    }
  }
}

function parseArgs(argv: string[]): RuntimeSITLOptions {
  const options = { ...defaults }
  let transportExplicit = false
  let portExplicit = false

  for (const argument of argv) {
    if (argument === '--no-request-params') {
      options.requestParams = false
      continue
    }

    if (argument === '--wipe') {
      options.wipe = true
      continue
    }

    if (argument === '--execute-parameter-validation') {
      options.executeParameterValidation = true
      continue
    }

    if (argument === '--capture-snapshot') {
      options.captureSnapshot = true
      continue
    }

    if (argument === '--list-snapshot-library') {
      options.listSnapshotLibrary = true
      continue
    }

    if (argument === '--compare-snapshot') {
      options.compareSnapshot = true
      continue
    }

    if (argument === '--restore-snapshot') {
      options.restoreSnapshot = true
      continue
    }

    if (argument === '--execute-snapshot-restore') {
      options.executeSnapshotRestore = true
      continue
    }

    if (argument === '--snapshot-protected') {
      options.snapshotProtected = true
      continue
    }

    if (argument === '--leave-validated-value') {
      options.restoreAfterValidation = false
      continue
    }

    const [rawKey, rawValue] = argument.split('=')
    const key = rawKey.replace(/^--/, '')
    if (rawValue === undefined) {
      continue
    }

    switch (key) {
      case 'repo-path':
        options.repoPath = rawValue
        break
      case 'python':
        options.pythonExecutable = rawValue
        break
      case 'launch-mode':
        if (rawValue === 'direct-binary' || rawValue === 'sim-vehicle') {
          options.launchMode = rawValue
        }
        break
      case 'host':
        options.host = rawValue
        break
      case 'transport':
        if (rawValue === 'tcp' || rawValue === 'udp') {
          transportExplicit = true
          options.transport = rawValue
        }
        break
      case 'port':
        portExplicit = true
        options.port = Number(rawValue)
        break
      case 'launch-wait-port':
        options.launchWaitPort = Number(rawValue)
        break
      case 'vehicle':
        options.vehicle = rawValue
        break
      case 'frame':
        options.frame = rawValue
        break
      case 'launch-timeout-ms':
        options.launchTimeoutMs = Number(rawValue)
        break
      case 'heartbeat-timeout-ms':
        options.heartbeatTimeoutMs = Number(rawValue)
        break
      case 'parameter-timeout-ms':
        options.parameterTimeoutMs = Number(rawValue)
        break
      case 'parameter-write-verify-timeout-ms':
        options.parameterWriteVerifyTimeoutMs = Number(rawValue)
        break
      case 'speedup':
        options.speedup = Number(rawValue)
        break
      case 'snapshot':
        if (rawValue === 'off' || rawValue === 'pretty' || rawValue === 'json') {
          options.snapshot = rawValue
        }
        break
      case 'hold-open-ms':
        options.holdOpenMs = Number(rawValue)
        break
      case 'validate-parameter-id':
        options.validateParameterId = rawValue
        break
      case 'validate-parameter-value':
        options.validateParameterValue = Number(rawValue)
        break
      case 'snapshot-input-file':
        options.snapshotInputFile = rawValue
        break
      case 'snapshot-output-file':
        options.snapshotOutputFile = rawValue
        break
      case 'snapshot-library-file':
        options.snapshotLibraryFile = rawValue
        break
      case 'snapshot-label':
        options.snapshotLabel = rawValue
        break
      case 'snapshot-note':
        options.snapshotNote = rawValue
        break
      case 'snapshot-tags':
        options.snapshotTags = rawValue
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
        break
      case 'snapshot-id':
        options.snapshotSelectId = rawValue
        break
      case 'snapshot-select-label':
        options.snapshotSelectLabel = rawValue
        break
      default:
        break
    }
  }

  if (options.launchMode === 'sim-vehicle') {
    if (!transportExplicit) {
      options.transport = 'udp'
    }
    if (!portExplicit) {
      options.port = 14550
    }
  } else {
    if (!transportExplicit) {
      options.transport = 'tcp'
    }
    if (!portExplicit) {
      options.port = 5760
    }
  }

  return options
}

async function maybeValidateParameterWrite(
  runtime: ArduPilotConfiguratorRuntime,
  options: RuntimeSITLOptions
): Promise<void> {
  if (!options.validateParameterId || options.validateParameterValue === undefined) {
    return
  }

  const snapshot = runtime.getSnapshot()
  const parameter = snapshot.parameters.find((candidate) => candidate.id === options.validateParameterId)
  if (!parameter) {
    throw new Error(`Parameter ${options.validateParameterId} is not present in the current synced snapshot.`)
  }

  const mode = options.executeParameterValidation ? 'execute' : 'dry-run'
  console.log(
    `[sitl] parameter validation ${mode}: ${options.validateParameterId} -> ${options.validateParameterValue}${
      options.restoreAfterValidation ? ' (restore original value afterward)' : ''
    }`
  )
  console.log(`[sitl] parameter validation current: ${parameter.id}=${parameter.value}`)

  if (!options.executeParameterValidation) {
    console.log('[sitl] no MAVLink parameter write sent. Re-run with --execute-parameter-validation to actually write it.')
    return
  }

  if (Object.is(parameter.value, options.validateParameterValue)) {
    console.log('[sitl] parameter validation note: requested value already matches the current SITL value.')
    return
  }

  const writeResult = await runtime.setParameter(parameter.id, options.validateParameterValue, {
    verifyTimeoutMs: options.parameterWriteVerifyTimeoutMs
  })
  console.log(
    `[sitl] parameter validation verified: ${writeResult.paramId}=${writeResult.confirmedValue} (previous=${writeResult.previousValue ?? 'unknown'})`
  )

  if (options.restoreAfterValidation && writeResult.previousValue !== undefined) {
    const rollbackResult = await runtime.setParameter(parameter.id, writeResult.previousValue, {
      verifyTimeoutMs: options.parameterWriteVerifyTimeoutMs
    })
    console.log(`[sitl] parameter validation restored: ${rollbackResult.paramId}=${rollbackResult.confirmedValue}`)
  }
}

function evaluateSnapshotRestoreDecision(snapshot: ConfiguratorSnapshot): SnapshotRestoreDecision {
  const reasons: string[] = []

  if (snapshot.connection.kind !== 'connected') {
    reasons.push('The transport is not connected.')
  }

  if (!snapshot.vehicle) {
    reasons.push('No vehicle heartbeat has been identified yet.')
  }

  if (snapshot.vehicle?.armed) {
    reasons.push('The vehicle reports armed=true.')
  }

  if (snapshot.parameterStats.status !== 'complete') {
    reasons.push('Parameter sync is not complete yet.')
  }

  return {
    allowed: reasons.length === 0,
    reasons
  }
}

function renderSnapshot(snapshot: ConfiguratorSnapshot, format: SnapshotFormat): void {
  if (format === 'off') {
    return
  }

  if (format === 'json') {
    console.log(JSON.stringify(snapshot, null, 2))
    return
  }

  console.log('[sitl] snapshot')
  console.log(`  connection: ${snapshot.connection.kind}`)
  console.log(`  vehicle: ${snapshot.vehicle?.vehicle ?? 'unknown'} (${snapshot.vehicle?.firmware ?? 'unknown firmware'})`)
  console.log(`  mode: ${snapshot.vehicle?.flightMode ?? 'unknown'}`)
  console.log(`  parameters: ${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total} status=${snapshot.parameterStats.status}`)
  console.log(
    `  live telemetry: rc=${snapshot.liveVerification.rcInput.verified ? `${snapshot.liveVerification.rcInput.channelCount}ch` : 'missing'} battery=${
      snapshot.liveVerification.batteryTelemetry.verified
        ? `${snapshot.liveVerification.batteryTelemetry.voltageV?.toFixed(2) ?? '?'}V`
        : 'missing'
    }`
  )
  const rcMap = deriveRcAxisChannelMap(snapshot)
  console.log(`  rc map: roll=CH${rcMap.roll} pitch=CH${rcMap.pitch} throttle=CH${rcMap.throttle} yaw=CH${rcMap.yaw}`)
  console.log(`  pre-arm: ${snapshot.preArmStatus.healthy ? 'clear' : `${snapshot.preArmStatus.issues.length} issue(s)`}`)
  const escSetup = deriveEscSetupSummary(snapshot)
  console.log(`  esc: ${escSetup.pwmTypeLabel} / ${escSetup.calibrationPath}`)
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
