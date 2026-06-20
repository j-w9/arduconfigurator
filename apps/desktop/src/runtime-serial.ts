import {
  ArduPilotConfiguratorRuntime,
  advanceModeSwitchExerciseState,
  advanceRcRangeExerciseState,
  createModeSwitchExerciseState,
  createRcRangeExerciseState,
  deriveEscSetupSummary,
  deriveOutputMappingSummary,
  deriveModeSwitchEstimate,
  formatModeExerciseTargetLabel,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations,
  deriveRcMapDraftValues,
  detectDominantRcChannelChange,
  evaluateMotorTestEligibility,
  failModeSwitchExerciseState,
  failRcRangeExerciseState,
  formatModeSlotLabel,
  formatRcAxisLabel,
  type ConfiguratorSnapshot,
  type MotorTestRequest,
  type RcAxisId,
  type SetupStatus,
} from '@arduconfig/ardupilot-core'
import { arducopterMetadata, arduplaneMetadata, type GuidedActionId } from '@arduconfig/param-metadata'
import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'

import { NativeSerialTransport, type NativeSerialPortInfo } from './native-serial-transport.js'
import {
  listSnapshotLibraryFile,
  maybeRunSnapshotOperations,
  type SnapshotCommandOptions,
  type SnapshotRestoreDecision,
} from './snapshot-ops.js'

type SnapshotFormat = 'off' | 'pretty' | 'json'
type ReadOnlyExerciseKind = 'mode-switch' | 'rc-ranges' | 'rc-mapping'

interface RuntimeSerialOptions extends SnapshotCommandOptions {
  path?: string
  portIndex?: number
  baudRate: number
  listPorts: boolean
  requestParams: boolean
  heartbeatTimeoutMs: number
  parameterTimeoutMs: number
  holdOpenMs: number
  snapshot: SnapshotFormat
  guidedAction?: GuidedActionId
  executeGuidedAction: boolean
  benchSession: boolean
  executeMotorTest: boolean
  propsRemoved: boolean
  readOnlyExercise?: ReadOnlyExerciseKind
  exerciseTimeoutMs: number
  motorTestOutput?: number
  motorTestThrottlePercent: number
  motorTestDurationSeconds: number
  validateParameterId?: string
  validateParameterValue?: number
  executeParameterValidation: boolean
  restoreAfterValidation: boolean
  parameterWriteVerifyTimeoutMs: number
}

interface GuidedActionDecision {
  allowed: boolean
  reasons: string[]
}

