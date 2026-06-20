import type {
  CanFrameMessage,
  MavlinkSession
} from '@arduconfig/protocol-mavlink'
import {
  DRONECAN_GET_NODE_INFO_SERVICE_ID,
  DRONECAN_GET_NODE_INFO_SIGNATURE,
  DRONECAN_NODE_STATUS_DT_ID,
  DRONECAN_NODE_STATUS_SIGNATURE,
  DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID,
  DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE,
  DRONECAN_PARAM_GETSET_SERVICE_ID,
  DRONECAN_PARAM_GETSET_SIGNATURE,
  DRONECAN_PARAM_OPCODE_SAVE,
  DronecanReassembler,
  decodeDronecanExecuteOpcodeResponse,
  decodeDronecanGetNodeInfoResponse,
  decodeDronecanGetSetResponse,
  decodeDronecanNodeStatus,
  dronecanBuildServiceFrames,
  dronecanIsServiceFrame,
  dronecanIsServiceRequest,
  dronecanMessageTypeId,
  dronecanServiceTypeId,
  dronecanSourceNodeId,
  encodeDronecanExecuteOpcodeRequest,
  encodeDronecanGetSetRequest
} from '@arduconfig/protocol-mavlink'

import type {
  CanBusState,
  CanNodeHealth,
  CanNodeMode,
  DronecanInspectedNode,
  DronecanParamEntry,
  DronecanParamValueState
} from './types.js'
import type { DronecanParamValue } from '@arduconfig/protocol-mavlink'

const MAV_CMD_CAN_FORWARD = 32000

/** GCS-side DroneCAN source node id. 127 = top of 7-bit range, low
 *  collision risk against typical ArduPilot bus inhabitants (10 for AP,
 *  100-126 for peripherals). */
const GCS_DRONECAN_NODE_ID = 127

/** AP_HAL::CANIface::FlagEFF — bit 31 of the MAVLink CAN_FRAME `id` field
 *  marking a 29-bit extended frame. DroneCAN is extended-only, so every
 *  outbound frame must set it.
 *  Source: libraries/AP_HAL/CANIface.h (FlagEFF = 1U << 31). */
const CAN_FRAME_FLAG_EFF = 0x80000000

/** How long to wait between GetNodeInfo retries for an unnamed node. */
const GET_NODE_INFO_RETRY_MS = 4000

/** How long to wait between consecutive parameter index reads. ArduPilot
 *  AP_DroneCAN can be slow under load; 250ms gives every node a chance
 *  to reply before the walk moves on. */
const GET_SET_BATCH_INTERVAL_MS = 250
// SAVE-ACK watchdog: bounds how long a node's pendingSaves slot stays held
// before being freed so a lost SAVE request/response can't orphan it.
const SAVE_ACK_TIMEOUT_MS = 5000

/** Max times the tick may re-request the SAME parameter index without
 *  progress before the walk is abandoned and marked complete with whatever
 *  was fetched. Bounds the walk so a node that never sends the empty-name
 *  terminator can't leave the refresh stuck on "fetching". */
const MAX_GET_SET_RETRIES = 8

/** How often to re-issue MAV_CMD_CAN_FORWARD while a bus is being monitored.
 *  ArduPilot stops forwarding CAN frames to the GCS 5s after the last
 *  MAV_CMD_CAN_FORWARD request (AP_CANManager::can_frame_callback unregisters
 *  the callback once `now - last_callback_enable_ms > 5000`). Without a
 *  keep-alive the initial parameter walk succeeds, then forwarding lapses and
 *  every later read/write/save gets no response — the node link appears to
 *  drop. Re-arm well inside the 5s window (Mission Planner re-sends ~1s). */
const CAN_FORWARD_REARM_INTERVAL_MS = 2000

/** Parameter writes and SAVE are one-shot service calls, but CAN-over-MAVLink
 *  forwarding is best-effort: a dropped request (or its ack) is gone, and
 *  multi-frame writes are the most exposed. Reads survive this because the walk
 *  re-requests; writes/saves get the same resilience via bounded retry until
 *  the node echoes the value (write) or acks the opcode (save). */
const WRITE_RETRY_INTERVAL_MS = 600
const MAX_WRITE_RETRIES = 5
const MAX_SAVE_RETRIES = 3

