// Live MAVLink message stats for the read-only MAVLink inspector. Subscribes to
// the runtime's raw envelope stream and accumulates per-type count / rate / last
// value in a ref, flushing to React state on a fixed interval so high-rate
// traffic (ATTITUDE, RC_CHANNELS, etc.) never thrashes the render loop.

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
}

const RATE_WINDOW_MS = 3000
const FLUSH_INTERVAL_MS = 500

interface Accumulator {
  count: number
  arrivalsMs: number[]
  lastSeenMs: number
  lastMessage: Record<string, unknown>
}

export function useMavlinkInspector(
  runtime: ArduPilotConfiguratorRuntime | undefined,
  active: boolean
): { stats: MavlinkMessageStat[]; clear: () => void } {
  const accumulators = useRef(new Map<string, Accumulator>())
  const [stats, setStats] = useState<MavlinkMessageStat[]>([])

  useEffect(() => {
    if (!runtime || !active) {
      return
    }
    const unsubscribe = runtime.onMessage((envelope) => {
      const message = envelope.message as unknown as Record<string, unknown> & { type?: string }
      const type = typeof message.type === 'string' ? message.type : 'UNKNOWN'
      const now = Date.now()
      const entry = accumulators.current.get(type) ?? { count: 0, arrivalsMs: [], lastSeenMs: 0, lastMessage: {} }
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
      const now = Date.now()
      const cutoff = now - RATE_WINDOW_MS
      const next: MavlinkMessageStat[] = []
      for (const [type, entry] of accumulators.current) {
        const recent = entry.arrivalsMs.filter((time) => time >= cutoff).length
        next.push({
          type,
          count: entry.count,
          rateHz: recent / (RATE_WINDOW_MS / 1000),
          lastSeenMs: entry.lastSeenMs,
          lastMessage: entry.lastMessage
        })
      }
      next.sort((left, right) => left.type.localeCompare(right.type))
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

  return { stats, clear }
}
