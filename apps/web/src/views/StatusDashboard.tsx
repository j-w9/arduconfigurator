// The drag-and-resize chrome for the Status & Info page.
//
// This is chrome ONLY. Every card it renders is passed in already built by
// App.tsx and is handed through untouched — no card knows it lives in a
// dashboard, so the sensor-availability gate, the telemetry requests and every
// value on the page behave exactly as they did before.
//
// LIBRARY vs HAND-ROLLED. react-grid-layout (MIT, which is GPL-3.0 compatible,
// so licensing was not the deciding factor) solves free 2-D placement by
// absolutely positioning every card at an explicit pixel size. That is the
// wrong shape for this page twice over: the Status cards are natural-height
// (a pre-arm card grows with the number of issues), and free placement is
// exactly what lets a user produce the broken-looking, hole-riddled page we
// have to avoid. The model here — named zones, order within a zone, optional
// height cap — cannot overlap, cannot leave a hole, needs no collision solver,
// and is ~250 lines of pointer handling. So: hand-rolled, no dependency added.
//
// Pointer events, not HTML5 drag-and-drop: HTML5 DnD has no touch story, no
// keyboard story, and drags a browser-drawn ghost we cannot style.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'

import type { StatusDashboardLayoutController } from '../hooks/use-status-dashboard-layout'
import {
  STATUS_DASHBOARD_MIN_ROWS,
  STATUS_DASHBOARD_ROW_PX,
  STATUS_DASHBOARD_ZONE_LABELS,
  findPlacement,
  isStatusDashboardZoneId,
  zoneCardIds,
  type StatusDashboardZoneId
} from '../view-models/status-dashboard-layout'

/** One card as the dashboard sees it: an id, a name for screen readers, a node. */
export interface StatusDashboardCardEntry {
  id: string
  label: string
  node: ReactNode
}

interface DragState {
  id: string
  pointerId: number
  zone: StatusDashboardZoneId
  index: number
}