const defaults: RuntimeSerialOptions = {
  baudRate: 115200,
  listPorts: false,
  requestParams: true,
  heartbeatTimeoutMs: 5000,
  parameterTimeoutMs: 20000,
  holdOpenMs: 0,
  snapshot: 'pretty',
  executeGuidedAction: false,
  benchSession: false,
  executeMotorTest: false,
  propsRemoved: false,
  exerciseTimeoutMs: 15000,
  motorTestThrottlePercent: 7,
  motorTestDurationSeconds: 1,
  executeParameterValidation: false,
  restoreAfterValidation: true,
  parameterWriteVerifyTimeoutMs: 3000,
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
  const ports = await NativeSerialTransport.listPorts()

  if (options.listPorts) {
    printPorts(ports)
    return
  }

  if (options.listSnapshotLibrary) {
    await listSnapshotLibraryFile(options.snapshotLibraryFile, '[runtime]')
    return
  }

  const path = resolvePortPath(options, ports)
  const transport = new NativeSerialTransport('runtime-serial', {
    path,
    baudRate: options.baudRate
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata
    }
  })

  let previousSnapshot: ConfiguratorSnapshot | undefined
  let latestSnapshot = runtime.getSnapshot()
  const seenStatusKeys = new Set<string>()
  const unsubscribe = runtime.subscribe((snapshot) => {
    latestSnapshot = snapshot
    logSnapshotDelta(previousSnapshot, snapshot, seenStatusKeys)
    previousSnapshot = snapshot
  })

  try {
    console.log(`[runtime] opening ${path} at ${options.baudRate} baud`)
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: options.heartbeatTimeoutMs })
    console.log(
      `[runtime] vehicle=${vehicle.vehicle} firmware=${vehicle.firmware} sys=${vehicle.systemId} comp=${vehicle.componentId} armed=${vehicle.armed} mode="${vehicle.flightMode}"`
    )

    if (options.requestParams) {
      await runtime.requestParameterList({ timeoutMs: options.heartbeatTimeoutMs })
      const parameterStats = await runtime.waitForParameterSync({ timeoutMs: options.parameterTimeoutMs })
      console.log(
        `[runtime] parameter sync complete ${parameterStats.downloaded}/${parameterStats.total} duplicates=${parameterStats.duplicateFrames}`
      )
    }

    if (options.guidedAction) {
      await maybeRunGuidedAction(runtime, latestSnapshot, options)
      latestSnapshot = runtime.getSnapshot()
    }

    if (options.readOnlyExercise) {
      latestSnapshot = await runReadOnlyExercise(runtime, latestSnapshot, options)
    }

    latestSnapshot = await maybeRunMotorTest(runtime, latestSnapshot, options)
    latestSnapshot = await maybeValidateParameterWrite(runtime, latestSnapshot, options)
    latestSnapshot = await maybeRunSnapshotOperations(runtime, latestSnapshot, options, {
      logPrefix: '[runtime]',
      evaluateRestore: (currentSnapshot) => evaluateSnapshotRestoreDecision(currentSnapshot, options)
    })

    renderSnapshot(latestSnapshot, options.snapshot)

    if (options.holdOpenMs > 0) {
      console.log(`[runtime] holding link open for ${options.holdOpenMs}ms`)
      await sleep(options.holdOpenMs)
    }
  } finally {
    unsubscribe()
    await runtime.disconnect()
    runtime.destroy()
  }
}

