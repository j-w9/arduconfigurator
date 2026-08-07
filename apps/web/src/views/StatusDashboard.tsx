// The drag-and-resize chrome for the Status & Info page.
//
// This is chrome ONLY. Every card it renders is passed in already built by
// App.tsx and is handed through untouched — no card knows it lives in a
// dashboard, so the sensor-availability gate, the telemetry requests and every
// value on the page behave exactly as they did before.
//
// ── WHY v1 FELT CLUNKY, AND WHAT CHANGED ──────────────────────────────────
//
// The verdict on the shipped version was "fairly clunky". It was, and the
// cause was structural rather than a missing polish pass: v1 previewed a drop
// by inserting a REAL element into the target column. Every pointermove that
// crossed a slot boundary therefore relaid out the page — cards below the
// indicator moved down by its height, the column changed height, and the whole
// grid reflowed under a cursor that had barely moved. On top of that, the move
// handler called `document.elementFromPoint` and `getBoundingClientRect` on
// every single event, which forces a synchronous style+layout flush, so the
// browser was laying the page out twice per pointer event at pointer rate.
// The known symptom — a drop landing in a different column than the indicator
// promised, because releasing re-hit-tested coordinates the indicator had
// shifted by 56px — was that reflow showing through, not a one-off bug.
//
// Three changes, in order of how much they matter:
//
//  1. THE DRAG NEVER CHANGES LAYOUT. The dragged card keeps its slot in the
//     flow and is moved by a `transform` — a composited property, zero layout
//     cost. The drop position is shown by an absolutely-positioned indicator
//     that is out of flow and pushes nothing. Nothing on the page moves during
//     a drag except the card under the finger.
//  2. GEOMETRY IS SNAPSHOTTED ONCE, at pointer-down, in one batched read. Hit
//     testing is then pure arithmetic against that snapshot
//     (`resolveStatusDashboardDrop`, unit-tested off the DOM). Because (1)
//     guarantees the page does not move, the snapshot stays true for the whole
//     gesture. There is not one layout read in the move handler.
//  3. MOVES ARE rAF-COALESCED. Pointer events land at up to 240Hz on a good
//     trackpad; only the newest position matters. The handler stores it and
//     schedules one animation frame, which writes the transform directly to
//     the node and only calls setState when the drop TARGET actually changed —
//     so a drag across a column is a handful of React renders, not hundreds.
//
// Pointer capture, `touch-action: none` and `user-select: none` are set on the
// handles so a drag cannot be stolen by scrolling, text selection, or the
// pointer leaving the element.
//
// Pointer events, not HTML5 drag-and-drop: HTML5 DnD has no touch story, no
// keyboard story, and drags a browser-drawn ghost we cannot style. Because
// these are unified pointer events, a touch or pen drag on a landscape tablet
// works exactly like a mouse drag; below 1025px the page is one column and
// customisation is off entirely.
//
// The placement model — regions, bands, columns, spans — and the honest
// re-evaluation of react-grid-layout live in
// `../view-models/status-dashboard-layout`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'

import type { StatusDashboardLayoutController } from '../hooks/use-status-dashboard-layout'
import {
  STATUS_DASHBOARD_GRID_COLUMNS,
  STATUS_DASHBOARD_MIN_ROWS,
  STATUS_DASHBOARD_ROW_PX,
  bandFreeSpan,
  columnCardIds,
  columnStartLine,
  findPlacement,
  regionBands,
  resolveStatusDashboardDrop,
  type StatusDashboardColumn,
  type StatusDashboardDropTarget,
  type StatusDashboardGeometry,
  type StatusDashboardRegionId
} from '../view-models/status-dashboard-layout'

/** One card as the dashboard sees it: an id, a name for screen readers, a node. */
export interface StatusDashboardCardEntry {
  id: string
  label: string
  node: ReactNode
}

/** Where the drop indicator should be painted, in viewport coordinates. */
interface Indicator {
  left: number
  top: number
  width: number
  height: number
  orientation: 'horizontal' | 'vertical'
}

