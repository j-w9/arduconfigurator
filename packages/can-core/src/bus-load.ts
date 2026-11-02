// Bus load, estimated from the frames seen.
//
// Exact load needs the bit-stuffed length of every frame, which only the
// controller knows. This uses the nominal frame length (classic: 47 bits of
// overhead for standard, 67 for extended, plus 8 per data byte) and adds the
// average stuffing overhead for random data (about 10%) -- close enough to
// tell "fine" from "saturated", and labelled an estimate in the UI.

import type { CanFrame } from './frame.js'

const STUFFING_FACTOR = 1.1

/** Nominal bit length of a classic CAN frame on the wire (incl. interframe space). */
export function canFrameBits(frame: Pick<CanFrame, 'extended' | 'data' | 'rtr' | 'fd'>): number {
  const overhead = frame.extended ? 67 : 47
  const dataBits = frame.rtr ? 0 : frame.data.length * 8
  return Math.round((overhead + dataBits) * STUFFING_FACTOR)
}

/**
 * Percentage of `bitrate` used by `frames` over `windowMs`. CAN FD data
 * phases run at a different rate, so FD frames are counted at the nominal
 * rate here: an over-estimate, never an under-estimate.
 */
export function estimateCanBusLoad(
  frames: readonly Pick<CanFrame, 'extended' | 'data' | 'rtr' | 'fd'>[],
  windowMs: number,
  bitrate: number
): number {
  if (windowMs <= 0 || bitrate <= 0) return 0
  let bits = 0
  for (const frame of frames) bits += canFrameBits(frame)
  return Math.min(100, (bits / ((bitrate * windowMs) / 1000)) * 100)
}