interface DashboardContextValue {
  controller: StatusDashboardLayoutController
  cardsById: Map<string, StatusDashboardCardEntry>
  drag: DragState | undefined
  beginDrag: (id: string, pointerId: number, zone: StatusDashboardZoneId, index: number) => void
  resizePreview: { id: string; rows: number } | undefined
  setResizePreview: (preview: { id: string; rows: number } | undefined) => void
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined)

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
  const [drag, setDrag] = useState<DragState | undefined>(undefined)
  const [resizePreview, setResizePreview] = useState<{ id: string; rows: number } | undefined>(undefined)
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  const { moveCard } = controller
  const layout = controller.layout

  // Start with the card's own slot as the "drop target" so nothing jumps before
  // the pointer has actually moved anywhere.
  const beginDrag = useCallback(
    (id: string, pointerId: number, zone: StatusDashboardZoneId, index: number) => {
      setDrag({ id, pointerId, zone, index })
    },
    []
  )

  // Resolve where the pointer currently is: which zone, and which slot in it.
  // Computed against the zone list with the dragged card already removed, so
  // the index we hand to `moveCard` is the final index.
  const resolveDropTarget = useCallback(
    (id: string, clientX: number, clientY: number): { zone: StatusDashboardZoneId; index: number } | undefined => {
      const element = document.elementFromPoint(clientX, clientY)
      if (!element) {
        return undefined
      }
      const zoneElement = element.closest('[data-status-dash-zone]')
      const zoneId = zoneElement?.getAttribute('data-status-dash-zone')
      if (!isStatusDashboardZoneId(zoneId)) {
        return undefined
      }
      const remaining = zoneCardIds(layout, zoneId).filter((cardId) => cardId !== id)
      const cardElement = element.closest('[data-status-dash-card]')
      const cardId = cardElement?.getAttribute('data-status-dash-card')
      if (cardElement && cardId && cardId !== id) {
        const position = remaining.indexOf(cardId)
        if (position >= 0) {
          const rect = cardElement.getBoundingClientRect()
          return { zone: zoneId, index: clientY < rect.top + rect.height / 2 ? position : position + 1 }
        }
      }
      // Empty space in the zone: land at the end (or the start, if the pointer
      // is above every card in it).
      const firstCard = zoneElement?.querySelector('[data-status-dash-card]')
      if (firstCard && clientY < firstCard.getBoundingClientRect().top) {
        return { zone: zoneId, index: 0 }
      }
      return { zone: zoneId, index: remaining.length }
    },
    [layout]
  )

  useEffect(() => {
    if (!drag) {
      return
    }
    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== drag.pointerId) {
        return
      }
      event.preventDefault()
      const target = resolveDropTarget(drag.id, event.clientX, event.clientY)
      if (!target) {
        return
      }
      setDrag((current) =>
        current && (current.zone !== target.zone || current.index !== target.index)
          ? { ...current, ...target }
          : current
      )
    }
    const onUp = (event: PointerEvent): void => {
      if (event.pointerId !== drag.pointerId) {
        return
      }
      // Commit the slot the operator was LAST SHOWN, not a fresh hit-test of the
      // release coordinates. Re-resolving here looks equivalent and is not: the
      // drop indicator is a real element, so inserting it reflows the target
      // zone and pushes the cards below it down — measured at 56px dropping GPS
      // onto Pre-arm. That slides the zone the pointer is over out from under a
      // pointer that never moved, and the release then hit-tests a DIFFERENT
      // zone than the indicator was promising. The card landed back in the
      // sensor row while the line said column 1.
      //
      // `drag` is the state that rendered the indicator (the effect re-subscribes
      // whenever it changes), so honouring it makes the drop land exactly where
      // the line was. A drag that never moved still carries the card's own slot
      // from `beginDrag`, which `moveStatusDashboardCard` recognises as a no-op.
      moveCard(drag.id, drag.zone, drag.index)
      setDrag(undefined)
    }
    const onCancel = (): void => setDrag(undefined)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDrag(undefined)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    document.body.classList.add('is-status-dash-dragging')
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('is-status-dash-dragging')
    }
  }, [drag, moveCard, resolveDropTarget])

  const value = useMemo<DashboardContextValue>(
    () => ({ controller, cardsById, drag, beginDrag, resizePreview, setResizePreview }),
    [controller, cardsById, drag, beginDrag, resizePreview]
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export interface StatusDashboardZoneProps {
  zone: StatusDashboardZoneId
  /** The existing container class, so the zone keeps the layout it always had. */
  className: string
  /**
   * The container's existing `data-testid`, where it had one. A zone replaces a
   * plain `<div>` that tests already reach for by name — the sensor row is
   * asserted on as `setup-sensor-group` — so the zone has to answer to that name
   * rather than mint a new one and quietly break those tests.
   */
  testId?: string
  children?: ReactNode
}

/**
 * A drop zone. It renders whichever cards the layout currently assigns to it,
 * in layout order, and keeps the class name the container always had — the
 * default arrangement is therefore pixel-identical to the page without this
 * feature.
 */
export function StatusDashboardZone({ zone, className, testId, children }: StatusDashboardZoneProps): ReactElement {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('StatusDashboardZone must be rendered inside StatusDashboardProvider')
  }
  const { controller, cardsById, drag } = context
  const ids = zoneCardIds(controller.layout, zone)
  const isDropTarget = drag?.zone === zone

  // The dragged card stays MOUNTED (ghosted) rather than being pulled out of
  // the tree: several cards own expensive children — the GPS card hosts a
  // Leaflet map — and unmounting them mid-drag would tear the map down and
  // rebuild it on every drop. `slot` counts only the cards that are not being
  // dragged, which is the index space `moveCard` expects.
  const rendered: ReactNode[] = []
  let slot = 0
  for (const id of ids) {
    const dragged = drag?.id === id
    if (!dragged) {
      if (isDropTarget && drag && drag.index === slot) {
        rendered.push(<div key={`drop:${slot}`} className="status-dash-drop" aria-hidden="true" />)
      }
      slot += 1
    }
    const card = cardsById.get(id)
    if (card) {
      rendered.push(<StatusDashboardCard key={id} entry={card} zone={zone} index={ids.indexOf(id)} />)
    }
  }
  if (isDropTarget && drag && drag.index >= slot) {
    rendered.push(<div key="drop:end" className="status-dash-drop" aria-hidden="true" />)
  }

  return (
    <div
      className={`${className} status-dash-zone${
        controller.customisable ? ' status-dash-zone--live' : ''
      }${drag ? ' status-dash-zone--armed' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-status-dash-zone={zone}
      data-testid={testId ?? `status-dash-zone-${zone}`}
    >
      {rendered}
      {children}
    </div>
  )
}

interface StatusDashboardCardProps {
  entry: StatusDashboardCardEntry
  zone: StatusDashboardZoneId
  index: number
}

function StatusDashboardCard({ entry, zone, index }: StatusDashboardCardProps): ReactElement {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('StatusDashboardCard must be rendered inside StatusDashboardProvider')
  }
  const { controller, drag, beginDrag, resizePreview, setResizePreview } = context
  const { customisable } = controller
  const contentRef = useRef<HTMLDivElement | null>(null)
  const resizeStart = useRef<{ pointerId: number; y: number; rows: number } | undefined>(undefined)

  const placement = findPlacement(controller.layout, entry.id)
  const previewRows = resizePreview?.id === entry.id ? resizePreview.rows : undefined
  const rows = previewRows ?? placement?.heightRows
  const isDragging = drag?.id === entry.id

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
    // The keyboard path. Drag-only reordering is unusable without a pointer, so
    // the handle is a real button: up/down reorders inside the column, left/
    // right walks the card across columns.
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    if (!handled) {
      return
    }
    event.preventDefault()
    if (event.key === 'ArrowUp') {
      controller.nudgeCard(entry.id, -1)
    } else if (event.key === 'ArrowDown') {
      controller.nudgeCard(entry.id, 1)
    } else if (event.key === 'ArrowLeft') {
      controller.shiftCardZone(entry.id, -1)
    } else {
      controller.shiftCardZone(entry.id, 1)
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

  const style = rows === undefined ? undefined : { ['--status-dash-height' as string]: `${rows * STATUS_DASHBOARD_ROW_PX}px` }

  return (
    <div
      className={`status-dash-card${isDragging ? ' is-dragging' : ''}${
        rows === undefined ? '' : ' is-capped'
      }`}
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
            aria-label={`Move ${entry.label} card. Currently in ${STATUS_DASHBOARD_ZONE_LABELS[zone]}. Drag, or use the arrow keys to move it up, down, left or right.`}
            title={`Drag to move ${entry.label} — or focus and use the arrow keys`}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return
              }
              event.preventDefault()
              beginDrag(entry.id, event.pointerId, zone, index)
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
