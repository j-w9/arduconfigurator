// The plot workspace CAN ▸ Plot and the MAVLink Inspector share: a toolbar
// (window, Pause / Resume, Overlay all / Split all, layouts, export, clear),
// the charts, and a side panel of tabs to add things from (fields, graphs,
// frame bytes). Presentational: each surface brings its own series, side
// tabs and layout storage.

import { useState, type ReactNode } from 'react'

import { InfoDot } from '../views/InfoDot'
import { PlotPanes, type PlotPanesProps } from './PlotPanes'

export interface PlotSideTab {
  id: string
  label: string
  content: ReactNode
}

export interface PlotWorkspaceProps extends Omit<PlotPanesProps, 'testIdPrefix'> {
  title: string
  info: ReactNode
  windows: readonly { seconds: number; label: string }[]
  windowSeconds: number
  onWindow: (seconds: number) => void
  paused: boolean
  onTogglePause: () => void
  /** Every series key, in order (for Overlay all). */
  seriesKeys: readonly string[]
  onOverlayAll: () => void
  onSplitAll: () => void
  layouts: readonly string[]
  onSaveLayout: (name: string) => void
  onOpenLayout: (name: string) => void
  onDeleteLayout: (name: string) => void
  onExportCsv: () => void
  onClear: () => void
  side: readonly PlotSideTab[]
  /** Surface-specific toolbar controls (CAN: node-message markers). */
  tools?: ReactNode
  /** Shown instead of the charts when nothing is plotted. */
  empty: ReactNode
  testIdPrefix: string
}

export function PlotWorkspace(props: PlotWorkspaceProps): ReactNode {
  const { testIdPrefix: id, panes, seriesKeys } = props
  const [sideTab, setSideTab] = useState(props.side[0]?.id)
  const [layoutName, setLayoutName] = useState('')
  const [showStats, setShowStats] = useState(false)
  const activeSide = props.side.find((tab) => tab.id === sideTab) ?? props.side[0]
  const nothing = seriesKeys.length === 0

  return (
    <section className="plot-workspace" data-testid={id}>
      <header className="plot-workspace__bar">
        <h3>
          {props.title}
          <InfoDot label={`About ${props.title}`} wide>
            {props.info}
          </InfoDot>
        </h3>
        <div className="can-monitor__segmented" role="radiogroup" aria-label="Time window">
          {props.windows.map((option) => (
            <button
              key={option.seconds}
              type="button"
              role="radio"
              aria-checked={props.windowSeconds === option.seconds}
              className={props.windowSeconds === option.seconds ? 'is-active' : undefined}
              onClick={() => props.onWindow(option.seconds)}
              data-testid={`${id}-window-${option.seconds * 1000}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          // Same grammar as Frames: red Pause stops the charts, green Resume runs them again.
          className={`can-monitor__tool ${props.paused ? 'can-monitor__tool--resume' : 'can-monitor__tool--pause'}`}
          onClick={props.onTogglePause}
          aria-pressed={props.paused}
          disabled={nothing}
          title={props.paused ? undefined : 'Pause, then drag across a chart to zoom'}
          data-testid={`${id}-freeze`}
        >
          {props.paused ? 'Resume' : 'Pause'}
        </button>
        <span className="plot-workspace__divider" aria-hidden="true" />
        <button type="button" className="can-monitor__tool" onClick={props.onOverlayAll} disabled={panes.length < 2} title="Every series on one chart" data-testid={`${id}-overlay-all`}>
          Overlay all
        </button>
        <button type="button" className="can-monitor__tool" onClick={props.onSplitAll} disabled={panes.length === seriesKeys.length} title="A chart per series" data-testid={`${id}-split-all`}>
          Split all
        </button>
        <button
          type="button"
          className={`can-monitor__tool${showStats ? ' is-active' : ''}`}
          onClick={() => setShowStats((current) => !current)}
          aria-pressed={showStats}
          disabled={nothing}
          title="Min, max, mean and rate of each line over what is in view (the window, or the zoom)"
          data-testid={`${id}-stats`}
        >
          Stats
        </button>
        {props.tools}
        <span className="plot-workspace__spacer" />
        <form
          className="plot-workspace__layout"
          onSubmit={(event) => {
            event.preventDefault()
            if (!layoutName.trim()) return
            props.onSaveLayout(layoutName.trim())
            setLayoutName('')
          }}
        >
          <input value={layoutName} onChange={(event) => setLayoutName(event.target.value)} placeholder="Name this layout" aria-label="Layout name" data-testid={`${id}-layout-name`} />
          <button type="submit" className="can-monitor__tool" disabled={!layoutName.trim() || nothing} data-testid={`${id}-layout-save`}>
            Save
          </button>
          {props.layouts.length > 0 ? (
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value
                if (value.startsWith('open:')) props.onOpenLayout(value.slice(5))
                if (value.startsWith('delete:')) props.onDeleteLayout(value.slice(7))
              }}
              aria-label="Saved layouts"
              data-testid={`${id}-layouts`}
            >
              <option value="">Layouts ({props.layouts.length})</option>
              <optgroup label="Open">
                {props.layouts.map((name) => (
                  <option key={name} value={`open:${name}`}>
                    {name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Delete">
                {props.layouts.map((name) => (
                  <option key={name} value={`delete:${name}`}>
                    Delete {name}
                  </option>
                ))}
              </optgroup>
            </select>
          ) : null}
        </form>
        <button type="button" className="can-monitor__tool" onClick={props.onExportCsv} disabled={nothing} data-testid={`${id}-export`}>
          Export CSV
        </button>
        <button type="button" className="can-monitor__tool" onClick={props.onClear} disabled={nothing}>
          Clear all
        </button>
      </header>

      <div className="plot-workspace__body">
        <div className="plot-workspace__charts">
          {nothing ? (
            <div className="plot-workspace__empty" data-testid={`${id}-empty`}>
              {props.empty}
            </div>
          ) : (
            <PlotPanes
              panes={panes}
              syncKey={props.syncKey}
              xRange={props.xRange}
              onXRangeChange={props.onXRangeChange}
              xFormat={props.xFormat}
              onMoveSeries={props.onMoveSeries}
              onPaneHeight={props.onPaneHeight}
              onDropPayload={props.onDropPayload}
              markers={props.markers}
              bands={props.bands}
              showStats={showStats}
              testIdPrefix={id}
            />
          )}
        </div>
        <aside className="plot-workspace__side">
          {props.side.length > 1 ? (
            <div className="plot-workspace__tabs" role="tablist">
              {props.side.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSide?.id === tab.id}
                  className={activeSide?.id === tab.id ? 'is-active' : undefined}
                  onClick={() => setSideTab(tab.id)}
                  data-testid={`${id}-side-${tab.id}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="plot-workspace__side-body">{activeSide?.content}</div>
        </aside>
      </div>
    </section>
  )
}
