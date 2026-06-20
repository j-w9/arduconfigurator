// Trigger a browser "save file" for a blob. Shared by the onboard-log
// download, the MAVFTP file browser, the @SYS/scripts surface, and the
// parameter / snapshot / provisioning exports.
//
// Robustness notes (this is why downloads silently no-op'd in Brave and some
// Firefox configs):
//   1. The anchor MUST be attached to the document before `.click()`. A
//      detached anchor's synthetic click is ignored by Brave/Firefox (Chrome
//      tolerated it, which hid the bug).
//   2. `URL.revokeObjectURL` MUST be deferred. The click starts the download
//      asynchronously; revoking the object URL synchronously on the next line
//      can race the browser reading the blob and cancel the download — again,
//      most visible in Brave/Firefox.
function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  // Defer cleanup so the browser has the blob URL + the anchor in the DOM for
  // the duration of the download dispatch.
  setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

export function downloadBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mimeType = 'application/octet-stream'
): void {
  // Copy into a fresh Uint8Array so a subarray view (common from the runtime's
  // chunked transfers) serializes to the right length.
  const normalizedBytes = new Uint8Array(bytes.byteLength)
  normalizedBytes.set(bytes)
  triggerBlobDownload(filename, new Blob([normalizedBytes], { type: mimeType }))
}

/** Trigger a browser "save file" for text content (parameter backups,
 *  snapshot / provisioning library exports). Shares the blob/anchor plumbing
 *  with downloadBinaryFile. */
export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/json'
): void {
  triggerBlobDownload(filename, new Blob([contents], { type: mimeType }))
}
