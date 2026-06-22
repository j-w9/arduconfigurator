// Runtime/transport construction, extracted from App.tsx as part of its
// decomposition. `createRuntime` is the single place that maps a selected
// transport mode to a concrete transport (Web Serial / WebSocket / in-browser
// demo mock), wraps it in a MAVLink session, and wires the per-vehicle metadata
// bundles into the configurator runtime. Pure factory — no React, no app state.

import { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import {
  arducopterMetadata,
  arduplaneMetadata,
  arduroverMetadata,
  ardusubMetadata
} from '@arduconfig/param-metadata'
import {
  MavlinkSession,
  MavlinkV2Codec,
  createArduCopterMockScenario,
  createArduPlaneMockScenario,
  createArduRoverMockScenario,
  createArduSubMockScenario,
  type MavlinkSessionOptions
} from '@arduconfig/protocol-mavlink'
import {
  DirectSocketsTcpTransport,
  DirectSocketsUdpTransport,
  MockTransport,
  WebSerialTransport,
  WebSocketTransport,
  type WebSerialPortLike
} from '@arduconfig/transport'

import { getDesktopBridge } from './desktop-bridge'
import { DesktopSocketTransport } from './desktop-socket-transport'
import type { TransportMode } from './hooks/use-transport-selection'

// Parses the "UDP (direct)" target field into a neutral shape. "host:port"
// connects to a fixed remote; ":port" or a bare "port" binds locally and learns
// the peer from the first datagram (the ELRS / Mission-Planner-UDP-listen case).
export function parseUdpTarget(target: string): { localPort?: number; remoteHost?: string; remotePort?: number } {
  const trimmed = target.trim()
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon <= 0) {
    const portText = trimmed.startsWith(':') ? trimmed.slice(1) : trimmed
    const port = Number.parseInt(portText, 10)
    return Number.isFinite(port) ? { localPort: port } : {}
  }
  const host = trimmed.slice(0, lastColon)
  const port = Number.parseInt(trimmed.slice(lastColon + 1), 10)
  return Number.isFinite(port) ? { remoteHost: host, remotePort: port } : {}
}

// TCP is always a fixed remote, so the target must be "host:port".
export function parseTcpTarget(target: string): { host: string; port: number } | undefined {
  const trimmed = target.trim()
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon <= 0) {
    return undefined
  }
  const host = trimmed.slice(0, lastColon)
  const port = Number.parseInt(trimmed.slice(lastColon + 1), 10)
  return Number.isFinite(port) ? { host, port } : undefined
}

