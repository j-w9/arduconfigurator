// "Set location (no GPS)" control for the Compass calibration card. Compass
// calibration requires the EKF to have a position (to complete yaw alignment),
// which normally needs a GPS fix. This control streams a synthetic GPS
// (GPS_INPUT) at an operator-picked location so the cal can run with no
// physical GPS: pick a point on the map, Start fake GPS, run the compass cal,
// then Stop (which restores the GPS backend type). Validated against SITL.

import { useState } from 'react'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { MapLocationPicker } from '../views/MapLocationPicker'

export interface CalibrationLocationButtonProps {
  snapshot: ConfiguratorSnapshot
  runtime: ArduPilotConfiguratorRuntime
}

export function CalibrationLocationButton({ snapshot, runtime }: CalibrationLocationButtonProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [latitude, setLatitude] = useState<number | undefined>(undefined)
  const [longitude, setLongitude] = useState<number | undefined>(undefined)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'neutral'; text: string } | undefined>(undefined)

  const connected = snapshot.connection.kind === 'connected'
  const hasPoint = latitude !== undefined && longitude !== undefined
  const canStart = connected && hasPoint && !busy && !active

  function handleUseMyLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice({ tone: 'danger', text: 'This browser does not expose a geolocation API.' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(Number(pos.coords.latitude.toFixed(6)))
        setLongitude(Number(pos.coords.longitude.toFixed(6)))
      },
      (error) => setNotice({ tone: 'danger', text: `Location unavailable: ${error.message}` }),
      { enableHighAccuracy: false, timeout: 10000 }
    )
  }

  function handleStart(): void {
    if (latitude === undefined || longitude === undefined) {
      return
    }
    setBusy(true)
    setNotice(undefined)
    void (async () => {
      try {
        await runtime.startFakeGps(latitude, longitude)
        setActive(true)
        setModalOpen(false)
        setNotice({
          tone: 'success',
          text: `Fake GPS streaming at ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Wait a few seconds for EKF alignment, run the compass calibration above, then Stop fake GPS.`
        })
      } catch (error) {
        setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to start fake GPS.' })
      } finally {
        setBusy(false)
      }
    })()
  }

  function handleStop(): void {
    setBusy(true)
    void (async () => {
      try {
        await runtime.stopFakeGps()
        setActive(false)
        setNotice({ tone: 'neutral', text: 'Fake GPS stopped; GPS backend restored.' })
      } catch (error) {
        setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to stop fake GPS.' })
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="cal-location">
      <div className="cal-location__actions">
        {active ? (
          <>
            <button
              type="button"
              style={buttonStyle('secondary')}
              data-testid="cal-location-stop"
              disabled={busy}
              onClick={handleStop}
            >
              {busy ? 'Stopping…' : 'Stop fake GPS'}
            </button>
            <StatusBadge tone="warning">
              {`fake GPS active${hasPoint ? ` · ${latitude!.toFixed(3)}, ${longitude!.toFixed(3)}` : ''}`}
            </StatusBadge>
          </>
        ) : (
          <>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="cal-location-open"
              onClick={() => setModalOpen(true)}
            >
              Set location (no GPS)
            </button>
            <button
              type="button"
              className="cal-location__info-button"
              aria-label="How this works"
              aria-expanded={infoOpen}
              title="How this works"
              data-testid="cal-location-info-button"
              onClick={() => setInfoOpen((open) => !open)}
            >
              i
            </button>
          </>
        )}
      </div>

      {infoOpen && !active ? (
        <div className="cal-location__info" role="note" data-testid="cal-location-info">
          <p>
            Compass calibration needs the EKF to have a position (to finish yaw alignment), which
            normally requires a GPS fix. This streams a <strong>synthetic GPS</strong> at a location
            you pick so the cal can run with <strong>no physical GPS</strong>.
          </p>
          <p>
            It temporarily switches the GPS backend to "MAV" and restores it when you Stop. Pick a
            point, Start fake GPS, wait a few seconds, then run the compass calibration above.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p className={`cal-location__notice cal-location__notice--${notice.tone}`} data-testid="cal-location-notice">
          {notice.text}
        </p>
      ) : null}

      {modalOpen ? (
        <div
          className="board-media-lightbox"
          role="dialog"
          aria-modal="true"
          data-testid="cal-location-modal"
          onClick={() => setModalOpen(false)}
        >
          <div className="board-media-lightbox__frame cal-location__frame" onClick={(event) => event.stopPropagation()}>
            <header className="cal-location__modal-header">
              <div>
                <strong>Pick calibration location</strong>
                <p>Click the map, enter coordinates, or use your device location — then start the fake GPS.</p>
              </div>
              <button type="button" style={buttonStyle()} onClick={() => setModalOpen(false)} data-testid="cal-location-close">
                Close
              </button>
            </header>

            <MapLocationPicker
              latitude={latitude}
              longitude={longitude}
              onPick={(lat, lon) => {
                setLatitude(lat)
                setLongitude(lon)
              }}
            />

            <div className="cal-location__fields">
              <label className="scoped-editor-field scoped-editor-field--compact">
                <span>Latitude</span>
                <input
                  type="number"
                  step="0.000001"
                  min="-90"
                  max="90"
                  inputMode="decimal"
                  value={latitude ?? ''}
                  data-testid="cal-location-lat-input"
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value)
                    setLatitude(Number.isFinite(value) ? value : undefined)
                  }}
                />
              </label>
              <label className="scoped-editor-field scoped-editor-field--compact">
                <span>Longitude</span>
                <input
                  type="number"
                  step="0.000001"
                  min="-180"
                  max="180"
                  inputMode="decimal"
                  value={longitude ?? ''}
                  data-testid="cal-location-lon-input"
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value)
                    setLongitude(Number.isFinite(value) ? value : undefined)
                  }}
                />
              </label>
              <button
                type="button"
                style={buttonStyle()}
                data-testid="cal-location-use-my-location"
                onClick={handleUseMyLocation}
              >
                Use my location
              </button>
            </div>

            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="cal-location-start"
              disabled={!canStart}
              onClick={handleStart}
            >
              {busy ? 'Starting…' : 'Start fake GPS'}
            </button>

            {!connected ? <p className="calibration-card__blocked">Connect to a vehicle first.</p> : null}
            {notice ? (
              <p className={`cal-location__notice cal-location__notice--${notice.tone}`}>{notice.text}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