const HEALTH_TABLE: readonly CanNodeHealth[] = ['ok', 'warning', 'error', 'critical']
const MODE_TABLE: Record<number, CanNodeMode> = {
  0: 'operational',
  1: 'initialization',
  2: 'maintenance',
  3: 'software_update',
  7: 'offline'
}

function healthFromCode(code: number): CanNodeHealth {
  return HEALTH_TABLE[code] ?? 'unknown'
}

function modeFromCode(code: number): CanNodeMode {
  return MODE_TABLE[code] ?? 'unknown'
}

function toParamValueState(value: DronecanParamValue): DronecanParamValueState {
  switch (value.tag) {
    case 'empty':
      return { tag: 'empty' }
    case 'int64':
      return { tag: 'int64', int64: (value.int64 ?? 0n).toString() }
    case 'real32':
      return { tag: 'real32', real32: value.real32 ?? 0 }
    case 'bool':
      return { tag: 'bool', bool: value.bool ?? false }
    case 'string':
      return { tag: 'string', string: value.string ?? '' }
  }
}

function fromParamValueState(state: DronecanParamValueState): DronecanParamValue {
  switch (state.tag) {
    case 'empty':
      return { tag: 'empty' }
    case 'int64':
      return { tag: 'int64', int64: BigInt(state.int64 ?? '0') }
    case 'real32':
      return { tag: 'real32', real32: state.real32 ?? 0 }
    case 'bool':
      return { tag: 'bool', bool: !!state.bool }
    case 'string':
      return { tag: 'string', string: state.string ?? '' }
  }
}

interface MutableNode extends DronecanInspectedNode {
  /** Consecutive tick re-requests of the current paramFetch.nextIndex with no
   *  progress. Reset whenever a fresh parameter advances the walk. Bounded by
   *  MAX_GET_SET_RETRIES so a non-terminating node can't hang the refresh. */
  paramFetchRetries?: number
}

export interface CanBusServiceDeps {
  session: MavlinkSession
  emit: () => void
  appendStatusEntry: (severity: 'info' | 'warning' | 'error', text: string) => void
  getTargetSystem: () => number
  getTargetComponent: () => number
}

/**
 * Owns the CAN tab session: ask the autopilot to forward a bus over the
 * MAVLink tunnel, ingest CAN_FRAME messages, decode DroneCAN traffic,
 * build a node inventory with identity + parameters, and surface write +
 * save service calls back to the bus. Lifecycle is gated entirely by
 * start()/stop() — outside of an active session the snapshot reads
 * `status: 'idle'`.
 */
export class CanBusService {
  private status: CanBusState['status'] = 'idle'
  private bus: number | undefined
  private error: string | undefined
  private framesReceived = 0
  private lastFrameAtMs: number | undefined
  private readonly nodes = new Map<number, MutableNode>()
  private readonly reassembler = new DronecanReassembler({
    getDataTypeSignature: (ctx) => {
      if (!ctx.isService) {
        if (ctx.typeId === DRONECAN_NODE_STATUS_DT_ID) {
          return DRONECAN_NODE_STATUS_SIGNATURE
        }
        return undefined
      }
      switch (ctx.typeId) {
        case DRONECAN_GET_NODE_INFO_SERVICE_ID:
          return DRONECAN_GET_NODE_INFO_SIGNATURE
        case DRONECAN_PARAM_GETSET_SERVICE_ID:
          return DRONECAN_PARAM_GETSET_SIGNATURE
        case DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID:
          return DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE
        default:
          return undefined
      }
    }
  })
  private transferIdCounter = 0
  /** When the last MAV_CMD_CAN_FORWARD keep-alive was issued, so the poll
   *  loop can re-arm forwarding before ArduPilot's 5s timeout lapses. */
  private lastForwardArmAtMs: number | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  /** Tracks the most recent pending ExecuteOpcode by source node so its
   *  response can be wired back to the snapshot's `paramFetch` state. */
  private pendingSaves = new Set<number>()
  /** Per-node SAVE-ACK watchdogs that retry, then free, a pendingSaves entry
   *  if its SAVE request or response frame is lost. */
  private saveAckTimers = new Map<number, ReturnType<typeof setTimeout>>()
  /** Per-node SAVE attempt counts, so the watchdog can retry a lost SAVE a
   *  bounded number of times before giving up. */
  private readonly saveAttempts = new Map<number, number>()
  /** In-flight parameter writes awaiting the node's GetSet echo, keyed
   *  `${nodeId}:${paramName}`. Re-sent by the tick until acknowledged or the
   *  retry budget is spent. */
  private readonly pendingWrites = new Map<
    string,
    { nodeId: number; paramName: string; value: DronecanParamValue; attempts: number; lastSentMs: number }
  >()
  /** Nodes whose writes should be followed by an ExecuteOpcode SAVE once every
   *  pending write for that node has been acknowledged (the "Apply & Save"
   *  action — DroneCAN writes are RAM-only until saved to flash). */
  private readonly saveAfterWrites = new Set<number>()
  /** Nodes to re-fetch (full parameter re-walk) once their Apply & Save SAVE is
   *  acknowledged, so the operator sees fresh values without clicking Re-fetch. */
  private readonly refetchAfterSave = new Set<number>()