function parseArgs(argv: string[]): RuntimeSerialOptions {
  const options = { ...defaults }

  for (const argument of argv) {
    if (argument === '--list-ports') {
      options.listPorts = true
      continue
    }

    if (argument === '--no-request-params') {
      options.requestParams = false
      continue
    }

    if (argument === '--execute-guided-action') {
      options.executeGuidedAction = true
      continue
    }

    if (argument === '--bench-session') {
      options.benchSession = true
      continue
    }

    if (argument === '--execute-motor-test') {
      options.executeMotorTest = true
      continue
    }

    if (argument === '--props-removed') {
      options.propsRemoved = true
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
      case 'path':
        options.path = rawValue
        break
      case 'port-index':
        options.portIndex = Number(rawValue)
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
      case 'hold-open-ms':
        options.holdOpenMs = Number(rawValue)
        break
      case 'snapshot':
        if (rawValue === 'off' || rawValue === 'pretty' || rawValue === 'json') {
          options.snapshot = rawValue
        }
        break
      case 'guided-action':
        if (isGuidedActionId(rawValue)) {
          options.guidedAction = rawValue
        }
        break
      case 'read-only-exercise':
        if (isReadOnlyExerciseKind(rawValue)) {
          options.readOnlyExercise = rawValue
        }
        break
      case 'exercise-timeout-ms':
        options.exerciseTimeoutMs = Number(rawValue)
        break
      case 'motor-test-output':
        options.motorTestOutput = Number(rawValue)
        break
      case 'motor-test-throttle-percent':
        options.motorTestThrottlePercent = Number(rawValue)
        break
      case 'motor-test-duration-s':
        options.motorTestDurationSeconds = Number(rawValue)
        break
      case 'validate-parameter-id':
        options.validateParameterId = rawValue
        break
      case 'validate-parameter-value':
        options.validateParameterValue = Number(rawValue)
        break
      case 'parameter-write-verify-timeout-ms':
        options.parameterWriteVerifyTimeoutMs = Number(rawValue)
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

  return options
}

function isGuidedActionId(value: string): value is GuidedActionId {
  return (
    value === 'request-parameters' ||
    value === 'calibrate-accelerometer' ||
    value === 'calibrate-compass' ||
    value === 'reboot-autopilot'
  )
}

function isReadOnlyExerciseKind(value: string): value is ReadOnlyExerciseKind {
  return value === 'mode-switch' || value === 'rc-ranges' || value === 'rc-mapping'
}

function printPorts(ports: NativeSerialPortInfo[]): void {
  if (ports.length === 0) {
    console.log('[runtime] no serial ports detected')
    return
  }

  console.log('[runtime] serial ports:')
  ports.forEach((port, index) => {
    const details = [
      port.manufacturer,
      port.serialNumber ? `sn=${port.serialNumber}` : undefined,
      port.vendorId ? `vid=${port.vendorId}` : undefined,
      port.productId ? `pid=${port.productId}` : undefined
    ]
      .filter((value): value is string => value !== undefined)
      .join(' | ')
    const recommended = isLikelyFlightControllerPort(port) ? ' [recommended]' : ''

    console.log(`- [${index}] ${port.path}${recommended}${details ? ` :: ${details}` : ''}`)
  })
}

function resolvePortPath(options: RuntimeSerialOptions, ports: NativeSerialPortInfo[]): string {
  if (options.path) {
    return options.path
  }

  if (options.portIndex !== undefined) {
    const selectedPort = ports[options.portIndex]
    if (!selectedPort) {
      throw new Error(`Serial port index ${options.portIndex} is not available.`)
    }
    return selectedPort.path
  }

  const preferredPort = ports.find(isLikelyFlightControllerPort)
  if (preferredPort) {
    return preferredPort.path
  }

  if (ports.length === 1) {
    return ports[0].path
  }

  throw new Error('Unable to infer a serial path. Re-run with --list-ports, --port-index=N, or --path=/dev/tty.*')
}

function isLikelyFlightControllerPort(port: NativeSerialPortInfo): boolean {
  return (
    (port.manufacturer ?? '').toLowerCase().includes('ardupilot') ||
    port.path.includes('usbmodem') ||
    port.path.includes('usbserial')
  )
}

async function maybeRunGuidedAction(
  runtime: ArduPilotConfiguratorRuntime,
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): Promise<void> {
  const action = options.guidedAction
  if (!action) {
    return
  }

  const decision = evaluateGuidedAction(action, snapshot, options)
  const mode = options.executeGuidedAction ? 'execute' : 'dry-run'

  console.log(`[runtime] guided action ${mode}: ${action}`)

  if (decision.reasons.length > 0) {
    decision.reasons.forEach((reason) => {
      console.log(`[runtime] guided action note: ${reason}`)
    })
  }

  if (!options.executeGuidedAction) {
    console.log('[runtime] no MAVLink command sent. Re-run with --execute-guided-action to actually send it.')
    return
  }

  if (!decision.allowed) {
    throw new Error(`Guided action "${action}" is blocked by runtime safeguards.`)
  }

  await runtime.runGuidedAction(action)
  console.log(`[runtime] guided action sent: ${action}`)
}

function evaluateGuidedAction(
  action: GuidedActionId,
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): GuidedActionDecision {
  const reasons: string[] = []

  if (snapshot.connection.kind !== 'connected') {
    reasons.push('The transport is not connected.')
  }

  if (action === 'request-parameters') {
    return {
      allowed: snapshot.connection.kind === 'connected',
      reasons
    }
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

  if (options.executeGuidedAction && !options.benchSession) {
    reasons.push('Pass --bench-session to acknowledge this is an intentional disarmed bench session.')
  }

  return {
    allowed: reasons.length === 0,
    reasons
  }
}

function evaluateSnapshotRestoreDecision(
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): SnapshotRestoreDecision {
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

  if (options.executeSnapshotRestore && !options.benchSession) {
    reasons.push('Pass --bench-session to acknowledge this is an intentional disarmed bench session before restoring a snapshot.')
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

  console.log('[runtime] snapshot summary')
  console.log(`  connection: ${snapshot.connection.kind}`)
  console.log(
    `  vehicle: ${snapshot.vehicle ? `${snapshot.vehicle.vehicle} / ${snapshot.vehicle.firmware}` : 'Waiting for heartbeat'}`
  )
  if (snapshot.vehicle) {
    console.log(`  armed: ${snapshot.vehicle.armed}`)
    console.log(`  mode: ${snapshot.vehicle.flightMode}`)
    console.log(`  target: sys=${snapshot.vehicle.systemId} comp=${snapshot.vehicle.componentId}`)
  }
  console.log(
    `  live rc: ${
      snapshot.liveVerification.rcInput.verified
        ? `${snapshot.liveVerification.rcInput.channelCount} channels, RSSI ${snapshot.liveVerification.rcInput.rssi ?? 'unknown'}`
        : 'not verified'
    }`
  )
  console.log(
    `  live battery: ${
      snapshot.liveVerification.batteryTelemetry.verified
        ? `${snapshot.liveVerification.batteryTelemetry.voltageV ?? 'unknown'} V${
            snapshot.liveVerification.batteryTelemetry.remainingPercent !== undefined
              ? `, ${snapshot.liveVerification.batteryTelemetry.remainingPercent}%`
              : ''
          }`
        : 'not verified'
    }`
  )
  const modeSwitchEstimate = deriveModeSwitchEstimate(snapshot, snapshot.vehicle?.vehicle)
  if (modeSwitchEstimate.channelNumber !== undefined) {
    console.log(
      `  mode switch: CH${modeSwitchEstimate.channelNumber} ${
        modeSwitchEstimate.estimatedSlot !== undefined
          ? `-> ${formatModeSlotLabel(snapshot, modeSwitchEstimate.estimatedSlot, snapshot.vehicle?.vehicle)} at ${modeSwitchEstimate.pwm} us`
          : 'waiting for PWM'
      }`
    )
  }
  const rcAxes = deriveRcAxisObservations(snapshot)
  const rcChannelMap = deriveRcAxisChannelMap(snapshot)
  console.log('  rc axes:')
  rcAxes.forEach((axis) => {
    console.log(
      `    - ${axis.label}: CH${axis.channelNumber} ${axis.pwm !== undefined ? `${axis.pwm} us` : 'no data'} low=${axis.lowDetected ? 'y' : 'n'} high=${axis.highDetected ? 'y' : 'n'}${axis.axisId === 'throttle' ? '' : ` center=${axis.centeredDetected ? 'y' : 'n'}`}`
    )
  })
  console.log(
    `  rc map: roll=CH${rcChannelMap.roll} pitch=CH${rcChannelMap.pitch} throttle=CH${rcChannelMap.throttle} yaw=CH${rcChannelMap.yaw}`
  )
  if (snapshot.preArmStatus.healthy) {
    console.log('  pre-arm: clear')
  } else {
    console.log(`  pre-arm: ${snapshot.preArmStatus.issues.length} active issue(s)`)
    snapshot.preArmStatus.issues.slice(0, 4).forEach((issue) => {
      console.log(`    - ${issue.text}`)
    })
  }
  const outputMapping = deriveOutputMappingSummary(snapshot)
  const escSetup = deriveEscSetupSummary(snapshot)
  console.log(
    `  airframe: ${outputMapping.airframe.frameClassLabel} / ${outputMapping.airframe.frameTypeLabel}`
  )
  console.log(
    `  outputs: motors=${outputMapping.motorOutputs.length}${outputMapping.airframe.expectedMotorCount !== undefined ? `/${outputMapping.airframe.expectedMotorCount}` : ''} aux=${outputMapping.configuredAuxOutputs.length} disabled=${outputMapping.disabledOutputs.length}`
  )
  outputMapping.motorOutputs.slice(0, 8).forEach((output) => {
    console.log(`    - OUT${output.channelNumber}: ${output.functionLabel}`)
  })
  outputMapping.configuredAuxOutputs.slice(0, 4).forEach((output) => {
    console.log(`    - OUT${output.channelNumber}: ${output.functionLabel}`)
  })
  outputMapping.notes.slice(0, 2).forEach((note) => {
    console.log(`    note: ${note}`)
  })
  console.log(`  esc: ${escSetup.pwmTypeLabel} / ${escSetup.calibrationPath}`)
  escSetup.notes.slice(0, 2).forEach((note) => {
    console.log(`    note: ${note}`)
  })
  if (snapshot.motorTest.status !== 'idle') {
    console.log(`  motor test: ${snapshot.motorTest.status} :: ${snapshot.motorTest.summary}`)
  }
  console.log(
    `  parameters: ${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total} status=${snapshot.parameterStats.status} duplicates=${snapshot.parameterStats.duplicateFrames}`
  )
  const activeGuidedActions = Object.values(snapshot.guidedActions).filter((action) => action.status !== 'idle')
  if (activeGuidedActions.length > 0) {
    console.log('  guided actions:')
    activeGuidedActions.forEach((action) => {
      console.log(`    - ${action.actionId}: ${action.status} :: ${action.summary}`)
      action.instructions.slice(0, 2).forEach((instruction) => {
        console.log(`      step: ${instruction}`)
      })
    })
  }
  console.log('  setup:')
  snapshot.setupSections.forEach((section) => {
    console.log(`    - ${statusGlyph(section.status)} ${section.title}: ${section.status}`)
    section.notes.slice(0, 2).forEach((note) => {
      console.log(`      note: ${note}`)
    })
  })
}

function statusGlyph(status: SetupStatus): string {
  if (status === 'complete') {
    return 'ok'
  }
  if (status === 'in-progress') {
    return '..'
  }
  return '!!'
}

function logSnapshotDelta(
  previousSnapshot: ConfiguratorSnapshot | undefined,
  snapshot: ConfiguratorSnapshot,
  seenStatusKeys: Set<string>
): void {
  if (snapshot.connection.kind !== previousSnapshot?.connection.kind) {
    console.log(`[runtime] link=${snapshot.connection.kind}`)
  }

  const previousVehicleKey = previousSnapshot?.vehicle
    ? `${previousSnapshot.vehicle.systemId}:${previousSnapshot.vehicle.componentId}:${previousSnapshot.vehicle.flightMode}:${previousSnapshot.vehicle.armed}`
    : undefined
  const vehicleKey = snapshot.vehicle
    ? `${snapshot.vehicle.systemId}:${snapshot.vehicle.componentId}:${snapshot.vehicle.flightMode}:${snapshot.vehicle.armed}`
    : undefined

  if (snapshot.vehicle && vehicleKey !== previousVehicleKey) {
    console.log(
      `[runtime] heartbeat sys=${snapshot.vehicle.systemId} comp=${snapshot.vehicle.componentId} vehicle=${snapshot.vehicle.vehicle} armed=${snapshot.vehicle.armed} mode="${snapshot.vehicle.flightMode}"`
    )
  }

  const downloaded = snapshot.parameterStats.downloaded
  const previousDownloaded = previousSnapshot?.parameterStats.downloaded ?? -1
  const statusChanged = snapshot.parameterStats.status !== previousSnapshot?.parameterStats.status

  if (downloaded !== previousDownloaded || statusChanged) {
    const shouldPrintProgress =
      statusChanged ||
      downloaded <= 12 ||
      downloaded % 50 === 0 ||
      snapshot.parameterStats.status === 'complete'

    if (shouldPrintProgress) {
      const progressText =
        snapshot.parameterStats.progress === null
          ? snapshot.parameterStats.status
          : `${Math.round(snapshot.parameterStats.progress * 100)}%`
      console.log(
        `[runtime] params status=${snapshot.parameterStats.status} progress=${progressText} downloaded=${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total} duplicates=${snapshot.parameterStats.duplicateFrames}`
      )
    }
  }

  snapshot.statusTexts.forEach((entry) => {
    const key = `${entry.severity}:${entry.text}`
    if (seenStatusKeys.has(key)) {
      return
    }

    seenStatusKeys.add(key)
    console.log(`[runtime] statustext ${entry.severity}: ${entry.text}`)
  })

  if (
    snapshot.motorTest.status !== previousSnapshot?.motorTest.status ||
    snapshot.motorTest.summary !== previousSnapshot?.motorTest.summary
  ) {
    console.log(`[runtime] motor-test status=${snapshot.motorTest.status} summary="${snapshot.motorTest.summary}"`)
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

async function runReadOnlyExercise(
  runtime: ArduPilotConfiguratorRuntime,
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): Promise<ConfiguratorSnapshot> {
  if (options.readOnlyExercise === 'mode-switch') {
    await runModeSwitchExercise(runtime, snapshot, options.exerciseTimeoutMs)
    return runtime.getSnapshot()
  }

  if (options.readOnlyExercise === 'rc-ranges') {
    await runRcRangeExercise(runtime, snapshot, options.exerciseTimeoutMs)
    return runtime.getSnapshot()
  }

  if (options.readOnlyExercise === 'rc-mapping') {
    await runRcMappingExercise(runtime, snapshot, options.exerciseTimeoutMs)
    return runtime.getSnapshot()
  }

  return snapshot
}

async function maybeRunMotorTest(
  runtime: ArduPilotConfiguratorRuntime,
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): Promise<ConfiguratorSnapshot> {
  if (options.motorTestOutput === undefined) {
    return snapshot
  }

  const request: MotorTestRequest = {
    outputChannel: options.motorTestOutput,
    throttlePercent: options.motorTestThrottlePercent,
    durationSeconds: options.motorTestDurationSeconds
  }
  const eligibility = evaluateMotorTestEligibility(snapshot, request)
  const reasons = [...eligibility.reasons]

  if (options.executeMotorTest && !options.benchSession) {
    reasons.push('Pass --bench-session to acknowledge this is an intentional props-off bench session.')
  }
  if (options.executeMotorTest && !options.propsRemoved) {
    reasons.push('Pass --props-removed to confirm all propellers are off the vehicle.')
  }

  const mode = options.executeMotorTest ? 'execute' : 'dry-run'
  console.log(
    `[runtime] motor test ${mode}: OUT${request.outputChannel} throttle=${request.throttlePercent}% duration=${request.durationSeconds}s`
  )
  reasons.forEach((reason) => {
    console.log(`[runtime] motor test note: ${reason}`)
  })

  if (!options.executeMotorTest) {
    console.log('[runtime] no MAVLink command sent. Re-run with --execute-motor-test to actually send it.')
    return snapshot
  }

  if (!eligibility.allowed || !options.benchSession || !options.propsRemoved) {
    throw new Error('Motor test is blocked by runtime safeguards.')
  }

  await runtime.runMotorTest(request)
  await sleep(request.durationSeconds * 1000 + 500)
  return runtime.getSnapshot()
}

async function maybeValidateParameterWrite(
  runtime: ArduPilotConfiguratorRuntime,
  snapshot: ConfiguratorSnapshot,
  options: RuntimeSerialOptions
): Promise<ConfiguratorSnapshot> {
  if (!options.validateParameterId || options.validateParameterValue === undefined) {
    return snapshot
  }

  const parameter = snapshot.parameters.find((candidate) => candidate.id === options.validateParameterId)
  const mode = options.executeParameterValidation ? 'execute' : 'dry-run'
  console.log(
    `[runtime] parameter validation ${mode}: ${options.validateParameterId} -> ${options.validateParameterValue}${
      options.restoreAfterValidation ? ' (restore original value afterward)' : ''
    }`
  )

  if (!parameter) {
    throw new Error(`Parameter ${options.validateParameterId} is not present in the current synced snapshot.`)
  }

  console.log(`[runtime] parameter validation current: ${parameter.id}=${parameter.value}`)

  if (!options.executeParameterValidation) {
    console.log('[runtime] no MAVLink parameter write sent. Re-run with --execute-parameter-validation to actually write it.')
    return snapshot
  }

  if (!options.benchSession) {
    throw new Error('Pass --bench-session to acknowledge this is an intentional disarmed bench session before validating a real parameter write.')
  }

  if (Object.is(parameter.value, options.validateParameterValue)) {
    console.log('[runtime] parameter validation note: requested value already matches the live controller value.')
    return snapshot
  }

  const writeResult = await runtime.setParameter(parameter.id, options.validateParameterValue, {
    verifyTimeoutMs: options.parameterWriteVerifyTimeoutMs
  })
  console.log(
    `[runtime] parameter validation verified: ${writeResult.paramId}=${writeResult.confirmedValue} (previous=${writeResult.previousValue ?? 'unknown'})`
  )

  if (options.restoreAfterValidation && writeResult.previousValue !== undefined) {
    const rollbackResult = await runtime.setParameter(parameter.id, writeResult.previousValue, {
      verifyTimeoutMs: options.parameterWriteVerifyTimeoutMs
    })
    console.log(`[runtime] parameter validation restored: ${rollbackResult.paramId}=${rollbackResult.confirmedValue}`)
  }

  return runtime.getSnapshot()
}

async function runModeSwitchExercise(
  runtime: ArduPilotConfiguratorRuntime,
  initialSnapshot: ConfiguratorSnapshot,
  timeoutMs: number
): Promise<void> {
  const vehicle = initialSnapshot.vehicle?.vehicle
  let state = createModeSwitchExerciseState(initialSnapshot, vehicle)
  if (state.status === 'failed') {
    console.log(`[runtime] mode-switch exercise unavailable: ${state.failureReason ?? 'Unknown reason.'}`)
    return
  }

  console.log('[runtime] read-only exercise: mode-switch')
  console.log(
    `[runtime] exercise targets: ${state.targetSlots.map((slot) => formatModeExerciseTargetLabel(initialSnapshot, slot, vehicle)).join(', ')}`
  )
  if (state.currentTargetSlot !== undefined) {
    console.log(`[runtime] exercise step: move the configured flight-mode control to ${formatModeExerciseTargetLabel(initialSnapshot, state.currentTargetSlot, vehicle)}`)
  }

  const deadline = Date.now() + timeoutMs
  let previous = state

  while (state.status === 'running' && Date.now() < deadline) {
    await sleep(150)
    state = advanceModeSwitchExerciseState(state, runtime.getSnapshot(), vehicle)

    if (state.visitedSlots.length > previous.visitedSlots.length) {
      const visited = state.visitedSlots.filter((slot) => !previous.visitedSlots.includes(slot))
      visited.forEach((slot) => {
        console.log(`[runtime] exercise progress: observed ${formatModeExerciseTargetLabel(runtime.getSnapshot(), slot, vehicle)}`)
      })
    }

    if (state.unexpectedSlots.length > previous.unexpectedSlots.length) {
      const unexpected = state.unexpectedSlots.filter((slot) => !previous.unexpectedSlots.includes(slot))
      unexpected.forEach((slot) => {
        console.log(`[runtime] exercise warning: observed unconfigured slot ${slot}`)
      })
    }

    if (state.currentTargetSlot !== previous.currentTargetSlot && state.currentTargetSlot !== undefined) {
      console.log(
        `[runtime] exercise step: move the configured flight-mode control to ${formatModeExerciseTargetLabel(runtime.getSnapshot(), state.currentTargetSlot, vehicle)}`
      )
    }

    previous = state
  }

  if (state.status === 'running') {
    state = failModeSwitchExerciseState(
      state,
      `Timed out after ${timeoutMs}ms waiting for ${formatModeExerciseTargetLabel(runtime.getSnapshot(), state.currentTargetSlot, vehicle)}.`
    )
  }

  if (state.status === 'passed') {
    console.log('[runtime] exercise result: mode-switch passed')
    return
  }

  console.log(`[runtime] exercise result: mode-switch failed :: ${state.failureReason ?? 'Unknown reason.'}`)
}

async function runRcRangeExercise(
  runtime: ArduPilotConfiguratorRuntime,
  initialSnapshot: ConfiguratorSnapshot,
  timeoutMs: number
): Promise<void> {
  let state = createRcRangeExerciseState(initialSnapshot)
  if (state.status === 'failed') {
    console.log(`[runtime] rc-ranges exercise unavailable: ${state.failureReason ?? 'Unknown reason.'}`)
    return
  }

  console.log('[runtime] read-only exercise: rc-ranges')
  console.log('[runtime] exercise targets: roll, pitch, throttle, yaw')
  if (state.currentTargetAxis !== undefined) {
    console.log(`[runtime] exercise step: ${rcRangeInstruction(state.currentTargetAxis)}`)
  }

  const deadline = Date.now() + timeoutMs
  let previous = state

  while (state.status === 'running' && Date.now() < deadline) {
    await sleep(150)
    state = advanceRcRangeExerciseState(state, runtime.getSnapshot())

    const completedAxes = Object.values(state.axisProgress)
      .filter((axis) => axis.completed && !previous.axisProgress[axis.axisId].completed)
      .map((axis) => axis.label)
    completedAxes.forEach((label) => {
      console.log(`[runtime] exercise progress: ${label} axis complete`)
    })

    if (state.currentTargetAxis !== previous.currentTargetAxis && state.currentTargetAxis !== undefined) {
      console.log(`[runtime] exercise step: ${rcRangeInstruction(state.currentTargetAxis)}`)
    }

    previous = state
  }

  if (state.status === 'running') {
    state = failRcRangeExerciseState(
      state,
      `Timed out after ${timeoutMs}ms waiting for ${state.currentTargetAxis ? formatRcAxisLabel(state.currentTargetAxis) : 'the current'} axis target.`
    )
  }

  if (state.status === 'passed') {
    console.log('[runtime] exercise result: rc-ranges passed')
    return
  }

  console.log(`[runtime] exercise result: rc-ranges failed :: ${state.failureReason ?? 'Unknown reason.'}`)
}

async function runRcMappingExercise(
  runtime: ArduPilotConfiguratorRuntime,
  initialSnapshot: ConfiguratorSnapshot,
  timeoutMs: number
): Promise<void> {
  if (!initialSnapshot.liveVerification.rcInput.verified) {
    console.log('[runtime] rc-mapping exercise unavailable: live RC telemetry is not available.')
    return
  }

  const baselineChannels = [...initialSnapshot.liveVerification.rcInput.channels]
  const capturedMap: Partial<Record<RcAxisId, number>> = {}
  const axes: RcAxisId[] = ['roll', 'pitch', 'throttle', 'yaw']
  const currentMap = deriveRcAxisChannelMap(initialSnapshot)

  console.log('[runtime] read-only exercise: rc-mapping')
  console.log(
    `[runtime] current rcmap: roll=CH${currentMap.roll} pitch=CH${currentMap.pitch} throttle=CH${currentMap.throttle} yaw=CH${currentMap.yaw}`
  )

  for (const axisId of axes) {
    console.log(`[runtime] exercise step: move ${formatRcAxisLabel(axisId)} by itself`)

    const deadline = Date.now() + timeoutMs
    let stableCandidateChannel: number | undefined
    let stableCandidateHits = 0
    let capturedChannel: number | undefined
    let capturedDeltaUs = 0

    while (Date.now() < deadline) {
      await sleep(150)
      const candidate = detectDominantRcChannelChange(runtime.getSnapshot().liveVerification.rcInput.channels, baselineChannels, {
        excludedChannelNumbers: Object.values(capturedMap).filter((channelNumber): channelNumber is number => channelNumber !== undefined)
      })

      if (!candidate) {
        stableCandidateChannel = undefined
        stableCandidateHits = 0
        continue
      }

      if (candidate.channelNumber === stableCandidateChannel) {
        stableCandidateHits += 1
      } else {
        stableCandidateChannel = candidate.channelNumber
        stableCandidateHits = 1
      }

      if (stableCandidateHits >= 2) {
        capturedChannel = candidate.channelNumber
        capturedDeltaUs = candidate.deltaUs
        break
      }
    }

    if (capturedChannel === undefined) {
      console.log(`[runtime] exercise result: rc-mapping failed :: timed out waiting for ${formatRcAxisLabel(axisId)} movement`)
      return
    }

    capturedMap[axisId] = capturedChannel
    console.log(`[runtime] exercise progress: ${formatRcAxisLabel(axisId)} observed on CH${capturedChannel} (${Math.round(capturedDeltaUs)}us delta)`)
  }

  const drafts = deriveRcMapDraftValues(capturedMap, currentMap)
  if (Object.keys(drafts).length === 0) {
    console.log('[runtime] exercise result: rc-mapping passed :: current RCMAP_* values match the observed channels')
    return
  }

  console.log('[runtime] exercise result: rc-mapping mismatch detected')
  Object.entries(drafts).forEach(([paramId, value]) => {
    console.log(`[runtime] exercise draft: ${paramId}=${value}`)
  })
}

function rcRangeInstruction(axisId: RcAxisId): string {
  if (axisId === 'throttle') {
    return 'move Throttle fully low, then fully high'
  }

  return `move ${formatRcAxisLabel(axisId)} fully low, fully high, then back to center`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
