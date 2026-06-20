// ArduPilot .apj firmware-container parsing.
//
// An .apj file is JSON: { board_id, [board_revision], [image_size],
// image: base64(zlib-compressed raw firmware),
// [extf_image: base64(zlib-compressed extflash firmware)],
// [extf_image_size] }.
// `image_size` and `extf_image_size` are advisory: uploader.py derives the
// firmware length from the decompressed image, so they are only cross-checked
// as an integrity guard when present, never required.
// The raw image is `zlib.inflate(base64decode(image))`. Decompression is
// injected (DI) so this package stays dependency-free and isomorphic.

export interface ParsedApj {
  boardId: number
  boardRevision: number
  /**
   * Uncompressed firmware size in bytes declared by the .apj, or undefined
   * when absent. Cross-checked against the inflated image when present;
   * otherwise the inflated length is authoritative (matching uploader.py).
   */
  imageSize: number | undefined
  /** base64-decoded, still zlib-compressed firmware bytes. */
  compressedImage: Uint8Array
  /**
   * Optional extflash image for dual-image boards where the ChibiOS text
   * segment lives in external QSPI flash. Undefined when the .apj has no
   * `extf_image`.
   */
  compressedExtfImage: Uint8Array | undefined
  /**
   * Advisory extflash size — same semantics as imageSize. Cross-checked
   * against the inflated extf image when present; the inflated length is
   * authoritative when absent.
   */
  extfImageSize: number | undefined
  /**
   * Whether the build is signed. The upload protocol is signature-blind;
   * the bootloader on secure boards verifies the signature at next boot.
   * Surfaced solely so the UI can show a "signed build" badge.
   */
  signedFirmware: boolean
}

export type Inflate = (zlibBytes: Uint8Array) => Uint8Array | Promise<Uint8Array>

// Generous upper bound on firmware image size, guarding against a
// decompression bomb or corrupt .apj. Shared with the inflater so the cap
// is enforced during decompression, not just after.
export const MAX_FIRMWARE_IMAGE_BYTES = 16 * 1024 * 1024

function base64ToBytes(b64: string): Uint8Array {
  // Guard the up-front allocation: an encoded blob this large decodes past
  // the firmware size cap (and would inflate well beyond it), so reject it
  // before allocating rather than only after inflate.
  if (b64.length > Math.ceil((MAX_FIRMWARE_IMAGE_BYTES * 4) / 3) + 4) {
    throw new Error(`Invalid .apj: encoded image exceeds the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap`)
  }
  // Isomorphic base64 decode (atob in browsers, Buffer in Node).
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  // eslint-disable-next-line no-undef
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function parseApj(text: string): ParsedApj {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Invalid .apj: not valid JSON')
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid .apj: expected a JSON object')
  }
  const obj = json as Record<string, unknown>
  if (typeof obj.image !== 'string' || obj.image.length === 0) {
    throw new Error('Invalid .apj: missing "image"')
  }
  if (typeof obj.board_id !== 'number') {
    throw new Error('Invalid .apj: missing numeric "board_id"')
  }
  // image_size is advisory: a missing/invalid value falls back to the
  // inflated length in decodeApjImage. A present-but-absurdly-large value
  // is rejected here before any allocate/inflate; the cap is also enforced
  // post-inflate so an absent/lying image_size cannot bypass it.
  const rawImageSize =
    typeof obj.image_size === 'number'
      ? obj.image_size
      : typeof obj.image_size === 'string'
        ? Number(obj.image_size)
        : Number.NaN
  const imageSize =
    Number.isFinite(rawImageSize) && rawImageSize > 0 ? rawImageSize : undefined
  if (imageSize !== undefined && imageSize > MAX_FIRMWARE_IMAGE_BYTES) {
    throw new Error(
      `Invalid .apj: image_size ${imageSize} exceeds the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap`
    )
  }
  // extf_image is optional (dual-image boards only); extf_image_size has
  // the same advisory treatment as image_size.
  const compressedExtfImage =
    typeof obj.extf_image === 'string' && obj.extf_image.length > 0
      ? base64ToBytes(obj.extf_image)
      : undefined
  const rawExtfImageSize =
    typeof obj.extf_image_size === 'number'
      ? obj.extf_image_size
      : typeof obj.extf_image_size === 'string'
        ? Number(obj.extf_image_size)
        : Number.NaN
  const extfImageSize =
    Number.isFinite(rawExtfImageSize) && rawExtfImageSize > 0 ? rawExtfImageSize : undefined
  if (extfImageSize !== undefined && extfImageSize > MAX_FIRMWARE_IMAGE_BYTES) {
    throw new Error(
      `Invalid .apj: extf_image_size ${extfImageSize} exceeds the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap`
    )
  }
  return {
    boardId: obj.board_id,
    boardRevision: typeof obj.board_revision === 'number' ? obj.board_revision : 0,
    imageSize,
    compressedImage: base64ToBytes(obj.image),
    compressedExtfImage,
    extfImageSize,
    signedFirmware: obj.signed_firmware === true
  }
}

/** Pad to a 4-byte multiple with 0xFF (the bootloader programs/CRCs 4-aligned). */
export function padTo4(image: Uint8Array): Uint8Array {
  const remainder = image.length % 4
  if (remainder === 0) return image
  const padded = new Uint8Array(image.length + (4 - remainder))
  padded.set(image)
  padded.fill(0xff, image.length)
  return padded
}

/**
 * Decode an .apj to the 4-byte-aligned raw firmware ready to program.
 * The inflated length is cross-checked against `image_size` when declared,
 * otherwise authoritative (matching uploader.py). The size cap is enforced
 * on the inflated length regardless.
 */
export async function decodeApjImage(parsed: ParsedApj, inflate: Inflate): Promise<Uint8Array> {
  const raw = await inflate(parsed.compressedImage)
  if (raw.length > MAX_FIRMWARE_IMAGE_BYTES) {
    throw new Error(
      `Invalid .apj: inflated image is ${raw.length} bytes, exceeding the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap`
    )
  }
  if (parsed.imageSize !== undefined && raw.length !== parsed.imageSize) {
    throw new Error(
      `Invalid .apj: inflated image is ${raw.length} bytes but image_size declares ${parsed.imageSize}`
    )
  }
  return padTo4(raw)
}

/**
 * Decode the optional extflash image to a 4-byte-aligned buffer ready to
 * program. Returns undefined when the .apj has no `extf_image`, so callers
 * can branch on whether to invoke the extflash flash path. Same length
 * semantics and size cap as decodeApjImage.
 */
export async function decodeApjExtfImage(
  parsed: ParsedApj,
  inflate: Inflate
): Promise<Uint8Array | undefined> {
  if (!parsed.compressedExtfImage) return undefined
  const raw = await inflate(parsed.compressedExtfImage)
  if (raw.length > MAX_FIRMWARE_IMAGE_BYTES) {
    throw new Error(
      `Invalid .apj: inflated extf_image is ${raw.length} bytes, exceeding the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap`
    )
  }
  if (parsed.extfImageSize !== undefined && raw.length !== parsed.extfImageSize) {
    throw new Error(
      `Invalid .apj: inflated extf_image is ${raw.length} bytes but extf_image_size declares ${parsed.extfImageSize}`
    )
  }
  // Single-image .apj files may carry an `extf_image` that inflates to
  // zero bytes. uploader.py gates the extflash path on
  // `extf_image_size > 0`; mirror that by treating an empty inflated
  // image as "no extf image".
  if (raw.length === 0) return undefined
  return padTo4(raw)
}
