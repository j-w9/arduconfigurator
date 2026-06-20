import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createConnection } from 'node:net'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { resolve } from 'node:path'

export interface ArduPilotSITLLaunchOptions {
  repoPath: string
  pythonExecutable?: string
  vehicle?: string
  frame?: string
  host?: string
  port?: number
  speedup?: number
  wipe?: boolean
  launchTimeoutMs?: number
  extraArgs?: string[]
}

export interface ArduPilotDirectLaunchOptions {
  repoPath: string
  vehicle?: string
  frame?: string
  host?: string
  port?: number
  speedup?: number
  wipe?: boolean
  launchTimeoutMs?: number
  instance?: number
}

export interface ArduPilotSITLProcess {
  readonly child: SimVehicleProcess
  readonly host: string
  readonly port: number
  readonly command: string
  readonly args: string[]
  readonly output: string[]
  stop(): Promise<void>
}

type SimVehicleProcess = ChildProcessByStdio<null, Readable, Readable>

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5760
const DEFAULT_LAUNCH_TIMEOUT_MS = 120000
const OUTPUT_LIMIT = 250

export async function launchArduPilotSITL(options: ArduPilotSITLLaunchOptions): Promise<ArduPilotSITLProcess> {
  const repoPath = resolve(options.repoPath)
  const simVehiclePath = resolve(repoPath, 'Tools/autotest/sim_vehicle.py')

  await access(simVehiclePath, fsConstants.X_OK)

  const pythonExecutable = options.pythonExecutable ?? 'python3'
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const args = [
    simVehiclePath,
    '-v',
    options.vehicle ?? 'ArduCopter',
    '-f',
    options.frame ?? 'quad',
    ...(options.wipe ? ['-w'] : []),
    '--speedup',
    String(options.speedup ?? 1),
    ...(options.extraArgs ?? [])
  ]
  const child = spawn(pythonExecutable, args, {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  const output: string[] = []
  child.stdout.on('data', (chunk: Buffer) => appendOutput(output, 'stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => appendOutput(output, 'stderr', chunk))

  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS

  try {
    await Promise.race([
      waitForTcpPort(host, port, launchTimeoutMs),
      waitForProcessExit(child)
    ])
  } catch (error) {
    await stopChildProcess(child).catch(() => {})
    const detail = output.slice(-25).join('\n')
    throw new Error(
      `Failed to launch ArduPilot SITL via sim_vehicle.py.${detail ? ` Recent output:\n${detail}` : ''}`,
      { cause: error }
    )
  }

  return {
    child,
    host,
    port,
    command: pythonExecutable,
    args,
    output,
    async stop(): Promise<void> {
      await stopChildProcess(child)
    }
  }
}

export async function launchArduPilotDirectBinary(options: ArduPilotDirectLaunchOptions): Promise<ArduPilotSITLProcess> {
  const repoPath = resolve(options.repoPath)
  const vehicle = options.vehicle ?? 'ArduCopter'
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS
  const output: string[] = []
  const wafPath = resolve(repoPath, 'modules/waf/waf-light')
  const binaryPath = resolve(repoPath, `build/sitl/bin/${binaryNameForVehicle(vehicle)}`)

  await access(wafPath, fsConstants.X_OK)

  await runLoggedCommand(wafPath, ['configure', '--board', 'sitl'], repoPath, output, launchTimeoutMs)
  await runLoggedCommand(wafPath, ['build', '--target', `bin/${binaryNameForVehicle(vehicle)}`], repoPath, output, launchTimeoutMs)
  await access(binaryPath, fsConstants.X_OK)

  const args = [
    '--model',
    modelForVehicleFrame(vehicle, options.frame ?? 'quad'),
    '--speedup',
    String(options.speedup ?? 1),
    '--slave',
    '0',
    '--defaults',
    defaultParamsPathForVehicle(vehicle),
    '--sim-address=127.0.0.1',
    `-I${options.instance ?? 0}`,
    ...(options.wipe ? ['-w'] : [])
  ]
  const child = spawn(binaryPath, args, {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })

  child.stdout.on('data', (chunk: Buffer) => appendOutput(output, 'stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => appendOutput(output, 'stderr', chunk))

  try {
    await Promise.race([
      waitForTcpPort(host, port, launchTimeoutMs),
      waitForProcessExit(child)
    ])
  } catch (error) {
    await stopChildProcess(child).catch(() => {})
    const detail = output.slice(-25).join('\n')
    throw new Error(
      `Failed to launch ArduPilot SITL directly from the built binary.${detail ? ` Recent output:\n${detail}` : ''}`,
      { cause: error }
    )
  }

  return {
    child,
    host,
    port,
    command: binaryPath,
    args,
    output,
    async stop(): Promise<void> {
      await stopChildProcess(child)
    }
  }
}

function binaryNameForVehicle(vehicle: string): string {
  switch (vehicle) {
    case 'ArduCopter':
      return 'arducopter'
    case 'ArduPlane':
      return 'arduplane'
    case 'Rover':
      return 'ardurover'
    case 'ArduSub':
      return 'ardusub'
    default:
      throw new Error(`Unsupported direct-launch vehicle: ${vehicle}`)
  }
}

function defaultParamsPathForVehicle(vehicle: string): string {
  switch (vehicle) {
    case 'ArduCopter':
      return 'Tools/autotest/default_params/copter.parm'
    case 'ArduPlane':
      return 'Tools/autotest/default_params/plane.parm'
    case 'Rover':
      return 'Tools/autotest/default_params/rover.parm'
    case 'ArduSub':
      return 'Tools/autotest/default_params/sub.parm'
    default:
      throw new Error(`Unsupported default params vehicle: ${vehicle}`)
  }
}

function modelForVehicleFrame(vehicle: string, frame: string): string {
  if (vehicle === 'ArduCopter' && frame === 'quad') {
    return '+'
  }
  return frame
}

async function waitForTcpPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      await attemptTcpConnection(host, port)
      return
    } catch {
      await sleep(500)
    }
  }

  throw new Error(`Timed out waiting for SITL TCP endpoint ${host}:${port} after ${timeoutMs}ms.`)
}

async function attemptTcpConnection(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port })

    const handleError = (error: Error): void => {
      cleanup()
      socket.destroy()
      reject(error)
    }

    const handleConnect = (): void => {
      cleanup()
      socket.end()
      resolve()
    }

    const cleanup = (): void => {
      socket.off('error', handleError)
      socket.off('connect', handleConnect)
    }

    socket.once('error', handleError)
    socket.once('connect', handleConnect)
  })
}

