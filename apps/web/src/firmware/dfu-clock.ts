// Sleep on a worker's clock (see ./dfu-clock.worker.ts), falling back to a
// plain timer where workers are unavailable.

import type { DfuSleep } from '@arduconfig/firmware-flash'

export interface DfuClock {
  sleep: DfuSleep
  close(): void
}

export function createDfuClock(): DfuClock {
  let worker: Worker | undefined
  try {
    worker = new Worker(new URL('./dfu-clock.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = undefined
  }
  if (!worker) {
    return { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), close: () => undefined }
  }
  const pending = new Map<number, () => void>()
  let nextId = 0
  let failed = false
  const flush = () => {
    failed = true
    for (const resolve of pending.values()) resolve()
    pending.clear()
  }
  worker.onmessage = (event: MessageEvent<{ id: number }>) => {
    pending.get(event.data.id)?.()
    pending.delete(event.data.id)
  }
  // A worker that fails to load must not leave the flash waiting forever.
  worker.onerror = flush
  const active = worker
  return {
    sleep: (ms) =>
      failed
        ? new Promise((resolve) => setTimeout(resolve, ms))
        : new Promise((resolve) => {
            const id = (nextId += 1)
            pending.set(id, resolve)
            active.postMessage({ id, ms })
          }),
    close: () => {
      flush()
      active.terminate()
    }
  }
}