  constructor(private readonly deps: CanBusServiceDeps) {}

  getSnapshot(): CanBusState {
    return {
      status: this.status,
      bus: this.bus,
      error: this.error,
      framesReceived: this.framesReceived,
      lastFrameAtMs: this.lastFrameAtMs,
      nodes: Array.from(this.nodes.values())
        .map((node) => ({ ...node, parameters: node.parameters.map((entry) => ({ ...entry })) }))
        .sort((left, right) => left.nodeId - right.nodeId)
    }
  }

  /** Begin forwarding from the given CAN bus index (1 or 2). Resolves on
   *  ACCEPTED ACK, throws on anything else. The session is held open by
   *  the runtime; this service only manages the forward switch. */
  async start(bus: number): Promise<void> {
    if (this.status === 'active' && this.bus === bus) {
      return
    }
    if (this.status === 'active') {
      // Different bus requested — stop the current one first.
      await this.stop()
    }
    this.status = 'requesting'
    this.error = undefined
    this.deps.emit()
    try {
      await this.sendCanForward(bus)
    } catch (err) {
      this.status = 'idle'
      this.error = err instanceof Error ? err.message : 'failed to issue MAV_CMD_CAN_FORWARD'
      this.deps.emit()
      return
    }
    this.bus = bus
    this.status = 'active'
    this.framesReceived = 0
    this.lastFrameAtMs = undefined
    this.nodes.clear()
    this.reassembler.reset()
    this.deps.appendStatusEntry('info', `CAN: forwarding bus ${bus} via MAV_CMD_CAN_FORWARD.`)
    this.startPollTimer()
    this.deps.emit()
  }

  async stop(): Promise<void> {
    if (this.status === 'idle') {
      return
    }
    this.status = 'stopping'
    this.deps.emit()
    try {
      await this.deps.session.send({
        type: 'COMMAND_LONG',
        command: MAV_CMD_CAN_FORWARD,
        targetSystem: this.deps.getTargetSystem(),
        targetComponent: this.deps.getTargetComponent(),
        confirmation: 0,
        params: [0, 0, 0, 0, 0, 0, 0]
      })
    } catch {
      // Best-effort; the autopilot times its own forward state out so we
      // don't strictly need to confirm the stop went through.
    }
    this.stopPollTimer()
    this.status = 'idle'
    this.bus = undefined
    this.lastForwardArmAtMs = undefined
    this.framesReceived = 0
    this.nodes.clear()
    this.reassembler.reset()
    this.pendingSaves.clear()
    this.saveAttempts.clear()
    this.pendingWrites.clear()
    this.saveAfterWrites.clear()
    this.refetchAfterSave.clear()
    this.clearAllSaveAckWatchdogs()
    this.deps.appendStatusEntry('info', 'CAN: forwarding stopped.')
    this.deps.emit()
  }

  /** Wipe all state and tear down the timer. Called by the runtime on
   *  disconnect or shutdown — no MAVLink traffic is emitted from here. */
  reset(): void {
    this.stopPollTimer()
    this.status = 'idle'
    this.bus = undefined
    this.lastForwardArmAtMs = undefined
    this.error = undefined
    this.framesReceived = 0
    this.lastFrameAtMs = undefined
    this.nodes.clear()
    this.reassembler.reset()
    this.pendingSaves.clear()
    this.saveAttempts.clear()
    this.pendingWrites.clear()
    this.saveAfterWrites.clear()
    this.refetchAfterSave.clear()
    this.clearAllSaveAckWatchdogs()
  }