interface DragMutable {
  id: string
  pointerId: number
  originX: number
  originY: number
  pointerX: number
  pointerY: number
  scrollX: number
  scrollY: number
  geometry: StatusDashboardGeometry
  node: HTMLElement | undefined
  frame: number | undefined
  target: StatusDashboardDropTarget | undefined
}

interface DashboardContextValue {
  controller: StatusDashboardLayoutController
  cardsById: Map<string, StatusDashboardCardEntry>
  draggingId: string | undefined
  beginDrag: (id: string, event: ReactPointerEvent<HTMLElement>) => void
  resizePreview: { id: string; rows: number } | undefined
  setResizePreview: (preview: { id: string; rows: number } | undefined) => void
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined)

function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('Status dashboard parts must be rendered inside StatusDashboardProvider')
  }
  return context
}

function toRect(element: Element): { left: number; top: number; right: number; bottom: number } {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/**
 * Read every region, column and card rect in one pass.
 *
 * Called exactly once per drag, before anything has moved. Every
 * `getBoundingClientRect` in a drag happens here, in one batch, so the browser
 * flushes layout once rather than once per pointer event.
 */
function collectGeometry(): StatusDashboardGeometry {
  const regions: StatusDashboardGeometry['regions'] = []
  for (const element of document.querySelectorAll('[data-status-dash-region]')) {
    const region = element.getAttribute('data-status-dash-region')
    if (region === 'main' || region === 'side') {
      regions.push({ region, rect: toRect(element) })
    }
  }
  const columns: StatusDashboardGeometry['columns'] = []
  for (const element of document.querySelectorAll('[data-status-dash-col]')) {
    const id = element.getAttribute('data-status-dash-col')
    const region = element.getAttribute('data-status-dash-col-region')
    const band = Number(element.getAttribute('data-status-dash-col-band'))
    if (!id || (region !== 'main' && region !== 'side') || !Number.isFinite(band)) {
      continue
    }
    const cards: StatusDashboardGeometry['columns'][number]['cards'] = []
    for (const cardElement of element.querySelectorAll('[data-status-dash-card]')) {
      const cardId = cardElement.getAttribute('data-status-dash-card')
      if (cardId) {
        cards.push({ id: cardId, rect: toRect(cardElement) })
      }
    }
    columns.push({ id, region, band, rect: toRect(element), cards })
  }
  return { regions, columns }
}

export interface StatusDashboardProviderProps {
  controller: StatusDashboardLayoutController
  cards: readonly StatusDashboardCardEntry[]
  children: ReactNode
}

export function StatusDashboardProvider({
  controller,
  cards,
  children
}: StatusDashboardProviderProps): ReactElement {
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
  const [indicator, setIndicator] = useState<Indicator | undefined>(undefined)
  const [resizePreview, setResizePreview] = useState<{ id: string; rows: number } | undefined>(undefined)
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const drag = useRef<DragMutable | undefined>(undefined)

  // `dropCard` is read through a ref so the pointer listeners below can be
  // registered ONCE per gesture instead of being torn down and re-attached
  // every time the drop target changes — which is what v1 did, on every move.
  const dropCardRef = useRef(controller.dropCard)
  dropCardRef.current = controller.dropCard

  /** Turn a resolved drop target back into a line to paint, from the snapshot. */
  const indicatorFor = useCallback(
    (state: DragMutable, target: StatusDashboardDropTarget | undefined): Indicator | undefined => {
      if (!target) {
        return undefined
      }
      // The page can still be scrolled mid-drag (a wheel, a trackpad flick).
      // The snapshot is in viewport coordinates, so correct it by the scroll
      // delta rather than re-measuring anything.
      const dx = state.scrollX - window.scrollX
      const dy = state.scrollY - window.scrollY
      const geometry = state.geometry

      if (target.kind === 'column') {
        const column = geometry.columns.find((entry) => entry.id === target.columnId)
        if (!column) {
          return undefined
        }
        const others = column.cards.filter((card) => card.id !== state.id)
        const shelf =
          others.length > 1 && others.some((card, index) => index > 0 && Math.abs(card.rect.top - others[0]!.rect.top) < 8)
        if (shelf) {
          const before = others[target.index]
          const after = others[target.index - 1]
          const x = before ? before.rect.left - 7 : after ? after.rect.right + 7 : column.rect.left
          return {
            left: x + dx - 2,
            top: column.rect.top + dy,
            width: 4,
            height: Math.max(column.rect.bottom - column.rect.top, 24),
            orientation: 'vertical'
          }
        }
        const before = others[target.index]
        const after = others[target.index - 1]
        const y = before ? before.rect.top - 7 : after ? after.rect.bottom + 7 : column.rect.top
        return {
          left: column.rect.left + dx,
          top: y + dy - 2,
          width: Math.max(column.rect.right - column.rect.left, 24),
          height: 4,
          orientation: 'horizontal'
        }
      }

      const inRegion = geometry.columns.filter((entry) => entry.region === target.region)
      if (inRegion.length === 0) {
        return undefined
      }

      if (target.kind === 'new-column') {
        const inBand = inRegion
          .filter((entry) => entry.band === target.band)
          .sort((a, b) => a.rect.left - b.rect.left)
        if (inBand.length === 0) {
          return undefined
        }
        const before = inBand[target.at]
        const after = inBand[target.at - 1]
        const x = before ? before.rect.left - 7 : after ? after.rect.right + 7 : inBand[0]!.rect.left
        const top = Math.min(...inBand.map((entry) => entry.rect.top))
        const bottom = Math.max(...inBand.map((entry) => entry.rect.bottom))
        return { left: x + dx - 2, top: top + dy, width: 4, height: Math.max(bottom - top, 24), orientation: 'vertical' }
      }

      const above = inRegion.filter((entry) => entry.band < target.band)
      const below = inRegion.filter((entry) => entry.band >= target.band)
      const y =
        below.length > 0
          ? Math.min(...below.map((entry) => entry.rect.top)) - 7
          : Math.max(...above.map((entry) => entry.rect.bottom)) + 7
      const left = Math.min(...inRegion.map((entry) => entry.rect.left))
      const right = Math.max(...inRegion.map((entry) => entry.rect.right))
      return { left: left + dx, top: y + dy - 2, width: Math.max(right - left, 24), height: 4, orientation: 'horizontal' }
    },
    []
  )

  const finishDrag = useCallback((commit: boolean) => {
    const state = drag.current
    drag.current = undefined
    if (!state) {
      return
    }
    if (state.frame !== undefined) {
      cancelAnimationFrame(state.frame)
    }
    if (state.node) {
      state.node.style.transform = ''
      state.node.style.willChange = ''
    }
    document.body.classList.remove('is-status-dash-dragging')
    setDraggingId(undefined)
    setIndicator(undefined)
    // Commit the target the operator was LAST SHOWN. Because the drag never
    // reflows the page, a fresh hit-test at release would now agree with it —
    // but honouring the shown target is still the only version that cannot
    // drift, and it costs nothing.
    if (commit && state.target) {
      dropCardRef.current(state.id, state.target)
    }
  }, [])

  const beginDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      const node = (event.currentTarget.closest('[data-status-dash-card]') as HTMLElement | null) ?? undefined
      drag.current = {
        id,
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        geometry: collectGeometry(),
        node,
        frame: undefined,
        // Start on the card's own slot, so a click that never moves is a no-op.
        target: undefined
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic events and exotic pointer devices can refuse capture; the
        // window-level listeners below still track the gesture.
      }
      document.body.classList.add('is-status-dash-dragging')
      setDraggingId(id)
    },
    []
  )

  useEffect(() => {
    if (!draggingId) {
      return
    }

    const render = (): void => {
      const state = drag.current
      if (!state) {
        return
      }
      state.frame = undefined
      // Composited transform: the card follows the pointer without the page
      // laying out even once.
      if (state.node) {
        const dx = state.pointerX - state.originX
        const dy = state.pointerY - state.originY
        state.node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      }
      const target = resolveStatusDashboardDrop(state.geometry, state.pointerX, state.pointerY, state.id)
      const changed =
        JSON.stringify(target ?? null) !== JSON.stringify(state.target ?? null)
      state.target = target
      if (changed) {
        setIndicator(indicatorFor(state, target))
      }
    }

    const schedule = (): void => {
      const state = drag.current
      if (!state || state.frame !== undefined) {
        return
      }
      state.frame = requestAnimationFrame(render)
    }

    const onMove = (event: PointerEvent): void => {
      const state = drag.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }
      event.preventDefault()
      // Only the newest position matters; coalesced intermediate points would
      // just be thrown away by the next frame.
      state.pointerX = event.clientX
      state.pointerY = event.clientY
      schedule()
    }
    const onUp = (event: PointerEvent): void => {
      const state = drag.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }
      state.pointerX = event.clientX
      state.pointerY = event.clientY
      state.target = resolveStatusDashboardDrop(state.geometry, state.pointerX, state.pointerY, state.id)
      finishDrag(true)
    }
    const onCancel = (): void => finishDrag(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        finishDrag(false)
      }
    }
    const onScroll = (): void => schedule()

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
    // Registered once per gesture: the handlers read mutable drag state from a
    // ref, so a changing drop target does not re-subscribe them.
  }, [draggingId, finishDrag, indicatorFor])

  const value = useMemo<DashboardContextValue>(
    () => ({ controller, cardsById, draggingId, beginDrag, resizePreview, setResizePreview }),
    [controller, cardsById, draggingId, beginDrag, resizePreview]
  )

  return (
    <DashboardContext.Provider value={value}>
      {children}
      {indicator ? (
        <div
          className={`status-dash-drop status-dash-drop--${indicator.orientation}`}
          data-testid="status-dash-drop-indicator"
          aria-hidden="true"
          style={{
            left: `${indicator.left}px`,
            top: `${indicator.top}px`,
            width: `${indicator.width}px`,
            height: `${indicator.height}px`
          }}
        />
      ) : null}
    </DashboardContext.Provider>
  )
}

