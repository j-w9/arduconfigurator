// The CAN tab on a USB-CAN adapter instead of the autopilot's forwarding.
//
// The same CanBusService runs it -- node discovery, parameters, save, restart,
// firmware update, the frame feed, Send -- with its MAVLink side replaced: the
// CAN_FRAME / CANFD_FRAME it would send go to the adapter, the adapter's frames
// come back in as CAN_FRAME, and the forwarding command (and its keep-alive)
// has nothing to do. No vehicle, no MAVLink session, no runtime.

import type { CanAdapter, CanFrame } from '@arduconfig/can-core'
import { canFrameFromRawId } from '@arduconfig/can-core'
import type { CanFdFrameMessage, CanFrameMessage, MavlinkMessage, MavlinkSession } from '@arduconfig/protocol-mavlink'

import { CanBusService } from './runtime-can-bus-service.js'
import type { CanBusState, DronecanParamValueState } from './types.js'

type CanFrameOut = { id: number; extended: boolean; data: Uint8Array; fd?: boolean; rtr?: boolean }

export class AdapterCanBus {
  private readonly service: CanBusService
  private readonly listeners = new Set<() => void>()
  private snapshot: CanBusState
  private unsubscribers: (() => void)[] = []
  private adapterOpen = false
  /** Why the adapter closed by itself, if it did. */
  closedReason: string | undefined

  constructor(readonly adapter: CanAdapter) {
    // Only send() is used by the service; everything it sends is routed here.
    const session = { send: (message: MavlinkMessage) => this.route(message) } as unknown as MavlinkSession
    this.service = new CanBusService({
      session,
      emit: () => this.notify(),
      appendStatusEntry: () => {},
      getTargetSystem: () => 0,
      getTargetComponent: () => 0
    })
    this.snapshot = this.service.getSnapshot()
  }

  getSnapshot(): CanBusState {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Open the adapter and start listening. */
  async start(): Promise<void> {
    this.closedReason = undefined
    await this.adapter.open()
    this.adapterOpen = true
    this.unsubscribers.push(
      this.adapter.onFrame((input) => {
        const fd = input.fd ?? false
        const data = new Uint8Array(fd ? 64 : 8)
        data.set(input.data.subarray(0, data.length))
        const message = { targetSystem: 0, targetComponent: 0, bus: 0, len: input.data.length, id: input.rawId, data }
        if (fd) this.service.processCanFdFrame({ type: 'CANFD_FRAME', ...message } as CanFdFrameMessage)
        else this.service.processCanFrame({ type: 'CAN_FRAME', ...message } as CanFrameMessage)
      }),
      this.adapter.onClose((reason) => {
        this.closedReason = reason
        void this.stop()
      })
    )
    await this.service.start(1)
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    await this.service.stop()
    if (this.adapterOpen) {
      this.adapterOpen = false
      await this.adapter.close().catch(() => {})
    }
    this.notify()
  }

  // The runtime's CAN surface, under the same names, so the CAN tab drives
  // either one.
  onCanFrame(listener: (frame: CanFrame) => void): () => void {
    return this.service.onFrame(listener)
  }
  async sendCanFrames(frames: readonly CanFrameOut[]): Promise<void> {
    await this.service.sendFrames(frames)
  }
  refreshCanBusNode(nodeId: number): void {
    this.service.refreshNode(nodeId)
  }
  async restartCanBusNode(nodeId: number): Promise<void> {
    return this.service.restartNode(nodeId)
  }
  fetchAllCanBusParameters(nodeId: number): void {
    this.service.fetchAllParameters(nodeId)
  }
  async writeCanBusParameter(nodeId: number, paramName: string, value: DronecanParamValueState): Promise<void> {
    return this.service.writeParameter(nodeId, paramName, value)
  }
  async saveCanBusParameters(nodeId: number): Promise<void> {
    return this.service.saveParameters(nodeId)
  }
  async applyAndSaveCanBusParameters(nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>): Promise<void> {
    return this.service.applyAndSave(nodeId, writes)
  }
  async startCanBusNodeFirmwareUpdate(nodeId: number, fileName: string, image: Uint8Array): Promise<void> {
    return this.service.startFirmwareUpdate(nodeId, fileName, image)
  }
  cancelCanBusNodeFirmwareUpdate(): void {
    this.service.cancelFirmwareUpdate()
  }
  async changeCanBusNodeId(nodeId: number, newNodeId: number): Promise<void> {
    return this.service.changeNodeId(nodeId, newNodeId)
  }
  setCanNodeAllocator(enabled: boolean, seed?: readonly { nodeId: number; uniqueId: string }[]): void {
    this.service.setAllocatorEnabled(enabled, seed)
  }
  forgetCanNodeAllocations(): void {
    this.service.forgetAllocations()
  }

  private notify(): void {
    this.snapshot = this.service.getSnapshot()
    for (const listener of this.listeners) listener()
  }

  /** What the service would have sent over MAVLink. */
  private async route(message: MavlinkMessage): Promise<void> {
    if (message.type === 'CAN_FRAME' || message.type === 'CANFD_FRAME') {
      const frame = canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: message.id, data: message.data.subarray(0, message.len) })
      await this.adapter.send({ id: frame.id, extended: frame.extended, rtr: frame.rtr, fd: message.type === 'CANFD_FRAME', data: frame.data })
    }
    // MAV_CMD_CAN_FORWARD and its keep-alive: an adapter is always "forwarding".
  }
}