  destroy(): void {
    this.reset()
  }

  /** Feed one CAN_FRAME envelope from the runtime's processEnvelope loop. */
  processCanFrame(message: CanFrameMessage): void {
    if (this.status !== 'active') {
      return
    }
    this.framesReceived += 1
    this.lastFrameAtMs = Date.now()
    const sourceNodeId = dronecanSourceNodeId(message.id)
    const isService = dronecanIsServiceFrame(message.id)
    const typeId = isService ? dronecanServiceTypeId(message.id) : dronecanMessageTypeId(message.id)
    const isRequest = isService ? dronecanIsServiceRequest(message.id) : undefined

    const payload = message.data.subarray(0, message.len)
    if (payload.length === 0) {
      return
    }

    const transferIdBits = payload[payload.length - 1] & 0x1f
    const finished = this.reassembler.push(
      { sourceNodeId, isService, typeId, isRequest, transferId: transferIdBits },
      payload
    )

    if (!finished) {
      return
    }

    if (!finished.isService) {
      if (finished.typeId === DRONECAN_NODE_STATUS_DT_ID) {
        this.handleNodeStatus(finished.sourceNodeId, finished.payload)
      }
      return
    }

    // Service response to an outbound request: typeId is the service id, isRequest is false.
    if (finished.isRequest) {
      return
    }
    switch (finished.typeId) {
      case DRONECAN_GET_NODE_INFO_SERVICE_ID:
        this.handleGetNodeInfoResponse(finished.sourceNodeId, finished.payload)
        return
      case DRONECAN_PARAM_GETSET_SERVICE_ID:
        this.handleGetSetResponse(finished.sourceNodeId, finished.payload)
        return
      case DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID:
        this.handleExecuteOpcodeResponse(finished.sourceNodeId, finished.payload)
        return
    }
  }

  /** Force-refresh a node's identity (re-issue GetNodeInfo). */
  refreshNode(nodeId: number): void {
    if (!this.nodes.has(nodeId)) {
      return
    }
    void this.requestGetNodeInfo(nodeId)
  }

  /** Re-fetch the full parameter list from scratch. */
  fetchAllParameters(nodeId: number): void {
    // Clear any stale error from a prior write/save, and report when the
    // node is no longer on the bus.
    this.error = undefined
    const node = this.nodes.get(nodeId)
    if (!node) {
      this.error = `DroneCAN node ${nodeId} is no longer visible on the bus — re-fetch skipped. Wait for its NodeStatus to reappear or reconnect the bus.`
      this.deps.emit()
      return
    }
    node.parameters = []
    node.paramFetch = { status: 'fetching', nextIndex: 0, lastAttemptAtMs: Date.now() }
    node.paramFetchRetries = 0
    this.deps.emit()
    void this.requestGetSet(nodeId, 0)
  }

  /** Write a parameter on a specific node. The write IS the read — DroneCAN
   *  GetSet returns the post-write value as its response. */
  async writeParameter(nodeId: number, paramName: string, value: DronecanParamValueState): Promise<void> {
    // Surface failures via state.error + emit (callers invoke this
    // fire-and-forget, so a thrown rejection would be silent).
    this.error = undefined
    const node = this.nodes.get(nodeId)
    if (!node) {
      this.error = `No DroneCAN node ${nodeId}`
      this.deps.emit()
      return
    }
    // Register the write so the tick re-sends it until the node echoes the
    // value back (handleGetSetResponse clears it). A lost write frame on the
    // best-effort tunnel would otherwise silently never take.
    const dronecanValue = fromParamValueState(value)
    this.pendingWrites.set(`${nodeId}:${paramName}`, {
      nodeId,
      paramName,
      value: dronecanValue,
      attempts: 1,
      lastSentMs: Date.now()
    })
    await this.sendWrite(nodeId, paramName, dronecanValue)
  }

