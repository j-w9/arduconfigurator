import { ArduPilotConfiguratorRuntime, type ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { arducopterMetadata } from '@arduconfig/param-metadata'
import { MavlinkSession, MavlinkV2Codec, createArduCopterMockScenario } from '@arduconfig/protocol-mavlink'
import { MockTransport } from '@arduconfig/transport'

export interface MockSITLOptions {
  frameIntervalMs?: number
  responseDelayMs?: number
  chunkSize?: number
}

export interface MockSITLInstance {
  runtime: ArduPilotConfiguratorRuntime
  transport: MockTransport
  connect(): Promise<void>
  connectAndSync(options?: { heartbeatTimeoutMs?: number; parameterTimeoutMs?: number }): Promise<ConfiguratorSnapshot>
  disconnect(): Promise<void>
  destroy(): void
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5000
const DEFAULT_PARAMETER_TIMEOUT_MS = 20000

export function createMockSITL(options: MockSITLOptions = {}): MockSITLInstance {
  const scenario = createArduCopterMockScenario()
  const transport = new MockTransport('mock-sitl-arducopter', {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    frameIntervalMs: options.frameIntervalMs ?? 1,
    responseDelayMs: options.responseDelayMs ?? 1,
    chunkSize: options.chunkSize ?? 0
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
  })

  return {
    runtime,
    transport,
    async connect(): Promise<void> {
      await runtime.connect()
    },
    async connectAndSync(syncOptions = {}): Promise<ConfiguratorSnapshot> {
      await runtime.connect()
      await runtime.waitForVehicle({ timeoutMs: syncOptions.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS })
      await runtime.requestParameterList({ timeoutMs: syncOptions.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS })
      await runtime.waitForParameterSync({ timeoutMs: syncOptions.parameterTimeoutMs ?? DEFAULT_PARAMETER_TIMEOUT_MS })
      return runtime.getSnapshot()
    },
    async disconnect(): Promise<void> {
      await runtime.disconnect()
    },
    destroy(): void {
      runtime.destroy()
    }
  }
}
