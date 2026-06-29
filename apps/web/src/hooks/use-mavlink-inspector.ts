// Live MAVLink message stats for the read-only MAVLink inspector. Subscribes to
// the runtime's raw envelope stream and accumulates per-(systemId, componentId,
// type) count / rate / bandwidth / last value in a ref, flushing to React state
// on a fixed interval so high-rate traffic (ATTITUDE, RC_CHANNELS, etc.) never
// thrashes the render loop. Keying by source keeps the same message type from
// the autopilot, a gimbal, a companion computer and CAN nodes on separate rows.
// Each flush also samples the per-row rate into a trailing ring buffer for the
// sparkline. A pause toggle freezes the displayed table (accumulation keeps
// running underneath, so rates stay accurate on resume).

import { useEffect, useRef, useState } from 'react'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'

export interface MavlinkMessageStat {
  /** Stable identity for React keys: `${systemId}:${componentId}:${type}`. */
  key: string
  systemId: number
  componentId: number
  type: string
  count: number
  /** Messages/sec over a trailing window. */
  rateHz: number
  /** On-the-wire bytes/sec over the same trailing window. */
  bytesPerSec: number
  /** Cumulative on-the-wire bytes seen for this row this session. */
  totalBytes: number
  lastSeenMs: number
  /** The most recent decoded message record (field name -> value). */
  lastMessage: Record<string, unknown>
  /** Trailing per-flush rate samples (oldest → newest) for the sparkline. */
  rateHistory: number[]
}

const RATE_WINDOW_MS = 3000
const FLUSH_INTERVAL_MS = 500
const HISTORY_SAMPLES = 40

interface Accumulator {
  systemId: number
  componentId: number
  type: string
  count: number
  totalBytes: number
  arrivalsMs: number[]
  arrivalBytes: number[]
  lastSeenMs: number
  lastMessage: Record<string, unknown>
  rateHistory: number[]
}

export interface MavlinkInspectorState {
  stats: MavlinkMessageStat[]
  clear: () => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

function sourceKey(systemId: number, componentId: number, type: string): string {
  return `${systemId}:${componentId}:${type}`
}

export function useMavlinkInspector(
  runtime: ArduPilotConfiguratorRuntime | undefined,
  active: boolean
): MavlinkInspectorState {
  const accumulators = useRef(new Map<string, Accumulator>())
  const [stats, setStats] = useState<MavlinkMessageStat[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    if (!runtime || !active) {
      return
    }
    const unsubscribe = runtime.onMessage((envelope) => {
      const message = envelope.message as unknown as Record<string, unknown> & { type?: string }
      const type = typeof message.type === 'string' ? message.type : 'UNKNOWN'
      const systemId = envelope.header.systemId
      const componentId = envelope.header.componentId
      const key = sourceKey(systemId, componentId, type)
      // byteLength is set by the v2 codec; a stub/non-v2 codec leaves it
      // undefined, in which case bandwidth stays 0 rather than guessing.
      const bytes = typeof envelope.byteLength === 'number' ? envelope.byteLength : 0
      const now = Date.now()
      const entry =
        accumulators.current.get(key) ??
        {
          systemId,
          componentId,
          type,
          count: 0,
          totalBytes: 0,
          arrivalsMs: [],
          arrivalBytes: [],
          lastSeenMs: 0,
          lastMessage: {},
          rateHistory: []
        }
      entry.count += 1
      entry.totalBytes += bytes
      entry.lastSeenMs = now
      entry.lastMessage = message
      entry.arrivalsMs.push(now)
      entry.arrivalBytes.push(bytes)
      const cutoff = now - RATE_WINDOW_MS
      while (entry.arrivalsMs.length > 0 && entry.arrivalsMs[0] < cutoff) {
        entry.arrivalsMs.shift()
        entry.arrivalBytes.shift()
      }
      accumulators.current.set(key, entry)
    })

    const flush = (): void => {
      // Frozen: keep accumulating in the ref but don't disturb the table.
      if (pausedRef.current) {
        return
      }
      const now = Date.now()
      const cutoff = now - RATE_WINDOW_MS
      const windowSeconds = RATE_WINDOW_MS / 1000
      const next: MavlinkMessageStat[] = []
      for (const [key, entry] of accumulators.current) {
        let recent = 0
        let recentBytes = 0
        for (let index = 0; index < entry.arrivalsMs.length; index += 1) {
          if (entry.arrivalsMs[index] >= cutoff) {
            recent += 1
            recentBytes += entry.arrivalBytes[index] ?? 0
          }
        }
        const rateHz = recent / windowSeconds
        const bytesPerSec = recentBytes / windowSeconds
        entry.rateHistory.push(rateHz)
        if (entry.rateHistory.length > HISTORY_SAMPLES) {
          entry.rateHistory.shift()
        }
        next.push({
          key,
          systemId: entry.systemId,
          componentId: entry.componentId,
          type: entry.type,
          count: entry.count,
          rateHz,
          bytesPerSec,
          totalBytes: entry.totalBytes,
          lastSeenMs: entry.lastSeenMs,
          lastMessage: entry.lastMessage,
          rateHistory: [...entry.rateHistory]
        })
      }
      setStats(next)
    }

    flush()
    const interval = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [runtime, active])

  const clear = (): void => {
    accumulators.current.clear()
    setStats([])
  }

  return { stats, clear, paused, setPaused }
}
