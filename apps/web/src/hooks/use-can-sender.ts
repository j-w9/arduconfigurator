// The CAN tab's sender: send a frame (or a DroneCAN transfer) once or on a
// repeat, keep a history, and pair each DroneCAN request with its response.
//
// A repeat is the dangerous part -- an ESC command left looping keeps a motor
// spinning -- so it stops itself the moment the vehicle arms, the bus stops
// being forwarded, the Send page is left, or (for a motion send) the motor
// safety box is unticked.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanFrame } from '@arduconfig/can-core'
import { DronecanTransferDecoder, dronecanCatalogue, type DronecanTransfer } from '@arduconfig/dronecan-dsdl'

import { CAN_SEND_MIN_PERIOD_MS, type CanSendFrame, type CanSendHazard } from '../view-models/can-send'

/** The slice of the runtime the sender needs. */
export interface CanFrameSink {
  sendCanFrames(frames: readonly CanSendFrame[]): Promise<void>
  onCanFrame(listener: (frame: CanFrame) => void): () => void
}

export interface CanSendJob {
  /** "NodeStatus", "ID 123", ... */
  label: string
  hazard: CanSendHazard
  /** The frames for one send; DroneCAN jobs take the transfer id to use. */
  build: (transferId: number) => CanSendFrame[]
  /** A DroneCAN send: its transfer-id counter, and (for a request) the response to wait for. */
  dronecan?: { counterKey: string; request?: { serviceTypeId: number; destinationNodeId: number; sourceNodeId: number } }
}

export type CanSendStatus = 'sent' | 'awaiting' | 'answered' | 'no answer' | 'failed' | 'repeating' | 'stopped'

export interface CanSendHistoryEntry {
  id: number
  atMs: number
  label: string
  frames: CanSendFrame[]
  status: CanSendStatus
  /** Sends so far, for a repeat. */
  count: number
  periodMs?: number
  transferId?: number
  response?: DronecanTransfer
  /** Why it failed, or why a repeat stopped. */
  note?: string
}

/** How long a request waits for its response (DroneCAN's default service timeout is 1 s). */
export const CAN_SEND_RESPONSE_TIMEOUT_MS = 1500
const HISTORY_LIMIT = 50

export interface UseCanSenderResult {
  history: readonly CanSendHistoryEntry[]
  /** The running repeat's history id, if any. */
  repeatingId: number | undefined
  send: (job: CanSendJob) => Promise<void>
  startRepeat: (job: CanSendJob, periodMs: number) => void
  stopRepeat: (note?: string) => void
  clearHistory: () => void
}

