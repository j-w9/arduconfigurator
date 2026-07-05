// Pure geometry helpers for the OSD preview canvas + drag editor. Extracted
// from views/Osd.tsx so the pixel->cell conversion, grab-offset drag math and
// layout-aware clamping are unit-testable off the DOM (see osd-preview.test.ts).
//
// The OSD preview is a character-cell grid whose column/row count depends on
// the selected video layout (PAL/NTSC 30x16, HD 50x18, HD 60x22). ArduPilot
// stores each element's position as a raw cell coordinate; the layout is only a
// preview aid, so the SAME raw value must render (and clamp) against whichever
// grid the operator is previewing — not a single hardcoded 30x16 box.

// Upper bound for a raw OSD X/Y cell coordinate read from a parameter. Wide
// enough for the largest supported grid (60x22) plus headroom; guards against a
// nonsensical value blowing out the grid without pinning positions to the
// smaller analog grid the way a hardcoded 29/15 clamp did.
export const OSD_MAX_CELL_INDEX = 63

/** Clamp a raw cell coordinate to a grid's max index (0-based), rounding to the
 *  nearest whole cell. Non-finite input collapses to 0. */
export function clampCellToLayout(value: number, maxIndex: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > maxIndex) return maxIndex
  return Math.round(value)
}

export interface OsdGridPadding {
  left: number
  right: number
  top: number
  bottom: number
}

export interface OsdGridCellSize {
  cellWidth: number
  cellHeight: number
}

/** Pixel size of one character cell. Divides the grid's CONTENT box (bounding
 *  rect minus padding) by the column/row count, so the pixel->cell conversion
 *  isn't skewed by the grid element's own padding (which would otherwise make a
 *  drag drift by a few percent per cell). */
export function gridCellSize(
  rect: { width: number; height: number },
  padding: OsdGridPadding,
  columns: number,
  rows: number
): OsdGridCellSize {
  const contentWidth = Math.max(0, rect.width - padding.left - padding.right)
  const contentHeight = Math.max(0, rect.height - padding.top - padding.bottom)
  return {
    cellWidth: columns > 0 ? contentWidth / columns : 0,
    cellHeight: rows > 0 ? contentHeight / rows : 0
  }
}

export interface OsdDragCellInput {
  pointerX: number
  pointerY: number
  /** Pointer position recorded at pointer-down (the grab point). */
  pointerStartX: number
  pointerStartY: number
  /** The element's cell position at pointer-down. */
  startColumn: number
  startRow: number
  cellWidth: number
  cellHeight: number
  maxColumn: number
  maxRow: number
}

/** Convert the pointer position during a drag into a snapped character cell.
 *  Tracks the element RELATIVE to where it was grabbed: the pointer delta since
 *  pointer-down is added to the element's start cell, so the grab point stays
 *  under the cursor instead of the element's origin snapping to it. The result
 *  is clamped to the active layout. */
export function pointerDragToCell(input: OsdDragCellInput): { column: number; row: number } {
  const dxCells = input.cellWidth > 0 ? (input.pointerX - input.pointerStartX) / input.cellWidth : 0
  const dyCells = input.cellHeight > 0 ? (input.pointerY - input.pointerStartY) / input.cellHeight : 0
  return {
    column: clampCellToLayout(input.startColumn + dxCells, input.maxColumn),
    row: clampCellToLayout(input.startRow + dyCells, input.maxRow)
  }
}
