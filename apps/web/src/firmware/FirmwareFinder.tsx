// Find firmware: search ArduPilot's published builds by board, brand or board
// id, and load one straight into the flasher. Connected, it lists the board's
// own variants with the build it is running pre-selected.
//
// The builds come from the private deploy's index (/fw/index.json) and relay
// (/fw/apj): firmware.ardupilot.org sends no CORS headers, so the browser
// cannot read it directly. The loaded image still goes through the flasher's
// board and flash-size checks before anything is written.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'
import { formatBoardId } from '@arduconfig/firmware-flash'

import {
  FINDER_CHANNELS,
  FINDER_VEHICLES,
  autoSelectTarget,
  defaultFinderVehicle,
  findFirmwareTargets,
  targetWarning,
  type ConnectedBoard,
  type FinderVehicle,
  type FirmwareChannel,
  type FirmwareIndexRow,
  type FirmwareTarget,
  firmwareBuildKey
} from '../view-models/firmware-finder'

export interface FirmwareFinderProps {
  rows: readonly FirmwareIndexRow[]
  /** The connected flight controller, when there is one. */
  board?: ConnectedBoard
  /** "ArduCopter", "ArduPlane", ... for the Vehicle default. */
  connectedVehicle?: string
  /** Download the target and hand it to the flasher. */
  onLoad: (target: FirmwareTarget) => Promise<void>
  /** The build now loaded in the flasher from here (firmwareBuildKey), if any. */
  loadedBuild?: string
  disabled?: boolean
}

export function FirmwareFinder({ rows, board, connectedVehicle, onLoad, loadedBuild, disabled }: FirmwareFinderProps): ReactNode {
  const [vehicle, setVehicle] = useState<FinderVehicle>(() => defaultFinderVehicle(connectedVehicle))
  const [channel, setChannel] = useState<FirmwareChannel>('OFFICIAL')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => setVehicle(defaultFinderVehicle(connectedVehicle)), [connectedVehicle])

  const targets = useMemo(() => findFirmwareTargets(rows, { vehicle, channel, query, board }), [rows, vehicle, channel, query, board])
  const target = targets.find((entry) => entry.platform === selected)

  // Pre-select the running build (or the board's only variant) whenever the
  // list changes and nothing in it is picked.
  useEffect(() => {
    if (target) return
    setSelected(autoSelectTarget(targets)?.platform)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets])

  const warning = target ? targetWarning(target, board) : undefined
  const channelLabel = FINDER_CHANNELS.find((entry) => entry.id === channel)?.label ?? channel

  return (
    <section className="firmware-finder" data-testid="firmware-finder">
      <div className="firmware-finder__controls">
        <label className="firmware-finder__search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Board, brand or board id: MatekH743, Kakute, 1013"
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            data-testid="firmware-finder-search"
          />
        </label>
        <label>
          <span>Vehicle</span>
          <select value={vehicle} onChange={(event) => setVehicle(event.target.value as FinderVehicle)} data-testid="firmware-finder-vehicle">
            {FINDER_VEHICLES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Release</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value as FirmwareChannel)} data-testid="firmware-finder-channel">
            {FINDER_CHANNELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {board?.boardId !== undefined ? (
        <p className="firmware-finder__board" data-testid="firmware-finder-board">
          Connected: <strong>{board.boardName ?? formatBoardId(board.boardId)}</strong> (board id {board.boardId}). Its builds are at the top
          of the list.
        </p>
      ) : null}

      {targets.length === 0 ? (
        <p className="firmware-finder__empty" data-testid="firmware-finder-empty">
          No {vehicle} {channelLabel.toLowerCase()} build matches "{query.trim()}".
        </p>
      ) : (
        <label className="firmware-finder__board-pick">
          <span>Board</span>
          <select
            value={target ? target.platform : ''}
            onChange={(event) => setSelected(event.target.value || undefined)}
            data-testid="firmware-finder-board-select"
          >
            <option value="">
              {query.trim() === '' ? `Choose a board (${targets.length})…` : `Choose one of ${targets.length} matches…`}
            </option>
            {targets.map((entry) => (
              <option key={entry.platform} value={entry.platform}>
                {entry.platform}
                {entry.brand && entry.brand !== entry.platform ? ` · ${entry.brand}` : ''}
                {entry.running ? ' · running now' : entry.sameBoard ? ' · this board' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {target ? (
        <p className="firmware-finder__detail" data-testid="firmware-finder-detail">
          {target.brand || target.manufacturer || formatBoardId(target.boardId)} · board id {target.boardId} · {target.version}
          {target.running ? <span className="firmware-finder__tag firmware-finder__tag--running">running now</span> : null}
        </p>
      ) : null}

      {target ? (
        <div className="firmware-finder__pick">
          {warning ? (
            <p className="firmware-finder__warning" data-testid="firmware-finder-warning">
              {warning}
            </p>
          ) : null}
          {target && loadedBuild === firmwareBuildKey(target) ? (
            // Loaded: nothing more to do here -- step 2 takes it from here.
            <button type="button" className="firmware-finder__done" disabled data-testid="firmware-finder-load">
              ✓ Downloaded {target.platform} {target.version}
            </button>
          ) : (
            <button
              type="button"
              style={buttonStyle('primary')}
              disabled={disabled || busy}
              onClick={async () => {
                setBusy(true)
                setError(undefined)
                try {
                  await onLoad(target)
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : String(caught))
                } finally {
                  setBusy(false)
                }
              }}
              data-testid="firmware-finder-load"
            >
              {busy ? 'Downloading…' : `Download ${target.platform} ${target.version}`}
            </button>
          )}
          {error ? (
            <p className="firmware-finder__error" data-testid="firmware-finder-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
