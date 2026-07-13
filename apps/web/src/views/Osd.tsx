import { useEffect, useRef, useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { UseOsdShorthandResult } from '../hooks/use-osd-shorthand'
import type { OsdCatalogEntry } from '../view-models/osd-message-suggestions'
import { OsdMessageCombobox } from './OsdMessageCombobox'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'
import { clampCellToLayout, gridCellSize, pointerDragToCell } from '../view-models/osd-preview'

// Character-cell grids per analog/HD video standard. PAL/NTSC are the
// classic MAX7456 sizes; the HD grids cover MSP DisplayPort digital systems.
// ArduPilot's HD OSD supports TWO character resolutions: the 50x18 grid (e.g.
// HDZero) and the 60x22 grid (e.g. Walksnail / DJI O3) — both are offered here
// (previously only a single "HD" was listed). The selected layout drives the
// preview's column/row count + aspect and the pointer-drag pixel->cell
// conversion, so element positions land on the right cells for the chosen
// standard. (Display-only — ArduPilot stores element positions as raw cells
// regardless.)
const OSD_ANALOG_LAYOUTS = {
  pal: { label: 'PAL', columns: 30, rows: 16 },
  ntsc: { label: 'NTSC', columns: 30, rows: 13 },
  hd_50x18: { label: 'HD', columns: 50, rows: 18 },
  hd_60x22: { label: 'HD', columns: 60, rows: 22 }
} as const
type OsdAnalogLayout = keyof typeof OSD_ANALOG_LAYOUTS

// Named video-system picker — the operator names the goggles/VRX they
// actually have instead of guessing a raw grid size. `layout` is fixed for
// every digital system (each digital standard only ever runs one character
// grid); `analog` has none here because analog is either PAL or NTSC
// depending on the camera/goggles, picked via the secondary selector.
// Grid sizes verified against ArduPilot's own DisplayPort OSD documentation
// (HDZero: ardupilot.org/copter/docs/common-displayport.html, explicit
// "set OSDx_TXT_RES to 0 or 1") and hardware specs (Walksnail Avatar HD
// defaults to 60x22; the whole DJI HD family — O3 Air Unit, Goggles 2,
// Goggles V2, Goggles 3 — shares the same 810p/60x22 grid).
const OSD_VIDEO_SYSTEMS = {
  analog: { label: 'Analog', layout: undefined },
  hdzero: { label: 'HDZero', layout: 'hd_50x18' },
  walksnail: { label: 'Walksnail Avatar', layout: 'hd_60x22' },
  dji_o3: { label: 'DJI O3 Air Unit', layout: 'hd_60x22' },
  dji_goggles_2: { label: 'DJI Goggles 2', layout: 'hd_60x22' },
  dji_goggles_v: { label: 'DJI Goggles V2', layout: 'hd_60x22' },
  dji_goggles_3: { label: 'DJI Goggles 3', layout: 'hd_60x22' }
} as const satisfies Record<string, { label: string; layout: OsdAnalogLayout | undefined }>
type OsdVideoSystem = keyof typeof OSD_VIDEO_SYSTEMS

// BF-style element category groupings. Each id below maps a per-element
// OsdElementToggle (keyed on elementId — BAT_VOLT / GSPEED / etc.) into a
// logical group operators recognize from BF's OSD configuration page.
// Toggles whose elementId isn't found in any group fall into "Misc".
interface OsdElementGroup {
  id: string
  label: string
  elementIds: readonly string[]
}

const OSD_ELEMENT_GROUPS: readonly OsdElementGroup[] = [
  {
    id: 'power',
    label: 'Power',
    elementIds: [
      'BAT_VOLT', 'CURRENT', 'BATUSED', 'POWER', 'AVGCELLV', 'CELLVOLT', 'RESTVOLT', 'ACRVOLT',
      'BATTBAR', 'EFF', 'CLIMBEFF', 'BTEMP', 'BAT2_VLT', 'CURRENT2', 'BAT2USED'
    ]
  },
  { id: 'speed', label: 'Speed', elementIds: ['GSPEED', 'ASPEED', 'VSPEED', 'ASPD1', 'ASPD2', 'THROTTLE'] },
  { id: 'attitude', label: 'Attitude', elementIds: ['HORIZON', 'ROLL', 'PITCH', 'CRSSHAIR', 'SIDEBARS'] },
  {
    id: 'navigation',
    label: 'Navigation',
    elementIds: [
      'HEADING', 'COMPASS', 'ALTITUDE', 'HOME', 'HOMEDIR', 'HOMEDIST', 'HDIST', 'HDIR', 'DIST',
      'WAYPOINT', 'XTRACK', 'GPSLAT', 'GPSLONG', 'PLUSCODE', 'TER_HGT'
    ]
  },
  {
    id: 'status',
    label: 'Status',
    elementIds: ['FLTMODE', 'ARMING', 'MESSAGE', 'FLTIME', 'CLK', 'STATS', 'FENCE', 'SATS', 'HDOP']
  },
  { id: 'rc', label: 'RC / Link', elementIds: ['RSSI', 'RSSIDBM', 'LINK_Q', 'RC_LQ', 'RC_PWR', 'RC_SNR', 'RC_ANT'] },
  { id: 'esc', label: 'ESC / Motors', elementIds: ['ESCRPM', 'ESCTEMP', 'ESCAMPS', 'RPM', 'RNGF'] },
  { id: 'misc', label: 'Misc', elementIds: ['TEMP', 'ATEMP', 'WIND', 'CALLSIGN', 'VTX_PWR'] }
]

export interface OsdLinkPort {
  portNumber: number
  label: string
  protocolLabel: string
}

export interface OsdSelectField {
  parameter: ParameterState
  liveValue: number | undefined
}

/** A per-screen "Screen Options" editor field. `kind` picks select vs number. */
export interface OsdScreenOptionField {
  parameter: ParameterState
  liveValue: number | undefined
  kind: 'select' | 'number'
}

/**
 * Per-screen OSD<n>_ENABLE lookup so the matrix column header can surface the
 * enable state and offer a toggle without having to switch the preview to that
 * screen first. `parameter` is `undefined` when the FC build omits the screen
 * entirely — that case renders as "not supported" rather than a stale toggle.
 */
export interface OsdScreenEnableEntry {
  screen: 1 | 2 | 3 | 4
  parameter: ParameterState | undefined
}

export interface OsdMspOptionsBit {
  bit: number
  label: string
  isChecked: boolean
}

export interface OsdMspOptionsField {
  parameter: ParameterState
  bits: readonly OsdMspOptionsBit[]
  captionText: string
  onToggleBit: (bit: number, on: boolean) => void
}

export interface OsdPreviewToolbarData {
  backendText: string
  switchingText: string
  cellsText: string
}

// One renderable OSD element, positioned by character-cell coordinates. The
// grid size depends on the selected video system (analog 30x16/30x13, or HD
// 50x18 / 60x22 for MSP DisplayPort) — positions are clamped to the active
// layout at render time (see clampCellToLayout), so column/row here are raw
// param values that may sit beyond a smaller previewed grid.
export interface OsdPreviewElement {
  id: string
  text: string
  column: number
  row: number
}

// Per-element × per-screen enable cell, backed by the OSD<screen>_<id>_EN
// parameter. `liveValue === 1` means the element is currently visible on that
// screen's overlay; flipping the checkbox commits a draft change to the
// underlying parameter just like every other scoped editor on this tab.
export interface OsdElementMatrixCell {
  screen: number
  parameterId: string
  liveValue: number | undefined
}

export interface OsdElementMatrixRow {
  elementId: string
  label: string
  cells: readonly OsdElementMatrixCell[]
}

export interface OsdViewProps {
  linkPorts: readonly OsdLinkPort[]
  typeField: OsdSelectField | undefined
  channelField: OsdSelectField | undefined
  switchMethodField: OsdSelectField | undefined
  /** Fork-only "abbreviate MESSAGE panel" toggle; undefined hides it. */
  msgAbbrField: OsdSelectField | undefined
  /** Fork-only user shorthand dictionary editor state (@OSD/shorthand.dat). */
  osdShorthand: UseOsdShorthandResult
  /** Combobox entries for the shorthand "from" field (catalog + live messages). */
  osdMessageSuggestions: readonly OsdCatalogEntry[]
  previewToolbar: OsdPreviewToolbarData
  previewElements: readonly OsdPreviewElement[]
  /** Per-element × per-screen (OSD1-4) enable matrix for the BF-style picker. */
  elementMatrix: readonly OsdElementMatrixRow[]
  mspConfigPills: readonly string[]
  cellCountField: OsdSelectField | undefined
  mspOptionsField: OsdMspOptionsField | undefined
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  stagedCount: number
  invalidCount: number
  draftCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onRevert: () => void
  /** Drag-and-drop OSD layout editor — called whenever the user drags
   *  an element to a new character cell. Stages drafts for the
   *  matching OSD<screen>_<id>_X / _Y parameters; Save OSD commits
   *  them. Coordinates are clamped to the selected video layout's
   *  bounds (e.g. [0, 29] x [0, 15] for PAL, [0, 59] x [0, 21] for the
   *  60x22 HD grid) before the callback fires. */
  onElementMove?: (elementId: string, column: number, row: number) => void
  /** Per-screen tabs. ArduPilot exposes 4 OSD screens (each with its
   *  own EN/X/Y triplet per element + screen-level CHAN range). The
   *  active screen is the one the toggles + preview + drag refer to. */
  activeScreen: 1 | 2 | 3 | 4
  onSelectScreen: (screen: 1 | 2 | 3 | 4) => void
  /** Copy the active screen's full element layout (EN/X/Y) to a clipboard. */
  onCopyLayout: () => void
  /** Paste the copied layout onto the active screen as staged drafts. */
  onPasteLayout: () => void
  /** Whether a layout has been copied and is available to paste. */
  canPasteLayout: boolean
  /** Which screen the copied layout came from (for the button hint). */
  pasteSourceScreen?: 1 | 2 | 3 | 4
  /** Per-screen Screen Options (enable / TXT_RES / font / chan range / ESC idx)
   *  for the active screen, edited inline like the rest of the OSD drafts. */
  screenOptionFields: readonly OsdScreenOptionField[]
  /** Per-screen OSD<n>_ENABLE lookup for the matrix column headers. Drives the
   *  in-header enable/disable toggle so the operator can turn OSD2/3/4 on
   *  without first switching the preview to that screen. */
  screenEnableEntries: readonly OsdScreenEnableEntry[]
}

function fieldStatusClass(draftStatusById: ScopedFieldDraftMap, paramId: string): string {
  return draftStatusById.get(paramId)?.status ?? 'unchanged'
}

export function OsdView(props: OsdViewProps) {
  const {
    linkPorts,
    typeField,
    channelField,
    switchMethodField,
    msgAbbrField,
    osdShorthand,
    osdMessageSuggestions,
    previewToolbar,
    previewElements,
    elementMatrix,
    mspConfigPills,
    cellCountField,
    mspOptionsField,
    editedValues,
    onEditChange,
    draftStatusById,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert,
    onElementMove,
    activeScreen,
    onSelectScreen,
    onCopyLayout,
    onPasteLayout,
    canPasteLayout,
    pasteSourceScreen,
    screenOptionFields,
    screenEnableEntries
  } = props

  // Drag state. `gridRef` is the actual character-cell grid (the .osd-
  // preview-screen__hud--grid element); we measure its bounding rect on
  // pointer-down to convert pixel deltas into cell deltas. The drag is
  // committed via setDraft as soon as the user's pointer crosses a cell
  // boundary, so the preview reflects each cell change as it happens
  // — no separate "commit on drop" step.
  const gridRef = useRef<HTMLDivElement | null>(null)
  // Default NTSC, not PAL — an arbitrary-but-deliberate choice away from the
  // old hardcoded PAL default (field feedback). Digital systems don't need a
  // sub-choice since each one only ever runs a single fixed grid.
  const [videoSystem, setVideoSystem] = useState<OsdVideoSystem>('analog')
  const [analogSubMode, setAnalogSubMode] = useState<'pal' | 'ntsc'>('ntsc')
  const analogLayout: OsdAnalogLayout = OSD_VIDEO_SYSTEMS[videoSystem].layout ?? analogSubMode
  const layout = OSD_ANALOG_LAYOUTS[analogLayout]
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
  // Continuous, un-quantized pixel offset from the grab point, updated on
  // every pointermove — lets the element follow the cursor freely while
  // dragging instead of jumping cell-to-cell (the committed column/row still
  // only lands on whole character cells, matching ArduPilot's
  // OSDn_ELEMENT_X/Y; only the mid-drag rendering is free).
  const [dragOffsetPx, setDragOffsetPx] = useState<{ x: number; y: number } | undefined>(undefined)
  // Clicking an element's row in the left checklist (or the element itself in
  // the preview) highlights it on the other side and scrolls it into view —
  // so an operator can find "which row is this?" / "where did that land?"
  // without hunting. Click again to clear. Purely presentational; not backed
  // by any FC state.
  const [highlightedElementId, setHighlightedElementId] = useState<string | undefined>(undefined)
  const previewElementRefs = useRef(new Map<string, HTMLSpanElement>())
  const matrixRowRefs = useRef(new Map<string, HTMLDivElement>())
  function toggleHighlightedElement(elementId: string): void {
    setHighlightedElementId((current) => (current === elementId ? undefined : elementId))
  }
  useEffect(() => {
    if (!highlightedElementId) return
    previewElementRefs.current.get(highlightedElementId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    matrixRowRefs.current.get(highlightedElementId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [highlightedElementId])
  const dragStateRef = useRef<{
    elementId: string
    pointerStartX: number
    pointerStartY: number
    cellWidth: number
    cellHeight: number
    startColumn: number
    startRow: number
    lastColumn: number
    lastRow: number
  } | undefined>(undefined)

  function startElementDrag(event: React.PointerEvent<HTMLSpanElement>, element: OsdPreviewElement): void {
    if (!onElementMove || !gridRef.current) {
      return
    }
    const gridRect = gridRef.current.getBoundingClientRect()
    if (gridRect.width <= 0 || gridRect.height <= 0) {
      return
    }
    // Cell size is derived from the grid's CONTENT box (rect minus its padding)
    // so the pixel->cell conversion isn't skewed by the grid padding.
    const gridStyle = getComputedStyle(gridRef.current)
    const { cellWidth, cellHeight } = gridCellSize(
      gridRect,
      {
        left: Number.parseFloat(gridStyle.paddingLeft) || 0,
        right: Number.parseFloat(gridStyle.paddingRight) || 0,
        top: Number.parseFloat(gridStyle.paddingTop) || 0,
        bottom: Number.parseFloat(gridStyle.paddingBottom) || 0
      },
      layout.columns,
      layout.rows
    )
    if (cellWidth <= 0 || cellHeight <= 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    // Grab from the element's position AS DISPLAYED on the active layout (the raw
    // param may sit beyond this grid), so the element tracks the cursor from the
    // grab point instead of jumping.
    const startColumn = clampCellToLayout(element.column, layout.columns - 1)
    const startRow = clampCellToLayout(element.row, layout.rows - 1)
    dragStateRef.current = {
      elementId: element.id,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      cellWidth,
      cellHeight,
      startColumn,
      startRow,
      lastColumn: startColumn,
      lastRow: startRow
    }
    setDraggingId(element.id)
    setDragOffsetPx({ x: 0, y: 0 })
  }

  function moveElementDrag(event: React.PointerEvent<HTMLSpanElement>): void {
    const state = dragStateRef.current
    if (!state || !onElementMove) {
      return
    }
    const { column: nextColumn, row: nextRow } = pointerDragToCell({
      pointerX: event.clientX,
      pointerY: event.clientY,
      pointerStartX: state.pointerStartX,
      pointerStartY: state.pointerStartY,
      startColumn: state.startColumn,
      startRow: state.startRow,
      cellWidth: state.cellWidth,
      cellHeight: state.cellHeight,
      maxColumn: layout.columns - 1,
      maxRow: layout.rows - 1
    })
    if (nextColumn !== state.lastColumn || nextRow !== state.lastRow) {
      state.lastColumn = nextColumn
      state.lastRow = nextRow
      onElementMove(state.elementId, nextColumn, nextRow)
    }
    // Free-follow the raw pointer for the VISUAL position (clamped to the
    // grid's edges, same bounds pointerDragToCell enforces for the committed
    // cell) — decoupled from the quantized column/row above, so the element
    // doesn't visually teleport cell-to-cell while the operator is still
    // mid-drag.
    const maxOffsetX = (layout.columns - 1 - state.startColumn) * state.cellWidth
    const minOffsetX = -state.startColumn * state.cellWidth
    const maxOffsetY = (layout.rows - 1 - state.startRow) * state.cellHeight
    const minOffsetY = -state.startRow * state.cellHeight
    setDragOffsetPx({
      x: Math.max(minOffsetX, Math.min(maxOffsetX, event.clientX - state.pointerStartX)),
      y: Math.max(minOffsetY, Math.min(maxOffsetY, event.clientY - state.pointerStartY))
    })
  }

  function endElementDrag(event: React.PointerEvent<HTMLSpanElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStateRef.current = undefined
    setDraggingId(undefined)
    setDragOffsetPx(undefined)
  }

  const dragEnabled = typeof onElementMove === 'function'

  // Current cell position per element id, for the "align to position" X/Y
  // inputs (lets operators type an exact cell instead of only dragging).
  const previewById = new Map(previewElements.map((element) => [element.id, element]))
  const knownElementIds = new Set(OSD_ELEMENT_GROUPS.flatMap((group) => group.elementIds))

  // Group the per-screen enable matrix by BF-style category. Elements whose
  // elementId isn't recognized in any group fall into a synthetic "Other"
  // bucket at the end. Rows x OSD-screen (columns) checkbox grid.
  const matrixByElementId = new Map(elementMatrix.map((row) => [row.elementId, row]))
  const groupedMatrix = OSD_ELEMENT_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    rows: group.elementIds
      .map((elementId) => matrixByElementId.get(elementId))
      .filter((row): row is OsdElementMatrixRow => row !== undefined)
  })).filter((group) => group.rows.length > 0)
  const otherMatrix = elementMatrix.filter((row) => !knownElementIds.has(row.elementId))
  if (otherMatrix.length > 0) {
    groupedMatrix.push({ id: 'other', label: 'Other', rows: otherMatrix })
  }
  const screenColumns = [1, 2, 3, 4]
  const matrixCellChecked = (cell: OsdElementMatrixCell): boolean => {
    const edited = editedValues[cell.parameterId]
    if (edited !== undefined && edited !== '') {
      return Math.round(Number(edited)) === 1
    }
    return cell.liveValue === 1
  }
  const totalMatrixEnabled = elementMatrix.reduce(
    (sum, row) => sum + row.cells.filter((cell) => matrixCellChecked(cell)).length,
    0
  )

  return (
    <section className="grid one-up">
      <Panel
        title="OSD"
        subtitle={
          dragEnabled
            ? 'FPV overlay configuration — BF-style. Drag elements on the preview to reposition them on the character grid for the selected video layout; toggle visibility from the categorized menu on the left.'
            : 'FPV overlay configuration — BF-style. Pick a backend, route a display link in Ports, and toggle which elements appear on the live preview.'
        }
      >
        <div className="bf-tab-stack">
          {/* The "Previewing OSDn" dropdown used to live here, far from the
           *  preview canvas it actually drives. It's now docked into the
           *  Preview pane's titlebar (search "osd-preview-screen-select"). */}

          {/* Copy/Paste a whole screen layout between OSD screens (MP parity):
              copy this screen's element enables + positions, switch the
              "Previewing" screen, then paste to stage them onto it. */}
          <div className="osd-layout-clipboard" data-testid="osd-layout-clipboard">
            <button
              type="button"
              data-testid="osd-copy-layout"
              style={buttonStyle()}
              onClick={onCopyLayout}
              disabled={isBusy}
            >
              Copy Layout
            </button>
            <button
              type="button"
              data-testid="osd-paste-layout"
              style={buttonStyle()}
              onClick={onPasteLayout}
              disabled={isBusy || !canPasteLayout}
            >
              {canPasteLayout && pasteSourceScreen !== undefined
                ? `Paste Layout (from OSD${pasteSourceScreen})`
                : 'Paste Layout'}
            </button>
          </div>

          {/* Backend strip moved above Screen Options — the FC-side
           *  backend selection (analog / DisplayPort / MSP) is conceptually
           *  the parent of the per-screen options below, and BF puts the
           *  backend selectors near the top too. Collapsed details<summary>
           *  so it occupies one line when the operator isn't editing
           *  backends — keeps the page from front-loading three big
           *  selects on every visit. */}
          <details className="bf-gui-box osd-backend-strip" data-testid="osd-backend-strip">
            <summary className="bf-gui-box__titlebar">
              <strong>Backend</strong>
              <small>{previewToolbar.backendText} · {previewToolbar.switchingText} · {previewToolbar.cellsText}</small>
            </summary>
            <div className="bf-gui-box__body">
              <div className="bf-compact-field-grid">
                {typeField ? (
                  <ScopedSelectField
                    parameter={typeField.parameter}
                    liveValue={typeField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    layout="chips"
                  />
                ) : null}
                {channelField ? (
                  <ScopedSelectField
                    parameter={channelField.parameter}
                    liveValue={channelField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    layout="chips"
                  />
                ) : null}
                {switchMethodField ? (
                  <ScopedSelectField
                    parameter={switchMethodField.parameter}
                    liveValue={switchMethodField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    layout="chips"
                  />
                ) : null}
              </div>
            </div>
          </details>

          {/* Fork-only MESSAGE-panel controls, gated on OSD_MSG_ABBR being
              reported by the firmware. The per-screen severity filter
              (OSDn_MSG_LVL) rides the Screen Options panel below. */}
          {msgAbbrField ? (
            <details className="bf-gui-box osd-messages-strip" data-testid="osd-messages-strip" open>
              <summary className="bf-gui-box__titlebar">
                <strong>Messages</strong>
                <small>MESSAGE panel cleanliness</small>
              </summary>
              <div className="bf-gui-box__body">
                <div className="bf-compact-field-grid">
                  <ScopedSelectField
                    parameter={msgAbbrField.parameter}
                    liveValue={msgAbbrField.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    layout="chips"
                  />
                </div>
                <p className="bf-note">
                  Per-screen message severity (which messages each screen shows) is under each screen&apos;s{' '}
                  <strong>Screen Options</strong> below.
                </p>

                {osdShorthand.status === 'available' ? (
                  <div className="osd-shorthand" data-testid="osd-shorthand-editor">
                    <div className="osd-shorthand__header">
                      <strong>Custom abbreviations</strong>
                      <span>
                        {osdShorthand.entries.length}/{osdShorthand.maxEntries}
                      </span>
                    </div>
                    {osdShorthand.entries.length === 0 ? (
                      <p className="bf-note">No custom abbreviations yet — add a row to define your own.</p>
                    ) : (
                      osdShorthand.entries.map((entry, index) => (
                        <div key={index} className="osd-shorthand__row">
                          <OsdMessageCombobox
                            testId={`osd-shorthand-from-${index}`}
                            ariaLabel={`abbreviation ${index + 1} from`}
                            value={entry.from}
                            maxLength={osdShorthand.fromMax}
                            disabled={osdShorthand.saving}
                            suggestions={osdMessageSuggestions}
                            onChange={(next) => osdShorthand.setEntry(index, { from: next })}
                          />
                          <span aria-hidden="true">→</span>
                          <input
                            aria-label={`abbreviation ${index + 1} to`}
                            data-testid={`osd-shorthand-to-${index}`}
                            type="text"
                            placeholder="Short"
                            maxLength={osdShorthand.toMax}
                            value={entry.to}
                            disabled={osdShorthand.saving}
                            onChange={(event) => osdShorthand.setEntry(index, { to: event.target.value })}
                          />
                          <button
                            type="button"
                            style={buttonStyle()}
                            data-testid={`osd-shorthand-remove-${index}`}
                            disabled={osdShorthand.saving}
                            onClick={() => osdShorthand.removeEntry(index)}
                            aria-label={`remove abbreviation ${index + 1}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                    {osdShorthand.error ? (
                      <p className="switch-exercise-warning" data-testid="osd-shorthand-error">
                        {osdShorthand.error}
                      </p>
                    ) : null}
                    <div className="osd-shorthand__actions">
                      <button
                        type="button"
                        style={buttonStyle()}
                        data-testid="osd-shorthand-add"
                        disabled={osdShorthand.saving || osdShorthand.entries.length >= osdShorthand.maxEntries}
                        onClick={osdShorthand.addEntry}
                      >
                        Add row
                      </button>
                      <button
                        type="button"
                        style={buttonStyle('primary')}
                        data-testid="osd-shorthand-save"
                        disabled={!osdShorthand.dirty || osdShorthand.saving}
                        onClick={osdShorthand.save}
                      >
                        {osdShorthand.saving ? 'Saving…' : 'Save to FC'}
                      </button>
                      <button
                        type="button"
                        style={buttonStyle()}
                        data-testid="osd-shorthand-reset"
                        disabled={!osdShorthand.dirty || osdShorthand.saving}
                        onClick={osdShorthand.reset}
                      >
                        Reset
                      </button>
                    </div>
                    <p className="bf-note">
                      Your own from→to substitutions, applied to the MESSAGE panel on top of the built-in dictionary
                      (from ≤{osdShorthand.fromMax} chars, to ≤{osdShorthand.toMax}). Matching is case-insensitive.
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {screenOptionFields.length > 0 ? (
            <details className="bf-gui-box osd-screen-options" data-testid="osd-screen-options" open>
              <summary className="bf-gui-box__titlebar">
                <strong>Screen {activeScreen} Options</strong>
              </summary>
              <div className="bf-gui-box__body">
                <div className="scoped-editor-grid">
                  {screenOptionFields.map((field) =>
                    field.kind === 'select' ? (
                      <ScopedSelectField
                        key={field.parameter.id}
                        parameter={field.parameter}
                        liveValue={field.liveValue}
                        editedValues={editedValues}
                        draftStatusById={draftStatusById}
                        onChange={onEditChange}
                        layout="chips"
                      />
                    ) : (
                      <ScopedField
                        key={field.parameter.id}
                        parameter={field.parameter}
                        liveValue={field.liveValue}
                        editedValues={editedValues}
                        draftStatusById={draftStatusById}
                        onChange={onEditChange}
                        stepFallback={field.parameter.definition?.step ?? 1}
                      />
                    )
                  )}
                </div>
              </div>
            </details>
          ) : null}

          <div className="bf-note">
            <p>
              {linkPorts.length > 0
                ? `Display link: ${linkPorts.map((port) => `${port.label} (${port.protocolLabel})`).join(', ')}`
                : 'No MSP / DisplayPort OSD link is currently assigned in Ports. Configure that first — this tab can\'t drive the overlay until the display path is in place.'}
            </p>
          </div>

          {/* BF-style menu + preview split. Left column = categorized
            * element-toggle menu + MSP / DisplayPort card; right column
            * = sticky preview that stays visible as the operator scrolls
            * through categories. */}
          <div className="osd-bf-layout">
            <div className="osd-bf-menu" data-testid="osd-bf-menu">
              <article className="bf-gui-box osd-elements">
                <div className="bf-gui-box__titlebar">
                  <strong>Elements</strong>
                  <small>{totalMatrixEnabled} enabled across OSD1-4 · checkboxes pick which screen shows each</small>
                </div>
                <div className="bf-gui-box__body">
                  {elementMatrix.length === 0 ? (
                    <p>No OSD element parameters reported by this autopilot. The matrix populates once the FC's OSD layout parameters arrive.</p>
                  ) : (
                    <div className="osd-matrix" data-testid="osd-element-matrix">
                      <div className="osd-matrix__row osd-matrix__row--head">
                        <span className="osd-matrix__label">Element</span>
                        {screenColumns.map((screen) => {
                          const enableEntry = screenEnableEntries.find((entry) => entry.screen === screen)
                          const enableParam = enableEntry?.parameter
                          // Stage-aware enabled check: draft beats live value, same
                          // pattern as matrixCellChecked above.
                          const enabled = (() => {
                            if (!enableParam) return undefined
                            const draft = editedValues[enableParam.id]
                            if (draft !== undefined && draft !== '') {
                              return Math.round(Number(draft)) === 1
                            }
                            return enableParam.value === 1
                          })()
                          return (
                            <span
                              key={screen}
                              className={`osd-matrix__col${screen === activeScreen ? ' is-preview' : ''}`}
                              data-testid={`osd-matrix-col-${screen}`}
                            >
                              <span className="osd-matrix__col-name">OSD{screen}</span>
                              {!enableParam ? (
                                <small className="osd-matrix__col-status osd-matrix__col-status--na" data-testid={`osd-screen-${screen}-not-supported`}>
                                  not supported
                                </small>
                              ) : enabled ? (
                                <button
                                  type="button"
                                  className="osd-matrix__col-toggle osd-matrix__col-toggle--on"
                                  data-testid={`osd-screen-${screen}-toggle`}
                                  aria-pressed="true"
                                  aria-label={`Disable OSD${screen}`}
                                  title={`OSD${screen} enabled — click to stage a disable`}
                                  onClick={() => onEditChange(enableParam.id, '0')}
                                >
                                  on
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="osd-matrix__col-toggle osd-matrix__col-toggle--off"
                                  data-testid={`osd-screen-${screen}-toggle`}
                                  aria-pressed="false"
                                  aria-label={`Enable OSD${screen}`}
                                  title={`OSD${screen} disabled — click to stage an enable`}
                                  onClick={() => onEditChange(enableParam.id, '1')}
                                >
                                  enable
                                </button>
                              )}
                            </span>
                          )
                        })}
                      </div>
                      {groupedMatrix.map((group) => (
                        <section key={group.id} className="osd-matrix__group" data-testid={`osd-element-group-${group.id}`}>
                          <header className="osd-matrix__group-header">{group.label}</header>
                          {group.rows.map((row) => {
                            const placed = previewById.get(row.elementId)
                            const enabledOnPreview = row.cells.some((cell) => cell.screen === activeScreen && matrixCellChecked(cell))
                            const showAlign = enabledOnPreview && dragEnabled && placed !== undefined && onElementMove !== undefined
                            const isHighlighted = highlightedElementId === row.elementId
                            return (
                              <div
                                key={row.elementId}
                                ref={(node) => {
                                  if (node) matrixRowRefs.current.set(row.elementId, node)
                                  else matrixRowRefs.current.delete(row.elementId)
                                }}
                                className={`osd-matrix__row${isHighlighted ? ' is-highlighted' : ''}`}
                                data-testid={`osd-element-row-${row.elementId}`}
                              >
                                <span
                                  className="osd-matrix__label osd-matrix__label--clickable"
                                  role="button"
                                  tabIndex={0}
                                  data-testid={`osd-element-row-label-${row.elementId}`}
                                  onClick={() => toggleHighlightedElement(row.elementId)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      toggleHighlightedElement(row.elementId)
                                    }
                                  }}
                                >
                                  <strong>{row.label}</strong>
                                  <small>{row.elementId}</small>
                                </span>
                                {screenColumns.map((screen) => {
                                  const cell = row.cells.find((entry) => entry.screen === screen)
                                  if (!cell) {
                                    return <span key={screen} className="osd-matrix__cell osd-matrix__cell--na">·</span>
                                  }
                                  return (
                                    <span
                                      key={screen}
                                      className={`osd-matrix__cell osd-matrix__cell--${fieldStatusClass(draftStatusById, cell.parameterId)}${screen === activeScreen ? ' is-preview' : ''}`}
                                    >
                                      <input
                                        type="checkbox"
                                        aria-label={`${row.label} on OSD${screen}`}
                                        data-testid={`osd-cell-${row.elementId}-${screen}`}
                                        checked={matrixCellChecked(cell)}
                                        onChange={(event) => onEditChange(cell.parameterId, event.target.checked ? '1' : '0')}
                                      />
                                    </span>
                                  )
                                })}
                                {showAlign && placed ? (
                                  <span className="osd-matrix__align" data-testid={`osd-element-align-${row.elementId}`}>
                                    <label>
                                      X
                                      <input
                                        type="number"
                                        min={0}
                                        max={layout.columns - 1}
                                        value={clampCellToLayout(placed.column, layout.columns - 1)}
                                        onChange={(event) =>
                                          // Commit the untouched Y axis at its real stored value, not the
                                          // grid-clamped display value — otherwise editing X silently truncates
                                          // an element positioned outside the previewed grid (e.g. an HD-placed
                                          // element viewed under analog NTSC). Only the edited axis is clamped.
                                          onElementMove?.(row.elementId, clampCellToLayout(Number(event.target.value), layout.columns - 1), placed.row)
                                        }
                                      />
                                    </label>
                                    <label>
                                      Y
                                      <input
                                        type="number"
                                        min={0}
                                        max={layout.rows - 1}
                                        value={clampCellToLayout(placed.row, layout.rows - 1)}
                                        onChange={(event) =>
                                          // Untouched X axis keeps its real stored value; only the edited Y axis is clamped.
                                          onElementMove?.(row.elementId, placed.column, clampCellToLayout(Number(event.target.value), layout.rows - 1))
                                        }
                                      />
                                    </label>
                                  </span>
                                ) : null}
                              </div>
                            )
                          })}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </article>

              <article className="bf-gui-box osd-msp">
                <div className="bf-gui-box__titlebar">
                  <strong>MSP / DisplayPort</strong>
                </div>
                <div className="bf-gui-box__body">
                  <div className="config-pills">
                    {mspConfigPills.length > 0
                      ? mspConfigPills.map((pill, index) => <span key={`osd-msp-pill:${index}`}>{pill}</span>)
                      : <span>No active display link</span>}
                  </div>
                  <div className="osd-msp__fields">
                    {cellCountField ? (
                      <div className="osd-msp__cell-count" data-testid="osd-msp-cell-count">
                        <ScopedSelectField
                          parameter={cellCountField.parameter}
                          liveValue={cellCountField.liveValue}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                        />
                        {Number(editedValues[cellCountField.parameter.id] ?? cellCountField.liveValue ?? 0) === 0 ? (
                          <small className="osd-msp__cell-count-note" data-testid="osd-msp-cell-count-note">
                            Set an explicit cell count and save it — Auto can misread pack voltage on some MSP displays.
                          </small>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="scoped-editor-field scoped-editor-field--compact" data-testid="osd-element-units">
                      <span>Element units</span>
                      <select disabled aria-label="Per-element OSD units (placeholder)" title="ArduPilot applies units globally, not per element.">
                        <option>Follows global units</option>
                      </select>
                      <small>
                        Placeholder — ArduPilot applies measurement units globally (OSD_UNITS), not per element, so individual elements can’t pick their own units.
                      </small>
                    </div>
                    {mspOptionsField ? (
                      <div
                        className={`scoped-editor-field scoped-editor-field--compact scoped-editor-field--${fieldStatusClass(draftStatusById, mspOptionsField.parameter.id)}`}
                        role="group"
                        aria-label={mspOptionsField.parameter.definition?.label ?? mspOptionsField.parameter.id}
                      >
                        <span>{mspOptionsField.parameter.definition?.label ?? mspOptionsField.parameter.id}</span>
                        <div className="scoped-bitmask-bits">
                          {mspOptionsField.bits.map((bit) => (
                            <button
                              type="button"
                              key={`${mspOptionsField.parameter.id}:${bit.bit}`}
                              className={`scoped-bitmask-bit${bit.isChecked ? ' is-set' : ''}`}
                              aria-pressed={bit.isChecked}
                              onClick={() => mspOptionsField.onToggleBit(bit.bit, !bit.isChecked)}
                            >
                              {bit.label}
                            </button>
                          ))}
                        </div>
                        <small>{mspOptionsField.captionText}</small>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            </div>

            <article className="bf-gui-box osd-bf-preview" data-testid="osd-bf-preview-pane">
              <div className="bf-gui-box__titlebar">
                <strong>Preview</strong>
                <label
                  className="osd-preview-screen-select osd-preview-screen-select--inline"
                  data-testid="osd-screen-tabs"
                >
                  <span>Screen</span>
                  <select
                    data-testid="osd-preview-screen-select"
                    value={activeScreen}
                    onChange={(event) => onSelectScreen(Number(event.target.value) as 1 | 2 | 3 | 4)}
                  >
                    {[1, 2, 3, 4].map((screen) => (
                      <option key={`osd-screen:${screen}`} value={screen}>
                        OSD{screen}
                      </option>
                    ))}
                  </select>
                </label>
                <small>{previewElements.length} element{previewElements.length === 1 ? '' : 's'}</small>
              </div>
              <div className="bf-gui-box__body">
                <div
                  className={`osd-preview-screen${dragEnabled ? ' osd-preview-screen--interactive' : ''}`}
                  data-osd-layout={analogLayout}
                  style={{ aspectRatio: `${layout.columns} / ${layout.rows}` }}
                >
                  {/* Center-point crosshair — overlay rendered regardless of
                   *  whether the FC has reported any element positions, so
                   *  the operator always sees where the screen centre is
                   *  while dragging items around or eyeballing positions. */}
                  <div
                    className="osd-preview-screen__center-marker"
                    data-testid="osd-preview-center-marker"
                    aria-hidden="true"
                  >
                    <span className="osd-preview-screen__center-marker-horizontal" />
                    <span className="osd-preview-screen__center-marker-vertical" />
                  </div>
                  {previewElements.length > 0 ? (
                    <div
                      ref={gridRef}
                      className="osd-preview-screen__hud osd-preview-screen__hud--grid"
                      data-testid="osd-preview-grid"
                      style={{
                        // minmax(0, 1fr) keeps every character cell exactly equal.
                        // Plain `1fr` has an `auto` minimum, so a cell would GROW to
                        // fit an element's overflowing nowrap text and shove all the
                        // other cells sideways — which read as elements "snapping to
                        // avoid each other" while dragging. Fixed tracks let text
                        // overflow/overlap in place, like a real character-cell OSD.
                        gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
                      }}
                    >
                      {previewElements.map((element) => {
                        const isDragging = draggingId === element.id
                        const isHighlighted = highlightedElementId === element.id
                        // Render at the element's position AS IT LANDS on the
                        // active layout. The raw param can sit beyond this grid
                        // (a 60-col HD layout viewed as 30-col PAL), so clamp to
                        // the previewed grid instead of overflowing off-canvas.
                        const displayColumn = clampCellToLayout(element.column, layout.columns - 1)
                        const displayRow = clampCellToLayout(element.row, layout.rows - 1)
                        const className = [
                          'osd-preview-screen__element',
                          dragEnabled ? 'osd-preview-screen__element--draggable' : '',
                          isDragging ? 'is-dragging' : '',
                          isHighlighted ? 'is-highlighted' : ''
                        ].filter(Boolean).join(' ')
                        // Friendly name shown while dragging (or highlighted) —
                        // element.text is the OSD-glyph preview string (e.g. the
                        // dashes for HORIZON), not a readable name, so the
                        // operator otherwise has no way to tell which element
                        // they're moving.
                        const friendlyLabel = matrixByElementId.get(element.id)?.label ?? element.id
                        // While actively dragging THIS element, freeze its grid cell at
                        // the drag-start position and slide it visually via a pixel
                        // transform instead — the committed column/row still updates
                        // (badge + drafts), but the DOM position only re-quantizes to
                        // the new cell once the drag ends, so the box doesn't visually
                        // teleport cell-to-cell while the pointer is still moving.
                        const dragStart = isDragging ? dragStateRef.current : undefined
                        const gridColumnStart = dragStart ? dragStart.startColumn + 1 : displayColumn + 1
                        const gridRowStart = dragStart ? dragStart.startRow + 1 : displayRow + 1
                        return (
                          <span
                            key={element.id}
                            ref={(node) => {
                              if (node) previewElementRefs.current.set(element.id, node)
                              else previewElementRefs.current.delete(element.id)
                            }}
                            className={className}
                            data-testid={`osd-preview-element-${element.id}`}
                            style={{
                              gridColumnStart,
                              gridRowStart,
                              transform:
                                isDragging && dragOffsetPx
                                  ? `translate(${dragOffsetPx.x}px, ${dragOffsetPx.y}px) scale(1.05)`
                                  : undefined
                            }}
                            onPointerDown={dragEnabled ? (event) => startElementDrag(event, element) : undefined}
                            onPointerMove={dragEnabled ? moveElementDrag : undefined}
                            onPointerUp={dragEnabled ? endElementDrag : undefined}
                            onPointerCancel={dragEnabled ? endElementDrag : undefined}
                            onClick={() => toggleHighlightedElement(element.id)}
                          >
                            {element.text}
                            {isDragging || isHighlighted ? (
                              <span className="osd-preview-screen__element-pos" aria-hidden="true" data-testid={`osd-preview-element-label-${element.id}`}>
                                {friendlyLabel}
                                {isDragging ? ` ${displayColumn},${displayRow}` : ''}
                              </span>
                            ) : null}
                          </span>
                        )
                      })}
                      {/* The dim "+" grid-cell center marker was replaced by
                       *  the absolutely-positioned crosshair overlay above
                       *  (.osd-preview-screen__center-marker). Keeps the
                       *  layout cleaner and makes the centre visible even
                       *  on the empty-state branch. */}
                    </div>
                  ) : (
                    <div className="osd-preview-screen__empty" data-testid="osd-preview-empty">
                      <p>No OSD{activeScreen} layout reported by the FC.</p>
                      <p>
                        Connect an autopilot with an active MSP / DisplayPort link, or enable individual elements
                        from the menu on the left.
                      </p>
                    </div>
                  )}
                </div>
                <div className="osd-preview-footer">
                  <StatusBadge tone={dragEnabled ? 'success' : 'neutral'}>
                    {dragEnabled ? 'editable · drag to reposition' : 'live preview'}
                  </StatusBadge>
                  <label className="osd-preview-footer__layout" data-testid="osd-analog-layout">
                    <span>Video system</span>
                    <select
                      value={videoSystem}
                      onChange={(event) => setVideoSystem(event.target.value as OsdVideoSystem)}
                      aria-label="OSD video system"
                    >
                      {(Object.keys(OSD_VIDEO_SYSTEMS) as OsdVideoSystem[]).map((key) => {
                        const system = OSD_VIDEO_SYSTEMS[key]
                        const gridSuffix = system.layout
                          ? ` (${OSD_ANALOG_LAYOUTS[system.layout].columns}×${OSD_ANALOG_LAYOUTS[system.layout].rows})`
                          : ''
                        return (
                          <option key={key} value={key}>
                            {system.label}
                            {gridSuffix}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  {videoSystem === 'analog' ? (
                    <label className="osd-preview-footer__layout" data-testid="osd-analog-submode">
                      <span>Analog standard</span>
                      <select
                        value={analogSubMode}
                        onChange={(event) => setAnalogSubMode(event.target.value as 'pal' | 'ntsc')}
                        aria-label="OSD analog standard"
                      >
                        <option value="ntsc">NTSC ({OSD_ANALOG_LAYOUTS.ntsc.columns}×{OSD_ANALOG_LAYOUTS.ntsc.rows})</option>
                        <option value="pal">PAL ({OSD_ANALOG_LAYOUTS.pal.columns}×{OSD_ANALOG_LAYOUTS.pal.rows})</option>
                      </select>
                    </label>
                  ) : null}
                  <p className="osd-preview-footer__match-note">
                    The goggles/VRX, camera, and FC OSD settings must all agree on the same video system — a
                    mismatch here is a preview-only aid and won&apos;t fix a mismatch on the real hardware.
                  </p>
                  <p>
                    Element positions read from the OSD{activeScreen}_*_X/Y catalog values. Live telemetry feeds the
                    displayed numbers. Video layout is a preview aid (PAL/NTSC/HD canvas) and doesn’t change FC params.
                  </p>
                </div>
              </div>
            </article>
          </div>

          <div className="bf-toolbar">
            <div className="bf-toolbar__status">
              <span>{stagedCount} staged</span>
              <span>{invalidCount} invalid</span>
            </div>
            <button
              type="button"
              data-testid="osd-save"
              style={buttonStyle('primary')}
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            >
              {isApplying ? 'Applying…' : `Save OSD (${stagedCount})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={onRevert}
              disabled={isBusy || draftCount === 0}
            >
              Revert
            </button>
          </div>
        </div>
      </Panel>
    </section>
  )
}