export interface StatusDashboardRegionProps {
  region: StatusDashboardRegionId
  /** The container class the region's element had before the dashboard existed. */
  className: string
  testId?: string
}

/**
 * One region: a 12-column CSS grid with AUTO rows, holding bands of columns.
 *
 * Auto rows are the whole reason this can be free without clipping anything —
 * every card is exactly as tall as its content, decided by the layout engine,
 * and a card that grows a row simply makes its column taller.
 */
export function StatusDashboardRegion({ region, className, testId }: StatusDashboardRegionProps): ReactElement {
  const { controller } = useDashboard()
  const bands = regionBands(controller.layout, region)

  return (
    <div
      className={`${className} status-dash-region${controller.customisable ? ' status-dash-region--live' : ''}`}
      data-status-dash-region={region}
      data-testid={testId ?? `status-dash-region-${region}`}
    >
      {bands.map((band) =>
        band.columns.map((column) => (
          <StatusDashboardColumnView
            key={column.id}
            column={column}
            startLine={columnStartLine(band, column.id)}
            canGrow={bandFreeSpan(band) > 0 || band.columns.length > 1}
            bandIndex={band.band}
          />
        ))
      )}
    </div>
  )
}

interface StatusDashboardColumnViewProps {
  column: StatusDashboardColumn
  startLine: number
  canGrow: boolean
  bandIndex: number
}

