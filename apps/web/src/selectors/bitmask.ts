// Pure bitmask helpers shared across views. Lifted out of App.tsx
// (describeBitmaskSelections 15 call sites, hasBitmaskFlag 7) so per-view
// view-model modules can import them — the last shared dependency the
// serial-ports view-model needs before it can be extracted cleanly.
// Behavior-identical to the App.tsx originals.

export function hasBitmaskFlag(value: number | undefined, bit: number): boolean {
  if (value === undefined || !Number.isFinite(value)) {
    return false
  }

  // Use 2 ** bit (not `1 << bit`) so bits >= 31 don't hit the signed-32-bit
  // sign bit / wraparound. No current label map exceeds bit 19, but a future
  // 32-bit mask param (e.g. a log/types mask) would otherwise read wrong.
  return Math.floor(Math.round(value) / 2 ** bit) % 2 === 1
}

/**
 * Set or clear a single bit in a bitmask value, returning an UNSIGNED 32-bit
 * result. Centralizes the toggle so callers don't hand-roll `1 << bit` (which
 * yields a negative number for bit 31, corrupting the stored value); the
 * `>>> 0` keeps it unsigned and bits outside 0..31 are ignored rather than
 * wrapping.
 */
export function toggleBitmaskFlag(value: number, bit: number, on: boolean): number {
  const base = Number.isFinite(value) ? Math.round(value) : 0
  if (!Number.isInteger(bit) || bit < 0 || bit > 31) {
    return base >>> 0
  }
  const mask = 1 << bit
  return (on ? base | mask : base & ~mask) >>> 0
}

export function describeBitmaskSelections(
  value: number | undefined,
  labelMap: Record<number, string>,
  emptyLabel = 'None'
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unknown'
  }

  const labels = Object.entries(labelMap)
    .map(([bit, label]) => ({ bit: Number(bit), label }))
    .filter(({ bit }) => hasBitmaskFlag(value, bit))
    .map(({ label }) => label)

  return labels.length > 0 ? labels.join(', ') : emptyLabel
}