  /** Apply a batch of staged writes to a node, then SAVE to flash once they're
   *  all acknowledged (the single "Apply & Save" UX). DroneCAN GetSet writes
   *  are RAM-only; without the SAVE they revert on the node's next power cycle.
   *  The SAVE is deferred to handleGetSetResponse (when the node's pending
   *  writes drain) so flash captures the new values, not stale ones. */
  async applyAndSave(nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>): Promise<void> {
    this.error = undefined
    if (!this.nodes.has(nodeId)) {
      this.error = `No DroneCAN node ${nodeId}`
      this.deps.emit()
      return
    }
    // Re-walk this node's params once the save lands, so the UI refreshes
    // without a manual Re-fetch.
    this.refetchAfterSave.add(nodeId)
    if (writes.length === 0) {
      await this.saveParameters(nodeId)
      return
    }
    // Register ALL pending writes synchronously first, so an early ack can't
    // drain the set and fire the SAVE before the rest are queued.
    this.saveAfterWrites.add(nodeId)
    const encoded = writes.map((write) => ({ name: write.name, value: fromParamValueState(write.value) }))
    for (const write of encoded) {
      this.pendingWrites.set(`${nodeId}:${write.name}`, {
        nodeId,
        paramName: write.name,
        value: write.value,
        attempts: 1,
        lastSentMs: Date.now()
      })
    }
    this.deps.emit()
    for (const write of encoded) {
      await this.sendWrite(nodeId, write.name, write.value)
    }
  }

  private hasPendingWriteForNode(nodeId: number): boolean {
    for (const write of this.pendingWrites.values()) {
      if (write.nodeId === nodeId) {
        return true
      }
    }
    return false
  }

  private async sendWrite(nodeId: number, paramName: string, value: DronecanParamValue): Promise<void> {
    try {
      await this.sendServiceCall(nodeId, {
        serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID,
        signature: DRONECAN_PARAM_GETSET_SIGNATURE,
        payload: encodeDronecanGetSetRequest({
          index: 0, // ignored when name is provided
          value,
          name: paramName
        })
      })
    } catch (err) {
      this.error = err instanceof Error ? err.message : `Failed to write ${paramName} on node ${nodeId}`
      this.deps.emit()
    }
  }

  /** Trigger uavcan.protocol.param.ExecuteOpcode SAVE on a node so its
   *  changes persist. */
  async saveParameters(nodeId: number): Promise<void> {
    this.error = undefined
    try {
      if (!this.nodes.has(nodeId)) {
        throw new Error(`No DroneCAN node ${nodeId}`)
      }
      this.pendingSaves.add(nodeId)
      this.saveAttempts.set(nodeId, 1)
      this.armSaveAckWatchdog(nodeId)
      await this.sendSave(nodeId)
    } catch (err) {
      this.pendingSaves.delete(nodeId)
      this.saveAttempts.delete(nodeId)
      this.clearSaveAckWatchdog(nodeId)
      this.error = err instanceof Error ? err.message : `Failed to save parameters on node ${nodeId}`
      this.deps.emit()
    }
  }

  private async sendSave(nodeId: number): Promise<void> {
    await this.sendServiceCall(nodeId, {
      serviceTypeId: DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID,
      signature: DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE,
      payload: encodeDronecanExecuteOpcodeRequest(DRONECAN_PARAM_OPCODE_SAVE, 0n)
    })
  }

  private armSaveAckWatchdog(nodeId: number): void {
    this.clearSaveAckWatchdog(nodeId)
    const timer = setTimeout(() => {
      this.saveAckTimers.delete(nodeId)
      if (!this.pendingSaves.has(nodeId)) {
        return
      }
      const attempts = this.saveAttempts.get(nodeId) ?? 1
      if (attempts < MAX_SAVE_RETRIES && this.status === 'active') {
        // The SAVE request or its ack was likely lost on the best-effort
        // tunnel — resend and re-arm before giving up.
        this.saveAttempts.set(nodeId, attempts + 1)
        void this.sendSave(nodeId)
        this.armSaveAckWatchdog(nodeId)
        return
      }
      this.pendingSaves.delete(nodeId)
      this.saveAttempts.delete(nodeId)
      this.deps.appendStatusEntry(
        'warning',
        `CAN: node ${nodeId} did not acknowledge SAVE after ${attempts} attempt(s) — the request or its reply was lost. Try Save to node again.`
      )
      this.deps.emit()
    }, SAVE_ACK_TIMEOUT_MS)
    // Don't hold a Node test process open on a pending watchdog.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.saveAckTimers.set(nodeId, timer)
  }