export function useCanSender(options: {
  sink: CanFrameSink | undefined
  /** The bus is being forwarded. */
  active: boolean
  armed: boolean
  /** The Send page is on screen. */
  visible: boolean
  /** The shared motor-safety acknowledgement. */
  motionAcknowledged: boolean
}): UseCanSenderResult {
  const { sink, active, armed, visible, motionAcknowledged } = options
  const [history, setHistory] = useState<CanSendHistoryEntry[]>([])
  const [repeatingId, setRepeatingId] = useState<number | undefined>(undefined)
  const nextId = useRef(1)
  const transferIds = useRef(new Map<string, number>())
  const repeat = useRef<{ id: number; timer: ReturnType<typeof setInterval>; hazard: CanSendHazard; count: number } | undefined>(undefined)
  const pending = useRef(
    new Map<string, { historyId: number; timer: ReturnType<typeof setTimeout> }>()
  )

  const update = useCallback((id: number, change: (entry: CanSendHistoryEntry) => CanSendHistoryEntry) => {
    setHistory((current) => current.map((entry) => (entry.id === id ? change(entry) : entry)))
  }, [])

  const add = useCallback((entry: Omit<CanSendHistoryEntry, 'id'>): number => {
    const id = nextId.current++
    setHistory((current) => [{ ...entry, id }, ...current].slice(0, HISTORY_LIMIT))
    return id
  }, [])

  const takeTransferId = (job: CanSendJob): number => {
    if (!job.dronecan) return 0
    const key = job.dronecan.counterKey
    const next = ((transferIds.current.get(key) ?? -1) + 1) & 0x1f
    transferIds.current.set(key, next)
    return next
  }

  // Responses to this app's requests: decode only service responses addressed to the sender's node.
  useEffect(() => {
    if (!sink) return
    const decoder = new DronecanTransferDecoder(dronecanCatalogue())
    let seq = 0
    return sink.onCanFrame((frame) => {
      if (pending.current.size === 0 || frame.direction !== 'rx' || !frame.extended) return
      const isResponse = ((frame.id >>> 7) & 1) === 1 && ((frame.id >>> 15) & 1) === 0
      if (!isResponse) return
      const transfer = decoder.push({ ...frame, seq: ++seq })
      if (!transfer || transfer.destinationNodeId === undefined) return
      const key = responseKey(transfer.dataTypeId, transfer.sourceNodeId, transfer.destinationNodeId, transfer.transferId)
      const waiting = pending.current.get(key)
      if (!waiting) return
      clearTimeout(waiting.timer)
      pending.current.delete(key)
      update(waiting.historyId, (entry) => ({ ...entry, status: 'answered', response: transfer }))
    })
  }, [sink, update])

  const transmit = useCallback(
    async (job: CanSendJob): Promise<{ frames: CanSendFrame[]; transferId: number }> => {
      if (!sink) throw new Error('Connect to a vehicle first.')
      const transferId = takeTransferId(job)
      const frames = job.build(transferId)
      await sink.sendCanFrames(frames)
      return { frames, transferId }
    },
    [sink]
  )

  const stopRepeat = useCallback(
    (note?: string) => {
      const running = repeat.current
      if (!running) return
      clearInterval(running.timer)
      repeat.current = undefined
      setRepeatingId(undefined)
      update(running.id, (entry) => ({ ...entry, status: 'stopped', count: running.count, note }))
    },
    [update]
  )

  const send = useCallback(
    async (job: CanSendJob) => {
      const atMs = Date.now()
      try {
        const { frames, transferId } = await transmit(job)
        const request = job.dronecan?.request
        const id = add({
          atMs,
          label: job.label,
          frames,
          status: request ? 'awaiting' : 'sent',
          count: 1,
          transferId: job.dronecan ? transferId : undefined
        })
        if (request) {
          const key = responseKey(request.serviceTypeId, request.destinationNodeId, request.sourceNodeId, transferId)
          const stale = pending.current.get(key)
          if (stale) clearTimeout(stale.timer)
          pending.current.set(key, {
            historyId: id,
            timer: setTimeout(() => {
              pending.current.delete(key)
              update(id, (entry) => ({ ...entry, status: 'no answer' }))
            }, CAN_SEND_RESPONSE_TIMEOUT_MS)
          })
        }
      } catch (error) {
        add({ atMs, label: job.label, frames: [], status: 'failed', count: 0, note: errorText(error) })
      }
    },
    [add, transmit, update]
  )

  const startRepeat = useCallback(
    (job: CanSendJob, periodMs: number) => {
      stopRepeat('Replaced by a new repeat.')
      const period = Math.max(CAN_SEND_MIN_PERIOD_MS, Math.round(periodMs))
      const id = add({ atMs: Date.now(), label: job.label, frames: [], status: 'repeating', count: 0, periodMs: period })
      let inFlight = false
      // The history (and so the app) repaints at most ~4 times a second, not per send.
      const flushEvery = Math.max(1, Math.round(250 / period))
      const tick = async () => {
        // A slow link must not queue sends behind each other.
        if (inFlight || repeat.current?.id !== id) return
        inFlight = true
        try {
          const { frames } = await transmit(job)
          const running = repeat.current
          if (running?.id !== id) return
          running.count += 1
          const count = running.count
          if (count === 1 || count % flushEvery === 0) update(id, (entry) => ({ ...entry, frames, count }))
        } catch (error) {
          stopRepeat(errorText(error))
        } finally {
          inFlight = false
        }
      }
      repeat.current = { id, timer: setInterval(() => void tick(), period), hazard: job.hazard, count: 0 }
      setRepeatingId(id)
      void tick()
    },
    [add, stopRepeat, transmit, update]
  )

  // The automatic stops.
  useEffect(() => {
    if (!repeat.current) return
    if (armed) stopRepeat('Stopped: the vehicle armed.')
    else if (!active) stopRepeat('Stopped: the bus is no longer forwarded.')
    else if (!visible) stopRepeat('Stopped: you left the Send page.')
    else if (repeat.current.hazard === 'motion' && !motionAcknowledged) stopRepeat('Stopped: the safety box was unticked.')
  }, [armed, active, visible, motionAcknowledged, stopRepeat])

  useEffect(
    () => () => {
      if (repeat.current) clearInterval(repeat.current.timer)
      for (const waiting of pending.current.values()) clearTimeout(waiting.timer)
    },
    []
  )

  const clearHistory = useCallback(() => {
    setHistory((current) => current.filter((entry) => entry.id === repeat.current?.id))
  }, [])

  return { history, repeatingId, send, startRepeat, stopRepeat, clearHistory }
}

function responseKey(serviceTypeId: number, fromNodeId: number, toNodeId: number, transferId: number): string {
  return `${serviceTypeId}:${fromNodeId}:${toNodeId}:${transferId}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
