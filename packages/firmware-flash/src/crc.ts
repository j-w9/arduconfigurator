// ArduPilot serial-bootloader CRC-32.
//
// IMPORTANT: this is NOT the standard zlib CRC-32 *call convention*.
// ArduPilot's Tools/scripts/uploader.py uses the STANDARD reflected
// CRC-32 table (polynomial 0xEDB88320 — the same hardcoded `crctab`
// as zlib/Ethernet) but with state initialised to 0 and **no** pre/post
// inversion (zlib's crc32() applies init/final 0xFFFFFFFF around the
// same table). Using the wrong variant makes the post-flash GET_CRC
// verify silently mismatch — i.e. a good flash reported as failed —
// so this must match the bootloader exactly.
//
// Conformance-audit fix: the polynomial here previously read
// 0xEDB88420 (one hex digit off). That generated a completely different
// 256-entry table, so EVERY verify against real hardware failed while
// the unit tests passed — their "locked" vectors had been generated
// from the same wrong table. The vectors are now locked against the
// canonical published crctab entries (table[1] = 0x77073096,
// table[255] = 0x2D02EF8D), which this implementation cannot
// self-confirm into correctness.

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Streaming ArduPilot bootloader CRC-32. `state` defaults to 0 (the
 * bootloader's initial value) and is returned so chunks can be chained.
 */
export function arduPilotCrc32(bytes: Uint8Array, state = 0): number {
  let crc = state >>> 0
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0
  }
  return crc >>> 0
}

const FF_WORD = new Uint8Array([0xff, 0xff, 0xff, 0xff])

/**
 * The exact firmware CRC the bootloader's GET_CRC returns: CRC-32 over the
 * (already 4-byte-aligned) image, then 0xFF padding four bytes at a time up
 * to the board's full flash size. Mirrors uploader.py `firmware.crc()`:
 *
 *   state = crc32(self.image, 0)
 *   for i in range(len(self.image), padlen - 1, 4):
 *       state = crc32(b'\xff\xff\xff\xff', state)
 *
 * `alignedImage` MUST already be padded to a 4-byte multiple (see
 * `padTo4` in apj.ts); `flashMaxSize` is the FLASH_SIZE from identify().
 */
export function firmwareCrc(alignedImage: Uint8Array, flashMaxSize: number): number {
  if (alignedImage.length % 4 !== 0) {
    throw new Error('firmwareCrc: image must be 4-byte aligned before CRC')
  }
  let state = arduPilotCrc32(alignedImage, 0)
  for (let i = alignedImage.length; i < flashMaxSize; i += 4) {
    state = arduPilotCrc32(FF_WORD, state)
  }
  return state >>> 0
}