  private clearSaveAckWatchdog(nodeId: number): void {
    const timer = this.saveAckTimers.get(nodeId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.saveAckTimers.delete(nodeId)
    }
  }

  private clearAllSaveAckWatchdogs(): void {
    this.saveAckTimers.forEach((timer) => clearTimeout(timer))
    this.saveAckTimers.clear()
  }

  // -------------------------------------------------------------------------
  // Internal: poll loop, request emit, response handlers
  // -------------------------------------------------------------------------

  /** Issue (or re-issue) MAV_CMD_CAN_FORWARD for the given bus. Stamps the
   *  keep-alive time up front so the poll loop won't queue overlapping
   *  re-arms while a send is in flight. Re-arming the SAME bus is idempotent
   *  on the autopilot — it just refreshes the forward timeout. */
  private async sendCanForward(bus: number): Promise<void> {
    this.lastForwardArmAtMs = Date.now()
    await this.deps.session.send({
      type: 'COMMAND_LONG',
      command: MAV_CMD_CAN_FORWARD,
      targetSystem: this.deps.getTargetSystem(),
      targetComponent: this.deps.getTargetComponent(),
      confirmation: 0,
      params: [bus, 0, 0, 0, 0, 0, 0]
    })
  }

  private startPollTimer(): void {
    this.stopPollTimer()
    this.pollTimer = setInterval(() => this.tick(), GET_SET_BATCH_INTERVAL_MS)
  }

