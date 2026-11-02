// A clock off the main thread for the DFU flasher. Chrome throttles a
// background tab's timers (one wake a second, one a minute after five
// minutes hidden), and a DFU flash waits out the board's poll timeout once per
// block -- so a flash left in a background tab crawled to a stop. A dedicated
// worker's timers keep real time. Message: { id, ms } -> replies { id }.

self.onmessage = (event: MessageEvent<{ id: number; ms: number }>) => {
  const { id, ms } = event.data
  setTimeout(() => self.postMessage({ id }), ms)
}
