import { describe, expect, it } from 'vitest'

import { clampCellToLayout, gridCellSize, pointerDragToCell } from './osd-preview'

describe('clampCellToLayout', () => {
  it('rounds to the nearest whole cell within bounds', () => {
    expect(clampCellToLayout(5.4, 29)).toBe(5)
    expect(clampCellToLayout(5.6, 29)).toBe(6)
  })

  it('clamps below 0 and above the max index', () => {
    expect(clampCellToLayout(-3, 29)).toBe(0)
    expect(clampCellToLayout(45, 29)).toBe(29)
    expect(clampCellToLayout(45, 59)).toBe(45)
  })

  it('collapses non-finite input to 0', () => {
    expect(clampCellToLayout(Number.NaN, 29)).toBe(0)
    // Non-finite is guarded before the max-bound check, so it collapses to 0.
    expect(clampCellToLayout(Number.POSITIVE_INFINITY, 29)).toBe(0)
  })
})

describe('gridCellSize', () => {
  it('divides the content box (rect minus padding) by the grid dimensions', () => {
    const size = gridCellSize(
      { width: 616, height: 332 },
      { left: 8, right: 8, top: 6, bottom: 6 },
      30,
      16
    )
    // content = 600 x 320 -> 20 x 20 per cell (not 616/30 = 20.53 skewed by padding)
    expect(size.cellWidth).toBeCloseTo(20)
    expect(size.cellHeight).toBeCloseTo(20)
  })

  it('never returns a negative size and guards a zero grid', () => {
    const size = gridCellSize({ width: 4, height: 4 }, { left: 8, right: 8, top: 6, bottom: 6 }, 0, 0)
    expect(size.cellWidth).toBe(0)
    expect(size.cellHeight).toBe(0)
  })
})

describe('pointerDragToCell', () => {
  const base = {
    pointerStartX: 200,
    pointerStartY: 100,
    cellWidth: 20,
    cellHeight: 20,
    maxColumn: 29,
    maxRow: 15
  }

  it('preserves the grab offset: origin tracks the pointer delta, not the cursor', () => {
    // Element origin is at cell (2,14); grabbed 2 cells to the RIGHT of the
    // origin (offset baked into pointerStart). Move the pointer +3 cells right.
    const result = pointerDragToCell({
      ...base,
      startColumn: 2,
      startRow: 14,
      pointerX: 200 + 20 * 3,
      pointerY: 100
    })
    // Correct relative behaviour: column advances by exactly the pointer delta
    // (2 -> 5). A "snap origin under cursor" bug would land near 2 + grabOffset + 3.
    expect(result.column).toBe(5)
    expect(result.row).toBe(14)
  })

  it('clamps to the active layout bounds', () => {
    const result = pointerDragToCell({
      ...base,
      startColumn: 2,
      startRow: 2,
      pointerX: 200 - 20 * 10, // far left, past 0
      pointerY: 100 + 20 * 40 // far down, past maxRow
    })
    expect(result.column).toBe(0)
    expect(result.row).toBe(15)
  })

  it('allows HD-grid columns beyond the analog 29 ceiling', () => {
    const result = pointerDragToCell({
      ...base,
      maxColumn: 59,
      startColumn: 40,
      startRow: 5,
      pointerX: 200 + 20 * 10,
      pointerY: 100
    })
    expect(result.column).toBe(50)
  })

  it('is a no-op when the pointer has not moved', () => {
    const result = pointerDragToCell({ ...base, startColumn: 7, startRow: 3, pointerX: 200, pointerY: 100 })
    expect(result).toEqual({ column: 7, row: 3 })
  })
})
