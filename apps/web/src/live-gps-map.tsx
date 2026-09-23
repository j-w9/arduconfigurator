import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge } from '@arduconfig/ui-kit'

interface LiveGpsMapCardProps {
  snapshot: ConfiguratorSnapshot
  title: string
  subtitle: string
  compact?: boolean
  testId?: string
}

interface StableMapFocus {
  latitudeDeg: number
  longitudeDeg: number
}

// 6 m was 18 m. The original guard kept the OSM iframe from reloading on
// sub-meter GPS drift, but with the new 5 Hz GLOBAL_POSITION_INT cadence
// (see LIVE_TELEMETRY_REQUESTS) operators watching a Here3 said the map
// looked "stuck" for too long when actually moving. 6 m is small enough
// that walking-pace movement re-centers reasonably, large enough that
// the iframe doesn't thrash on stationary GPS jitter (typical drift on a
// good fix is well under that).
const MAP_RECENTER_THRESHOLD_METERS = 6

function formatCoordinate(value: number | undefined, positiveLabel: string, negativeLabel: string): string {
  if (value === undefined) {
    return 'Unknown'
  }

  const hemisphere = value >= 0 ? positiveLabel : negativeLabel
  return `${Math.abs(value).toFixed(5)}° ${hemisphere}`
}

/**
 * The live position, drawn on tiles from this origin.
 *
 * This replaced an <iframe> to openstreetmap.org. Cross-origin isolation --
 * which the WebAssembly simulator needs, because ArduPilot's main loop runs on
 * a worker and that needs SharedArrayBuffer -- blocks a cross-origin frame
 * outright, and there is no header OSM could send that would help.
 *
 * Leaflet was already here for the calibration map picker, so this is one
 * fewer third-party embed rather than a new dependency, and the map no longer
 * reloads wholesale every time the position nudges.
 */
function LiveGpsLeafletMap({
  latitude,
  longitude,
  zoom,
  label
}: {
  latitude: number
  longitude: number
  zoom: number
  label: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom,
      // A status display, not something to explore: dragging it away from the
      // vehicle would leave it showing somewhere the vehicle is not.
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      keyboard: false
    })
    L.tileLayer('/tiles/{z}/{x}/{y}', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map)
    markerRef.current = L.circleMarker([latitude, longitude], {
      radius: 7,
      weight: 2
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Set up once; the position is followed by the effect below rather than by
    // rebuilding the map, which is what the iframe used to do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mapRef.current?.setView([latitude, longitude], zoom, { animate: false })
    markerRef.current?.setLatLng([latitude, longitude])
  }, [latitude, longitude, zoom])

  return <div className="gps-map-card__leaflet" ref={containerRef} role="img" aria-label={label} />
}

function buildOpenStreetMapUrl(latitudeDeg: number, longitudeDeg: number, compact: boolean): string {
  const zoom = compact ? 16 : 17
  return `https://www.openstreetmap.org/?mlat=${latitudeDeg.toFixed(6)}&mlon=${longitudeDeg.toFixed(6)}#map=${zoom}/${latitudeDeg.toFixed(6)}/${longitudeDeg.toFixed(6)}`
}

function formatMetric(value: number | undefined, suffix: string): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(1)}${suffix}`
}

function distanceBetweenCoordinatesMeters(a: StableMapFocus, b: StableMapFocus): number {
  const averageLatitudeRad = ((a.latitudeDeg + b.latitudeDeg) * Math.PI) / 360
  const latitudeMeters = (b.latitudeDeg - a.latitudeDeg) * 111_320
  const longitudeMeters = (b.longitudeDeg - a.longitudeDeg) * 111_320 * Math.cos(averageLatitudeRad)
  return Math.hypot(latitudeMeters, longitudeMeters)
}

export function LiveGpsMapCard({ snapshot, title, subtitle, compact = false, testId }: LiveGpsMapCardProps) {
  const position = snapshot.liveVerification.globalPosition
  const latitudeDeg = position.latitudeDeg
  const longitudeDeg = position.longitudeDeg
  const verified = position.verified && latitudeDeg !== undefined && longitudeDeg !== undefined
  const [stableFocus, setStableFocus] = useState<StableMapFocus | undefined>(undefined)

  useEffect(() => {
    if (!verified) {
      return
    }

    const nextFocus = { latitudeDeg, longitudeDeg }
    setStableFocus((currentFocus) => {
      if (!currentFocus) {
        return nextFocus
      }

      return distanceBetweenCoordinatesMeters(currentFocus, nextFocus) >= MAP_RECENTER_THRESHOLD_METERS
        ? nextFocus
        : currentFocus
    })
  }, [verified, latitudeDeg, longitudeDeg])

  const displayFocus = verified
    ? stableFocus ?? { latitudeDeg, longitudeDeg }
    : undefined

  const externalUrl = useMemo(() => {
    if (!displayFocus) {
      return undefined
    }

    return buildOpenStreetMapUrl(displayFocus.latitudeDeg, displayFocus.longitudeDeg, compact)
  }, [compact, displayFocus])

  return (
    <div className={`gps-map-card${compact ? ' gps-map-card--compact' : ''}`} data-testid={testId}>
      <div className="gps-map-card__header">
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
        <StatusBadge tone={verified ? 'success' : 'warning'}>{verified ? 'position live' : 'waiting'}</StatusBadge>
      </div>

      <div className="gps-map-card__frame">
        {displayFocus ? (
          <LiveGpsLeafletMap
            latitude={displayFocus.latitudeDeg}
            longitude={displayFocus.longitudeDeg}
            zoom={compact ? 16 : 17}
            label={title}
          />
        ) : (
          <div className="gps-map-card__placeholder">
            <span>No live global position yet</span>
            <strong>Waiting on GLOBAL_POSITION_INT telemetry</strong>
            <small>Coordinates will appear here as soon as the controller starts reporting a live global position.</small>
          </div>
        )}
      </div>

      <div className="gps-map-card__meta">
        <article>
          <span>Latitude</span>
          <strong>{formatCoordinate(position.latitudeDeg, 'N', 'S')}</strong>
        </article>
        <article>
          <span>Longitude</span>
          <strong>{formatCoordinate(position.longitudeDeg, 'E', 'W')}</strong>
        </article>
        <article>
          <span>Relative alt</span>
          <strong>{formatMetric(position.relativeAltitudeM, ' m')}</strong>
        </article>
        <article>
          <span>Ground speed</span>
          <strong>{formatMetric(position.groundSpeedMs, ' m/s')}</strong>
        </article>
      </div>

      <div className="gps-map-card__footer">
        <small>
          {verified
            ? 'Map tiles come from OpenStreetMap. The view recenters only after meaningful aircraft movement so zoom and pan stay usable during small GPS drift.'
            : 'Mission-control style location review appears automatically when the flight controller reports a live global position.'}
        </small>
        {externalUrl ? (
          <a href={externalUrl} target="_blank" rel="noreferrer">
            Open in OpenStreetMap
          </a>
        ) : null}
      </div>
    </div>
  )
}
