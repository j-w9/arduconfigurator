// A simulated SLCAN adapter on the demo DroneCAN bus: the same nodes,
// parameters, ESC telemetry and plain-CAN traffic the demo autopilot forwards,
// spoken as SLCAN over a pretend serial port. Drives the CAN tab's adapter
// path in demo mode and e2e without hardware.

import { encodeSlcanFrame, parseSlcanLine, type SlcanByteIo } from '@arduconfig/can-core'
import { canFrameFromRawId } from '@arduconfig/can-core'
import { createDronecanBusSimulator, type CanFdFrameMessage, type CanFrameMessage } from '@arduconfig/protocol-mavlink'

const encoder = new TextEncoder()
const MAV_CMD_CAN_FORWARD = 32000

export function createDemoSlcanIo(): SlcanByteIo {
  const sim = createDronecanBusSimulator({ unallocatedNode: true })
  const dataListeners = new Set<(bytes: Uint8Array) => void>()
  const statusListeners = new Set<(status: { kind: string }) => void>()
  const decoder = new TextDecoder()
  let buffer = ''
  let open = false
  let timers: ReturnType<typeof setInterval>[] = []

  const emitText = (text: string) => {
    const bytes = encoder.encode(text)
    // Off the caller's stack, as a real port delivers.
    setTimeout(() => dataListeners.forEach((listener) => listener(bytes)), 0)
  }
  const emitFrames = (messages: readonly (CanFrameMessage | CanFdFrameMessage)[]) => {
    if (!open || messages.length === 0) return
    let text = ''
    for (const message of messages) {
      const frame = canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: message.id, data: message.data.subarray(0, message.len) })
      text += encodeSlcanFrame({ id: frame.id, extended: frame.extended, rtr: frame.rtr, fd: message.type === 'CANFD_FRAME', data: frame.data })
    }
    emitText(text)
  }

  const stop = () => {
    open = false
    timers.forEach((timer) => clearInterval(timer))
    timers = []
  }

  const handleLine = (line: string) => {
    const command = line[0]
    if ('tTdDrR'.includes(command ?? '')) {
      const parsed = parseSlcanLine(line)
      if (!parsed || parsed.kind !== 'frame' || !open) {
        emitText('\x07')
        return
      }
      emitText(parsed.rawId & 0x80000000 ? 'Z\r' : 'z\r')
      const message: CanFrameMessage = {
        type: 'CAN_FRAME',
        targetSystem: 0,
        targetComponent: 0,
        bus: 0,
        len: parsed.data.length,
        id: parsed.rawId,
        data: (() => {
          const data = new Uint8Array(8)
          data.set(parsed.data.subarray(0, 8))
          return data
        })()
      }
      emitFrames(sim.handleOutbound(message))
      return
    }
    switch (command) {
      case 'O':
      case 'L':
        if (!open) {
          open = true
          // The simulator starts its bus on the forwarding command.
          sim.handleOutbound({ type: 'COMMAND_LONG', command: MAV_CMD_CAN_FORWARD, targetSystem: 1, targetComponent: 1, confirmation: 0, params: [1, 0, 0, 0, 0, 0, 0] })
          emitFrames(sim.broadcasts())
          timers.push(
            setInterval(() => emitFrames(sim.broadcasts()), 1000),
            setInterval(() => emitFrames(sim.plainTraffic(Date.now())), 25)
          )
        }
        emitText('\r')
        return
      case 'C':
        stop()
        emitText('\r')
        return
      case 'S':
        emitText(/^S[0-8]$/.test(line) ? '\r' : '\x07')
        return
      case 'V':
        emitText('V1010\r')
        return
      default:
        emitText('\x07')
    }
  }

  return {
    async connect() {
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
    },
    async disconnect() {
      stop()
      statusListeners.forEach((listener) => listener({ kind: 'disconnected' }))
    },
    async send(bytes) {
      buffer += decoder.decode(bytes)
      let index = buffer.indexOf('\r')
      while (index !== -1) {
        handleLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\r')
      }
    },
    onFrame(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    }
  }
}