  private stopPollTimer(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private tick(): void {
    if (this.status !== 'active') {
      return
    }
    const now = Date.now()
    // Keep ArduPilot's CAN forwarding alive (see CAN_FORWARD_REARM_INTERVAL_MS):
    // re-issue MAV_CMD_CAN_FORWARD before the autopilot's 5s timeout, otherwise
    // forwarding silently stops after the first few seconds and every read /
    // write / save gets no response.
    if (
      this.bus !== undefined &&
      (this.lastForwardArmAtMs === undefined || now - this.lastForwardArmAtMs >= CAN_FORWARD_REARM_INTERVAL_MS)
    ) {
      void this.sendCanForward(this.bus).catch(() => {
        // Best-effort keep-alive; the next tick retries.
      })
    }
    // Re-send in-flight writes the node hasn't echoed yet (best-effort tunnel
    // can drop the request or its ack). Cleared in handleGetSetResponse.
    for (const [key, write] of this.pendingWrites) {
      if (now - write.lastSentMs <= WRITE_RETRY_INTERVAL_MS) {
        continue
      }
      if (write.attempts >= MAX_WRITE_RETRIES) {
        this.pendingWrites.delete(key)
        // Don't SAVE or refetch a partially-applied batch.
        this.saveAfterWrites.delete(write.nodeId)
        this.refetchAfterSave.delete(write.nodeId)
        this.error = `CAN: write to ${write.paramName} on node ${write.nodeId} was not acknowledged after ${MAX_WRITE_RETRIES} attempts — the bus may be congested. Try again.`
        this.deps.emit()
        continue
      }
      write.attempts += 1
      write.lastSentMs = now
      void this.sendWrite(write.nodeId, write.paramName, write.value)
    }
    for (const node of this.nodes.values()) {
      // Identity refresh: request GetNodeInfo until we have a name.
      if (
        !node.name &&
        (node.paramFetch.lastAttemptAtMs === undefined || now - node.paramFetch.lastAttemptAtMs > GET_NODE_INFO_RETRY_MS)
      ) {
        node.paramFetch.lastAttemptAtMs = now
        void this.requestGetNodeInfo(node.nodeId)
      }
      // Parameter list fetch: walk indexes until the node returns an
      // empty-named entry. The first GetSet (index=0, empty value) was
      // queued by handleNodeStatus when the node was first seen.
      if (node.paramFetch.status === 'fetching') {
        if (node.paramFetch.lastAttemptAtMs === undefined ||
            now - node.paramFetch.lastAttemptAtMs > GET_SET_BATCH_INTERVAL_MS * 4) {
          // Bound the retries so a node that never sends the empty-name
          // terminator can't leave the refresh stuck on "fetching" forever.
          const retries = (node.paramFetchRetries ?? 0) + 1
          if (retries > MAX_GET_SET_RETRIES) {
            node.paramFetch.status = 'complete'
            node.paramFetch.error = `Stopped after ${node.parameters.length} parameter(s): node ${node.nodeId} stopped responding to the parameter walk.`
            node.paramFetchRetries = 0
            this.deps.emit()
            continue
          }
          node.paramFetchRetries = retries
          node.paramFetch.lastAttemptAtMs = now
          void this.requestGetSet(node.nodeId, node.paramFetch.nextIndex)
        }
      }
    }
  }

  private upsertNode(nodeId: number): MutableNode {
    let node = this.nodes.get(nodeId)
    const now = Date.now()
    if (!node) {
      node = {
        nodeId,
        health: 'unknown',
        mode: 'unknown',
        parameters: [],
        paramFetch: { status: 'idle', nextIndex: 0 },
        firstSeenAtMs: now,
        lastSeenAtMs: now
      }
      this.nodes.set(nodeId, node)
    }
    return node
  }

  private handleNodeStatus(sourceNodeId: number, payload: Uint8Array): void {
    const status = decodeDronecanNodeStatus(payload)
    if (!status) {
      return
    }
    const node = this.upsertNode(sourceNodeId)
    node.health = healthFromCode(status.health)
    node.mode = modeFromCode(status.mode)
    node.subMode = status.subMode
    node.uptimeSec = status.uptimeSec
    node.vendorStatusCode = status.vendorSpecificStatusCode
    node.lastSeenAtMs = Date.now()

    // First sighting? Kick off identity + parameter fetch.
    if (!node.name) {
      void this.requestGetNodeInfo(sourceNodeId)
    }
    if (node.paramFetch.status === 'idle') {
      node.paramFetch = { status: 'fetching', nextIndex: 0, lastAttemptAtMs: Date.now() }
      void this.requestGetSet(sourceNodeId, 0)
    }
    this.deps.emit()
  }

  private handleGetNodeInfoResponse(sourceNodeId: number, payload: Uint8Array): void {
    const info = decodeDronecanGetNodeInfoResponse(payload)
    if (!info) {
      return
    }
    const node = this.upsertNode(sourceNodeId)
    node.name = info.name || node.name
    node.hwVersion = { major: info.hardwareVersion.major, minor: info.hardwareVersion.minor }
    node.swVersion = {
      major: info.softwareVersion.major,
      minor: info.softwareVersion.minor,
      vcsCommit: info.softwareVersion.vcsCommit,
      imageCrc: info.softwareVersion.imageCrc.toString(16)
    }
    node.hwUniqueId = Array.from(info.hardwareVersion.uniqueId, (b) => b.toString(16).padStart(2, '0')).join('')
    node.lastSeenAtMs = Date.now()
    this.deps.emit()
  }

  private handleGetSetResponse(sourceNodeId: number, payload: Uint8Array): void {
    const response = decodeDronecanGetSetResponse(payload)
    if (!response) {
      return
    }
    const node = this.upsertNode(sourceNodeId)
    node.lastSeenAtMs = Date.now()
    if (!response.name) {
      // Empty name = end of parameter list.
      node.paramFetch.status = 'complete'
      this.deps.emit()
      return
    }
    // The node echoed this param — any in-flight write for it is acknowledged,
    // so the tick stops re-sending it.
    this.pendingWrites.delete(`${sourceNodeId}:${response.name}`)
    // Apply & Save: once every write for this node has been acked, persist to
    // flash so the changes survive a power cycle.
    if (this.saveAfterWrites.has(sourceNodeId) && !this.hasPendingWriteForNode(sourceNodeId)) {
      this.saveAfterWrites.delete(sourceNodeId)
      void this.saveParameters(sourceNodeId)
    }
    const entry: DronecanParamEntry = {
      index: node.paramFetch.nextIndex,
      name: response.name,
      value: toParamValueState(response.value),
      defaultValue: !isEmptyValue(response.defaultValue) ? toParamValueState(response.defaultValue) : undefined,
      minValue: !isEmptyValue(response.minValue) ? toParamValueState(response.minValue) : undefined,
      maxValue: !isEmptyValue(response.maxValue) ? toParamValueState(response.maxValue) : undefined,
      lastFetchedAtMs: Date.now()
    }
    // Only advance nextIndex on a FRESH name (one not already in the table),
    // so a duplicate response from a tick-retry race can't skip an index.
    const existing = node.parameters.findIndex((p) => p.name === entry.name)
    if (existing >= 0) {
      // Late duplicate from a tick retry: keep the latest value but don't
      // advance the walk cursor.
      node.parameters[existing] = entry
      this.deps.emit()
      return
    }
    node.parameters.push(entry)
    node.paramFetch.nextIndex += 1
    // Progress made — reset the no-progress retry budget.
    node.paramFetchRetries = 0
    // Record the in-flight request time so the tick doesn't fire a
    // duplicate request for the same index.
    node.paramFetch.lastAttemptAtMs = Date.now()
    this.deps.emit()
    // Request the next index immediately; the tick loop only retries if
    // this in-flight request is genuinely lost.
    void this.requestGetSet(sourceNodeId, node.paramFetch.nextIndex)
  }

  private handleExecuteOpcodeResponse(sourceNodeId: number, payload: Uint8Array): void {
    const response = decodeDronecanExecuteOpcodeResponse(payload)
    if (!response) {
      return
    }
    if (this.pendingSaves.has(sourceNodeId)) {
      this.pendingSaves.delete(sourceNodeId)
      this.saveAttempts.delete(sourceNodeId)
      this.clearSaveAckWatchdog(sourceNodeId)
      this.deps.appendStatusEntry(
        response.ok ? 'info' : 'warning',
        response.ok
          ? `CAN: node ${sourceNodeId} saved its parameters.`
          : `CAN: node ${sourceNodeId} refused SAVE (argument=${response.argument}).`
      )
      // Apply & Save: re-fetch so the UI shows fresh values without a manual
      // Re-fetch (only on a successful save).
      if (this.refetchAfterSave.delete(sourceNodeId) && response.ok) {
        this.fetchAllParameters(sourceNodeId)
      }
    }
    this.deps.emit()
  }

  private async requestGetNodeInfo(destNodeId: number): Promise<void> {
    await this.sendServiceCall(destNodeId, {
      serviceTypeId: DRONECAN_GET_NODE_INFO_SERVICE_ID,
      signature: DRONECAN_GET_NODE_INFO_SIGNATURE,
      payload: new Uint8Array(0)
    })
  }

  private async requestGetSet(destNodeId: number, index: number): Promise<void> {
    const payload = encodeDronecanGetSetRequest({
      index,
      value: { tag: 'empty' }, // empty value = read
      name: ''
    })
    await this.sendServiceCall(destNodeId, {
      serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID,
      signature: DRONECAN_PARAM_GETSET_SIGNATURE,
      payload
    })
  }

  private async sendServiceCall(
    destNodeId: number,
    parts: { serviceTypeId: number; signature: bigint; payload: Uint8Array }
  ): Promise<void> {
    if (this.status !== 'active') {
      return
    }
    const transferId = this.nextTransferId()
    const frames = dronecanBuildServiceFrames(
      {
        serviceTypeId: parts.serviceTypeId,
        signature: parts.signature,
        destinationNodeId: destNodeId,
        sourceNodeId: GCS_DRONECAN_NODE_ID,
        transferId,
        isRequest: true
      },
      parts.payload
    )
    for (const frame of frames) {
      const data = new Uint8Array(8)
      data.set(frame.data.subarray(0, Math.min(frame.data.length, 8)), 0)
      try {
        await this.deps.session.send({
          type: 'CAN_FRAME',
          targetSystem: this.deps.getTargetSystem(),
          targetComponent: this.deps.getTargetComponent(),
          // CAN_FRAME's `bus` field is 0-indexed on the wire; `this.bus`
          // holds the UI's 1-indexed value (MAV_CMD_CAN_FORWARD param1).
          bus: (this.bus ?? 1) - 1,
          len: frame.data.length,
          // Mark as 29-bit extended (see CAN_FRAME_FLAG_EFF); >>> 0 keeps the
          // high bit through JS signed-32 bitwise ops.
          id: (frame.canId | CAN_FRAME_FLAG_EFF) >>> 0,
          data
        })
      } catch {
        // Best-effort; the polling tick will retry.
        return
      }
    }
  }

  private nextTransferId(): number {
    this.transferIdCounter = (this.transferIdCounter + 1) & 0x1f
    return this.transferIdCounter
  }
}

function isEmptyValue(value: DronecanParamValue | undefined): boolean {
  return !value || value.tag === 'empty'
}
