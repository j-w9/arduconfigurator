import { useCallback, useEffect, useRef, useState } from 'react'

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
  // Throttle rests at an end of travel, so it needs a captured resting baseline
  // (not a fixed mid/trim reference) to tell rest from an up-push. Grab the first
  // defined throttle sample and hold it until reset; a ref avoids re-render churn.
  const throttleBaseline = useRef<number | undefined>(undefined)

  useEffect(() => {
    setResults((previous) => {
      let changed = false
      const next = { ...previous }
      for (const input of inputs) {
        let evaluated = input
        if (input.axisId === 'throttle') {
          if (throttleBaseline.current === undefined && input.pwm !== undefined) {
            throttleBaseline.current = input.pwm
          }
          evaluated = { ...input, restReference: throttleBaseline.current }
        }
        const latched = latchRcDirection(previous[input.axisId], evaluateRcDirection(evaluated))
        if (latched !== previous[input.axisId]) {
          next[input.axisId] = latched
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [inputs])

  const reset = useCallback(() => {
    throttleBaseline.current = undefined
    setResults(IDLE_RESULTS)
  }, [])

  return { results, reset }
}
