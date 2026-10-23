// Deadlines for stream operations, which can wait forever on a stuck device.

export class DeadlineError extends Error {
  readonly what: string
  readonly ms: number
  constructor(what: string, ms: number) {
    super(`${what} did not finish within ${ms} ms`)
    this.name = 'DeadlineError'
    this.what = what
    this.ms = ms
  }
}

/** Reject with DeadlineError if `work` has not settled in `ms`. The work is not cancelled. */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(what, ms)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Await a cleanup for at most `ms`, then move on. Never throws. */
export async function release(work: () => Promise<unknown>, ms = 750): Promise<void> {
  try {
    await withDeadline(Promise.resolve(work()), ms, 'closing the port')
  } catch {
    // Timed out or failed: nothing more to do.
  }
}
