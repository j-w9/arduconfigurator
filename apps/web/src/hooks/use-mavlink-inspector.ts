// Live MAVLink message stats for the read-only MAVLink inspector. Subscribes to
// the runtime's raw envelope stream and accumulates per-type count / rate / last
// value in a ref, flushing to React state on a fixed interval so high-rate
// traffic (ATTITUDE, RC_CHANNELS, etc.) never thrashes the render loop. Each
// flush also samples the per-type rate into a trailing ring buffer for the
// sparkline. A pause toggle freezes the displayed table (accumulation keeps
// running underneath, so rates stay accurate on resume).

import { useEffect, useRef, useState } from 'react'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'

export interface MavlinkMessageStat {
  type: string
  count: number
  /** Messages/sec over a trailing window. */
  rateHz: number
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
  count: number
  arrivalsMs: number[]
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
      const now = Date.now()
      const entry =
        accumulators.current.get(type) ??
        { count: 0, arrivalsMs: [], lastSeenMs: 0, lastMessage: {}, rateHistory: [] }
      entry.count += 1
      entry.lastSeenMs = now
      entry.lastMessage = message
      entry.arrivalsMs.push(now)
      const cutoff = now - RATE_WINDOW_MS
      while (entry.arrivalsMs.length > 0 && entry.arrivalsMs[0] < cutoff) {
        entry.arrivalsMs.shift()
      }
      accumulators.current.set(type, entry)
    })

    const flush = (): void => {
      // Frozen: keep accumulating in the ref but don't disturb the table.
      if (pausedRef.current) {
        return
      }
      const now = Date.now()
      const cutoff = now - RATE_WINDOW_MS
      const next: MavlinkMessageStat[] = []
      for (const [type, entry] of accumulators.current) {
        const recent = entry.arrivalsMs.filter((time) => time >= cutoff).length
        const rateHz = recent / (RATE_WINDOW_MS / 1000)
        entry.rateHistory.push(rateHz)
        if (entry.rateHistory.length > HISTORY_SAMPLES) {
          entry.rateHistory.shift()
        }
        next.push({
          type,
          count: entry.count,
          rateHz,
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