async function waitForProcessExit(child: SimVehicleProcess): Promise<never> {
  return new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`sim_vehicle.py exited before the TCP endpoint was ready (code=${code ?? 'null'} signal=${signal ?? 'null'}).`))
    })
  })
}

function appendOutput(output: string[], source: 'stdout' | 'stderr', chunk: Buffer): void {
  const text = chunk.toString('utf8').trim()
  if (!text) {
    return
  }

  text.split(/\r?\n/).forEach((line) => {
    output.push(`[${source}] ${line}`)
    if (output.length > OUTPUT_LIMIT) {
      output.splice(0, output.length - OUTPUT_LIMIT)
    }
  })
}

async function runLoggedCommand(
  command: string,
  args: string[],
  cwd: string,
  output: string[],
  timeoutMs: number
): Promise<void> {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk: Buffer) => appendOutput(output, 'stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => appendOutput(output, 'stderr', chunk))

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out running ${command} ${args.join(' ')} after ${timeoutMs}ms.`))
    }, timeoutMs)

    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code=${code ?? 'null'} signal=${signal ?? 'null'}.`))
    })

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function stopChildProcess(child: SimVehicleProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) {
    return
  }

  const processGroupId = -child.pid
  try {
    process.kill(processGroupId, 'SIGINT')
  } catch {
    child.kill('SIGINT')
  }

  const exited = await waitForExit(child, 5000)
  if (exited) {
    return
  }

  try {
    process.kill(processGroupId, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }

  const terminated = await waitForExit(child, 3000)
  if (terminated) {
    return
  }

  try {
    process.kill(processGroupId, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }

  await waitForExit(child, 1000)
}

async function waitForExit(child: SimVehicleProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return true
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      child.off('exit', handleExit)
    }

    const handleExit = (): void => {
      cleanup()
      resolve(true)
    }

    child.once('exit', handleExit)
  })
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
