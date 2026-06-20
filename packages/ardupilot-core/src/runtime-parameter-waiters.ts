import { approximatelyEqualParameterValue, DEFAULT_PARAMETER_WRITE_TOLERANCE } from './runtime-helpers.js'
import type { ConfiguratorSnapshot, ParameterState, ParameterWriteOptions } from './types.js'

const DEFAULT_PARAMETER_WRITE_TIMEOUT_MS = 5000

interface ParameterValueWaiter {
  paramId: string
  expectedValue: number
  tolerance: number
  resolve: (parameter: ParameterState) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ParameterSyncWaiter {
  resolve: (parameterStats: ConfiguratorSnapshot['parameterStats']) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Idle window: max gap allowed between progress events before giving up. */
  idleTimeoutMs: number
}

export interface ParameterValueWaiterHandle {
  promise: Promise<ParameterState>
  cancel: (error: Error) => void
}

/**
 * Manages the set of `PARAM_VALUE` readback waiters used to verify a write
 * actually took effect on the autopilot. Each waiter is keyed by paramId +
 * the expected value (within tolerance), so concurrent writes to different
 * parameters don't race.
 */
export class ParameterValueWaiterSet {
  private readonly waiters = new Set<ParameterValueWaiter>()

  /** Number of pending waiters. Exposed so tests can assert cleanup. */
  get size(): number {
    return this.waiters.size
  }

  add(
    paramId: string,
    expectedValue: number,
    options: ParameterWriteOptions = {}
  ): ParameterValueWaiterHandle {
    const timeoutMs = options.verifyTimeoutMs ?? DEFAULT_PARAMETER_WRITE_TIMEOUT_MS
    const tolerance = options.tolerance ?? DEFAULT_PARAMETER_WRITE_TOLERANCE

    let cancel = (_error: Error) => {}
    const promise = new Promise<ParameterState>((resolve, reject) => {
      let settled = false
      const waiter: ParameterValueWaiter = {
        paramId,
        expectedValue,
        tolerance,
        resolve: (parameter) => {
          settled = true
          clearTimeout(timer)
          resolve(parameter)
        },
        reject: (error) => {
          settled = true
          clearTimeout(timer)
          reject(error)
        },
        timer: undefined as unknown as ReturnType<typeof setTimeout>
      }

      const timer = setTimeout(() => {
        settled = true
        this.waiters.delete(waiter)
        reject(new Error(`Timed out waiting for ${paramId} readback after ${timeoutMs}ms.`))
      }, timeoutMs)

      waiter.timer = timer
      this.waiters.add(waiter)

      cancel = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        this.waiters.delete(waiter)
        reject(error)
      }
    })

    return { promise, cancel }
  }

  resolve(parameter: ParameterState): void {
    const matching = [...this.waiters].filter(
      (waiter) =>
        waiter.paramId === parameter.id &&
        approximatelyEqualParameterValue(parameter.value, waiter.expectedValue, waiter.tolerance)
    )

    matching.forEach((waiter) => {
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(parameter)
    })
  }

  rejectAll(error: Error): void {
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.waiters.clear()
  }
}

/**
 * Manages the set of "full parameter sync finished" waiters. Each waiter
 * resolves when the catalog has been fully downloaded from the autopilot;
 * all waiters fan-out resolve when sync flips to `complete`.
 *
 * The timeout is an IDLE (stall) window, not a total budget: it trips only
 * when no new parameter has arrived for `idleTimeoutMs`, and `noteProgress()`
 * re-arms it on every real arrival. A total-elapsed timeout wrongly failed a
 * healthy-but-slow sync — a large catalog over a busy/just-booted board
 * (Ethernet/PPP churn, duplicate resends) streamed steadily but took longer
 * than the budget, so it timed out mid-stream at e.g. 78%. An idle window
 * still fails a genuine stall (no progress for the whole window) while
 * tolerating a slow link that keeps making progress.
 */
export class ParameterSyncWaiterSet {
  private readonly waiters = new Set<ParameterSyncWaiter>()

  /** Number of pending waiters. Exposed so tests can assert cleanup. */
  get size(): number {
    return this.waiters.size
  }

  add(idleTimeoutMs: number): Promise<ConfiguratorSnapshot['parameterStats']> {
    return new Promise((resolve, reject) => {
      const waiter: ParameterSyncWaiter = {
        resolve: (parameterStats) => {
          clearTimeout(waiter.timer)
          resolve(parameterStats)
        },
        reject: (error) => {
          clearTimeout(waiter.timer)
          reject(error)
        },
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        idleTimeoutMs
      }

      this.armWaiter(waiter)
      this.waiters.add(waiter)
    })
  }

  /**
   * Re-arm every pending waiter's idle timer. Call on each new parameter
   * arrival so a sync that keeps making progress never times out.
   */
  noteProgress(): void {
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      this.armWaiter(waiter)
    })
  }

  private armWaiter(waiter: ParameterSyncWaiter): void {
    waiter.timer = setTimeout(() => {
      this.waiters.delete(waiter)
      waiter.reject(
        new Error(`Timed out waiting for parameter sync: no progress for ${waiter.idleTimeoutMs}ms.`)
      )
    }, waiter.idleTimeoutMs)
  }

  resolveAll(parameterStats: ConfiguratorSnapshot['parameterStats']): void {
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.resolve(parameterStats)
    })
    this.waiters.clear()
  }

  rejectAll(error: Error): void {
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.waiters.clear()
  }
}