export function createRuntime(
  mode: TransportMode,
  websocketUrl: string,
  udpTarget: string,
  tcpTarget: string,
  serialPort: WebSerialPortLike | (() => WebSerialPortLike | undefined) | undefined,
  onSerialPortSelected?: (port: WebSerialPortLike) => void,
  // Optional live-recording hooks. The App owns a SessionRecorder and passes
  // hooks that delegate to it; the recorder decides per-frame whether to
  // capture (only while recording is active). Keeping the hooks here — rather
  // than the recorder itself — preserves this factory's pure shape and lets the
  // App control recording lifecycle independently of runtime construction.
  sessionHooks?: MavlinkSessionOptions
): ArduPilotConfiguratorRuntime {
  const transport = (() => {
    if (mode === 'web-serial') {
      return new WebSerialTransport('browser-serial', {
        baudRate: 115200,
        port: serialPort,
        onPortSelected: onSerialPortSelected
      })
    }

    if (mode === 'websocket') {
      return new WebSocketTransport('browser-websocket', {
        url: websocketUrl
      })
    }

    if (mode === 'udp') {
      const target = parseUdpTarget(udpTarget)
      const socket = getDesktopBridge()?.socket
      if (socket) {
        return new DesktopSocketTransport('browser-udp', {
          bridge: socket,
          kind: 'udp',
          localPort: target.localPort,
          remoteHost: target.remoteHost,
          remotePort: target.remotePort
        })
      }
      return new DirectSocketsUdpTransport('browser-udp', {
        localPort: target.localPort,
        remoteAddress: target.remoteHost,
        remotePort: target.remotePort
      })
    }

    if (mode === 'tcp') {
      const target = parseTcpTarget(tcpTarget) ?? { host: '127.0.0.1', port: 5760 }
      const socket = getDesktopBridge()?.socket
      if (socket) {
        return new DesktopSocketTransport('browser-tcp', {
          bridge: socket,
          kind: 'tcp',
          remoteHost: target.host,
          remotePort: target.port
        })
      }
      return new DirectSocketsTcpTransport('browser-tcp', {
        remoteAddress: target.host,
        remotePort: target.port
      })
    }

    // Browser demo runtime opts in to the slow dynamic state machine so the
    // UI can exercise battery telemetry warnings, the failsafe banner, and
    // the EKF notice without a real vehicle. Tests that use the scenario
    // directly (without dynamicCadenceMs) still see the static legacy mock.
    //
    // Test-only hook: ?demoParamOverrides=NAME:value,NAME2:null lets e2e
    // tests drive subsystem-disabled states (e.g. BATT_MONITOR=0 to
    // exercise the Failsafe view's #481 disabled-monitor collapse).
    const parameterOverrides = readDemoParamOverridesFromUrl()
    const scenarioOptions = { dynamicCadenceMs: 7000, parameterOverrides }
    const scenario = mode === 'demo-plane'
      ? createArduPlaneMockScenario(scenarioOptions)
      : mode === 'demo-rover'
        ? createArduRoverMockScenario(scenarioOptions)
        : mode === 'demo-sub'
          ? createArduSubMockScenario(scenarioOptions)
          : createArduCopterMockScenario(scenarioOptions)
    return new MockTransport(
      mode === 'demo-plane'
        ? 'mock-arduplane'
        : mode === 'demo-rover'
          ? 'mock-ardurover'
          : mode === 'demo-sub'
            ? 'mock-ardusub'
            : 'mock-arducopter',
      {
      initialFrames: scenario.initialFrames,
      respondToOutbound: scenario.respondToOutbound,
      dynamicEmitter: scenario.attachDynamicEmitter,
      // Paces only the initial param-response burst (telemetry rides the
      // independent dynamicEmitter). The mock delivers inbound frames on a
      // single serialized timeline, so a slow burst parks command ACKs
      // (PREFLIGHT_CALIBRATION, PREFLIGHT_STORAGE) behind every pending
      // PARAM_VALUE — connectViaHeader returns on vehicle-detect, well before
      // sync, so a calibration/erase clicked mid-burst would time out its ACK.
      // 2ms drains the full param set (~1030 params after seeding every OSD
      // element's X/Y) in ~2s, keeping ACKs prompt and the demo connect snappy.
      // (Was 4ms for ~566 params; the larger set parked command ACKs long
      // enough at 4ms to time out calibration/FTP/erase e2e.) Frame count is
      // unchanged, so this doesn't reintroduce the contended-runner
      // callback-drift that chunkSize:7 caused.
      frameIntervalMs: 2,
      responseDelayMs: 20,
      // Deliver whole frames (no artificial byte-fragmentation) for the
      // in-browser demo. chunkSize:7 split every PARAM_VALUE into ~5 chunks
      // on the transport's serialized delivery timeline, which 5x'd the
      // scheduled-callback count during the param sync and let the timeline
      // drift well ahead of wall-clock on contended CI runners — ballooning
      // connect time until the guided-calibration e2e blew its test budget.
      // The transport's chunk/reassembly path stays covered by
      // transport.test.mjs (which sets its own chunkSize:7).
      chunkSize: 0
    })
  })()
  const session = new MavlinkSession(transport, new MavlinkV2Codec(), undefined, sessionHooks)
  return new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata,
      ArduRover: arduroverMetadata,
      ArduSub: ardusubMetadata
    }
  })
}

// Parses ?demoParamOverrides=NAME:value,NAME2:null,NAME3:3.14 into the
// MockScenarioOptions parameterOverrides shape. Returns undefined if the
// query param is absent or empty, so production users see no behaviour
// change. Numbers must parse as finite; an unparseable value is skipped
// (silently — this is a test affordance, not a UI feature).
function readDemoParamOverridesFromUrl(): Record<string, number | null> | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  const raw = new URLSearchParams(window.location.search).get('demoParamOverrides')
  if (!raw) {
    return undefined
  }
  const overrides: Record<string, number | null> = {}
  for (const entry of raw.split(',')) {
    const [name, value] = entry.split(':', 2)
    if (!name) continue
    const id = name.trim()
    if (!id) continue
    if (value === undefined || value.trim() === '' || value.trim().toLowerCase() === 'null') {
      overrides[id] = null
      continue
    }
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) continue
    overrides[id] = parsed
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined
}