function StatusDashboardColumnView({
  column,
  startLine,
  canGrow,
  bandIndex
}: StatusDashboardColumnViewProps): ReactElement {
  const { controller, cardsById } = useDashboard()
  const ids = columnCardIds(controller.layout, column.id)
  const resizeStart = useRef<{ pointerId: number; x: number; span: number; step: number } | undefined>(undefined)

  const onWidthPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const region = event.currentTarget.closest('[data-status-dash-region]')
    const width = region?.getBoundingClientRect().width ?? 0
    const gap = 14
    // One grid column plus its gutter — the distance the pointer must travel
    // to earn one more twelfth.
    const step = Math.max(1, (width - gap * (STATUS_DASHBOARD_GRID_COLUMNS - 1)) / STATUS_DASHBOARD_GRID_COLUMNS + gap)
    resizeStart.current = { pointerId: event.pointerId, x: event.clientX, span: column.span, step }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // See the card resize handle — capture is best-effort.
    }
  }

  const onWidthPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = resizeStart.current
    if (!start || start.pointerId !== event.pointerId) {
      return
    }
    // Snapping to a whole twelfth is also the throttle: the layout changes at
    // most eleven times across the whole gesture, however fast the pointer moves.
    const next = start.span + Math.round((event.clientX - start.x) / start.step)
    if (next !== column.span) {
      controller.resizeColumn(column.id, next)
    }
  }

  const endWidthResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (resizeStart.current?.pointerId === event.pointerId) {
      resizeStart.current = undefined
    }
  }

  const onWidthKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    controller.resizeColumn(column.id, column.span + (event.key === 'ArrowLeft' ? -1 : 1))
  }

  const style: CSSProperties = {
    gridColumn: `${startLine} / span ${column.span}`,
    gridRow: bandIndex + 1
  }

  // The sensor shelf answers to `setup-sensor-group`, the name tests have
  // reached for since before the dashboard existed. A column that minted a new
  // name and quietly broke those tests would be worse than one special case.
  const testId = column.id === 'sensors' ? 'setup-sensor-group' : `status-dash-col-${column.id}`

  // A shelf column keeps the `setup-status-sensors` class it always had: the
  // GPS map's whole `@container` compaction ruleset is scoped under it,
  // including the `> .status-dash-card` rule that puts `container-type` on the
  // WRAPPER — the card is one level too deep for `>` once the dashboard wraps
  // it. Dropping the class here would silently kill the compaction, and the
  // GPS card would render its full-size map inside a 276px column.
  return (
    <div
      className={`status-dash-col status-dash-col--${column.flow}${
        column.flow === 'shelf' ? ' setup-status-sensors' : ''
      }${ids.length === 0 ? ' status-dash-col--empty' : ''}`}
      style={style}
      data-status-dash-col={column.id}
      data-status-dash-col-region={column.region}
      data-status-dash-col-band={column.band}
      data-status-dash-col-span={column.span}
      data-testid={testId}
    >
      {ids.map((id) => {
        const card = cardsById.get(id)
        return card ? <StatusDashboardCard key={id} entry={card} columnSpan={column.span} /> : null
      })}
      {controller.customisable ? (
        <div className="status-dash-col__chrome">
          <button
            type="button"
            className="status-dash-col__flow"
            data-testid={`status-dash-flow-${column.id}`}
            aria-label={`${column.flow === 'stack' ? 'Lay this column out side by side' : 'Stack this column top to bottom'}`}
            title={column.flow === 'stack' ? 'Side by side' : 'Stack'}
            onClick={() => controller.toggleColumnFlow(column.id)}
          >
            <span aria-hidden="true">{column.flow === 'stack' ? '⇄' : '⇅'}</span>
          </button>
          <button
            type="button"
            className="status-dash-col__width"
            data-testid={`status-dash-width-${column.id}`}
            aria-label={`Column width, currently ${column.span} of ${STATUS_DASHBOARD_GRID_COLUMNS}. Drag, or use the left and right arrow keys.`}
            title={`Drag to set the column width (${column.span}/${STATUS_DASHBOARD_GRID_COLUMNS})`}
            aria-valuenow={column.span}
            aria-valuemin={1}
            aria-valuemax={STATUS_DASHBOARD_GRID_COLUMNS}
            role="slider"
            onPointerDown={onWidthPointerDown}
            onPointerMove={onWidthPointerMove}
            onPointerUp={endWidthResize}
            onPointerCancel={endWidthResize}
            onKeyDown={onWidthKeyDown}
            disabled={!canGrow && column.span === STATUS_DASHBOARD_GRID_COLUMNS}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface StatusDashboardCardProps {
  entry: StatusDashboardCardEntry
  /** Its column's width, announced on the handle so width is discoverable. */
  columnSpan: number
}

function StatusDashboardCard({ entry, columnSpan }: StatusDashboardCardProps): ReactElement {
  const { controller, draggingId, beginDrag, resizePreview, setResizePreview } = useDashboard()
  const { customisable } = controller
  const contentRef = useRef<HTMLDivElement | null>(null)
  const resizeStart = useRef<{ pointerId: number; y: number; rows: number } | undefined>(undefined)

  const placement = findPlacement(controller.layout, entry.id)
  const previewRows = resizePreview?.id === entry.id ? resizePreview.rows : undefined
  const rows = previewRows ?? placement?.heightRows
  const isDragging = draggingId === entry.id

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const measured = contentRef.current?.getBoundingClientRect().height ?? 0
    resizeStart.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      rows: rows ?? Math.max(STATUS_DASHBOARD_MIN_ROWS, Math.round(measured / STATUS_DASHBOARD_ROW_PX))
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some input paths (synthetic events, exotic pointer devices) refuse
      // capture. The resize still tracks; it just stops if the pointer leaves.
    }
    setResizePreview({ id: entry.id, rows: resizeStart.current.rows })
  }

  const onResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = resizeStart.current
    if (!start || start.pointerId !== event.pointerId) {
      return
    }
    const next = start.rows + (event.clientY - start.y) / STATUS_DASHBOARD_ROW_PX
    setResizePreview({ id: entry.id, rows: Math.round(next) })
  }

  const endResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = resizeStart.current
    if (!start || start.pointerId !== event.pointerId) {
      return
    }
    resizeStart.current = undefined
    const committed = resizePreview?.id === entry.id ? resizePreview.rows : start.rows
    setResizePreview(undefined)
    controller.resizeCard(entry.id, committed)
  }

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    // The keyboard path. Drag-only rearranging is unusable without a pointer,
    // so the handle is a real button: up/down reorders inside the column,
    // left/right walks the card across every column in visual order — bands
    // and the sidebar included — and shift+left/right changes the width of the
    // column it is in, which is the keyboard equivalent of the width handle.
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    if (!handled) {
      return
    }
    event.preventDefault()
    if (event.key === 'ArrowUp') {
      controller.nudgeCard(entry.id, -1)
    } else if (event.key === 'ArrowDown') {
      controller.nudgeCard(entry.id, 1)
    } else if (event.shiftKey) {
      controller.nudgeCardWidth(entry.id, event.key === 'ArrowLeft' ? -1 : 1)
    } else {
      controller.shiftCardColumn(entry.id, event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const measured = contentRef.current?.getBoundingClientRect().height ?? 0
      const current = rows ?? Math.round(measured / STATUS_DASHBOARD_ROW_PX)
      controller.resizeCard(entry.id, current + (event.key === 'ArrowUp' ? -1 : 1))
    } else if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      controller.resizeCard(entry.id, undefined)
    }
  }

  const style =
    rows === undefined ? undefined : { ['--status-dash-height' as string]: `${rows * STATUS_DASHBOARD_ROW_PX}px` }

  return (
    <div
      className={`status-dash-card${isDragging ? ' is-dragging' : ''}${rows === undefined ? '' : ' is-capped'}`}
      data-status-dash-card={entry.id}
      data-testid={`status-dash-card-${entry.id}`}
      style={style}
    >
      <div className="status-dash-card__content" ref={contentRef}>
        {entry.node}
      </div>
      {customisable ? (
        <>
          <button
            type="button"
            className="status-dash-card__handle"
            data-testid={`status-dash-handle-${entry.id}`}
            aria-label={`Move ${entry.label} card. Its column is ${columnSpan} of ${STATUS_DASHBOARD_GRID_COLUMNS} wide. Drag it anywhere, or use the arrow keys to move it up, down, or into the next column — hold shift with left and right to change the column width.`}
            title={`Drag to move ${entry.label} — or focus and use the arrow keys`}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return
              }
              event.preventDefault()
              beginDrag(entry.id, event)
            }}
            onKeyDown={onHandleKeyDown}
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <button
            type="button"
            className="status-dash-card__resize"
            data-testid={`status-dash-resize-${entry.id}`}
            aria-label={`Resize ${entry.label} card height. Drag, use the up and down arrow keys, or press Escape to fit the content.`}
            title="Drag to set the card height — double-click to fit the content"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={() => controller.resizeCard(entry.id, undefined)}
            onKeyDown={onResizeKeyDown}
          >
            <span aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  )
}
