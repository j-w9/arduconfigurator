// Log playback maths, kept pure so the player UI is a thin clock around it.
//
// Positions are in LOG time (ms since the log's first frame). The player
// advances a position by real elapsed time x speed and asks for the frames
// that fall in between; seeking asks where a log time lands in the frames.

import type { CanFrame } from './frame.js'

/** Index of the first frame at or after `timestampMs` (frames sorted by time). */
export function canFrameIndexAt(frames: readonly CanFrame[], timestampMs: number): number {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].timestampMs < timestampMs) low = middle + 1
    else high = middle
  }
  return low
}

export interface CanLogTimeline {
  startMs: number
  endMs: number
  durationMs: number
}

export function canLogTimeline(frames: readonly CanFrame[]): CanLogTimeline {
  if (frames.length === 0) return { startMs: 0, endMs: 0, durationMs: 0 }
  const startMs = frames[0].timestampMs
  const endMs = frames[frames.length - 1].timestampMs
  return { startMs, endMs, durationMs: endMs - startMs }
}

/**
 * The half-open index range [from, to) of frames with log time in
 * (fromPositionMs, toPositionMs] -- so stepping a position forward in pieces
 * yields every frame exactly once.
 */
export function canFramesBetween(
  frames: readonly CanFrame[],
  timeline: CanLogTimeline,
  fromPositionMs: number,
  toPositionMs: number
): { from: number; to: number } {
  const from = fromPositionMs < 0 ? 0 : upperBound(frames, timeline.startMs + fromPositionMs)
  const to = upperBound(frames, timeline.startMs + toPositionMs)
  return { from, to: Math.max(from, to) }
}

/** Index of the first frame strictly after `timestampMs`. */
function upperBound(frames: readonly CanFrame[], timestampMs: number): number {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].timestampMs <= timestampMs) low = middle + 1
    else high = middle
  }
  return low
}

/** Playback speeds offered by the player. */
export const CAN_PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 5, 20] as const
