// A small click-to-pick map for the no-GPS calibration helper. Vanilla Leaflet
// (no react-leaflet) initialised once in a ref; clicking the map reports the
// lat/lon, and a vector circle marker (no image assets, so no bundler icon
// gotchas) shows the current pick. Read-only OSM tiles.

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface MapLocationPickerProps {
  latitude: number | undefined
  longitude: number | undefined
  onPick: (latitude: number, longitude: number) => void
  heightPx?: number
}

export function MapLocationPicker({
  latitude,
  longitude,
  onPick,
  heightPx = 260
}: MapLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  // Keep the latest onPick without re-running the init effect.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }
    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],
      zoom: 3,
      worldCopyJump: true
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => {
      onPickRef.current(
        Number(event.latlng.lat.toFixed(6)),
        Number(((event.latlng.lng + 540) % 360 - 180).toFixed(6))
      )
    })
    mapRef.current = map
    // Leaflet needs a size recalc once the container is laid out.
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    return () => {
      window.clearTimeout(sizeTimer)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  // Sync the marker + recenter when the selected point changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }
    if (latitude === undefined || longitude === undefined) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      return
    }
    const latlng: L.LatLngExpression = [latitude, longitude]
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng)
    } else {
      markerRef.current = L.circleMarker(latlng, {
        radius: 8,
        color: '#6db8e0',
        weight: 2,
        fillColor: '#6db8e0',
        fillOpacity: 0.55
      }).addTo(map)
    }
    map.panTo(latlng, { animate: true })
  }, [latitude, longitude])

  return (
    <div
      ref={containerRef}
      data-testid="cal-location-map"
      style={{
        height: heightPx,
        width: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border)'
      }}
    />
  )
}
