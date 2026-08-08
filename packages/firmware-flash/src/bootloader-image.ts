/**
 * Identity of a raw ArduPilot bootloader image (a plain `.bin`, not an `.apj`).
 *
 * Why a hash and not something richer: an ArduPilot bootloader binary carries
 * no descriptor we can trust to parse. The one identifying string it holds is
 * GIT_VERSION_EXTENDED (a 16-char abbreviated git hash, appended by
 * Tools/ardupilotwaf/boards.py build()), and even that is only guaranteed to
 * be linked in on targets that compile PROTO_GET_VERSION — Tools/AP_Bootloader/
 * bl_protocol.cpp guards that whole command behind
 * `#if HAL_PROGRAM_SIZE_LIMIT_KB > 1024`. Scanning a binary for a bare
 * 16-hex-character token would also match plenty of ordinary code and data, so
 * a "version" recovered that way could be confidently wrong. A cryptographic
 * digest of the exact bytes is instead always available and always correct:
 * two images with the same digest ARE the same image, and that is the only
 * claim this module makes.
 */

export interface BootloaderImageIdentity {
  /** Exact length in bytes of the image these digests describe. */
  byteLength: number
  /** Lowercase hex SHA-256 of the whole image. */
  sha256: string
}

/**
 * Short, human-comparable form of a digest.
 *
 * 12 hex characters (48 bits) is enough for an operator to eyeball two values
 * side by side; the full digest stays available for anyone who wants to verify
 * it properly, so this is a display convenience and never the comparison used
 * to decide whether two images match.
 */
export function shortImageHash(sha256: string): string {
  return sha256.slice(0, 12)
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * SHA-256 an image via WebCrypto — present in browsers, in Electron's renderer
 * and main process, and as a global in Node 18+, so this needs no dependency
 * and no bundled implementation.
 *
 * No length cap here on purpose: the guard against an implausible image
 * belongs at the point the bytes are READ off the vehicle (where a bad length
 * costs link time), not at the point they are hashed, and duplicating the
 * limit in two packages would let the two drift.
 */
export async function describeBootloaderImage(
  bytes: Uint8Array
): Promise<BootloaderImageIdentity> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 is unavailable: this environment has no WebCrypto subtle implementation.')
  }
  // Copy into a standalone buffer so a Uint8Array that is a view onto a larger
  // MAVFTP receive buffer hashes only its own bytes.
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer)
  return { byteLength: bytes.byteLength, sha256: toHex(new Uint8Array(digest)) }
}
