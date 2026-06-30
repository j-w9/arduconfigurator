import { useCallback, useEffect, useState } from 'react'

import type { RcAxisId } from '@arduconfig/ardupilot-core'

import {
  evaluateRcDirection,
  latchRcDirection,
  type RcDirectionAxisInput,
  type RcDirectionResult
} from '../view-models/receiver-direction-check'

const IDLE_RESULTS: Record<RcAxisId, RcDirectionResult> = {
  roll: 'idle',
  pitch: 'idle',
  throttle: 'idle',
  yaw: 'idle'
}

/**
 * Latch the per-axis direction verdict from a live stream of samples, so a
 * `correct`/`reversed` reading survives the operator releasing the stick back to
 * centre. A later decisive sample (e.g. after toggling the reverse) supersedes
 * the previous one; `reset` clears everything back to idle. Shared by the
 * Endpoints direction card and the guided-setup radio step.
 */
export function useLatchedRcDirections(inputs: RcDirectionAxisInput[]): {
  results: Record<RcAxisId, RcDirectionResult>
  reset: () => void
} {
  const [results, setResults] = useState<Record<RcAxisId, RcDirectionResult>>(IDLE_RESULTS)

  useEffect(() => {
    setResults((previous) => {
      let changed = false
      const next = { ...previous }
      for (const input of inputs) {
        const latched = latchRcDirection(previous[input.axisId], evaluateRcDirection(input))
        if (latched !== previous[input.axisId]) {
          next[input.axisId] = latched
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [inputs])

  const reset = useCallback(() => setResults(IDLE_RESULTS), [])

  return { results, reset }
}
