import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import { isGpsCoordFormat, type GpsCoordFormat } from '../gps-coord-format'

const GPS_COORD_FORMAT_STORAGE_KEY = 'arduconfig:gps-coord-format'

function readStoredFormat(): GpsCoordFormat {
  if (typeof window === 'undefined') {
    return 'decimal'
  }

  try {
    const stored = window.localStorage.getItem(GPS_COORD_FORMAT_STORAGE_KEY)
    return isGpsCoordFormat(stored) ? stored : 'decimal'
  } catch {
    return 'decimal'
  }
}

export function useGpsCoordFormat(): [GpsCoordFormat, Dispatch<SetStateAction<GpsCoordFormat>>] {
  const [format, setFormat] = useState<GpsCoordFormat>(readStoredFormat)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(GPS_COORD_FORMAT_STORAGE_KEY, format)
    } catch {
      // Ignore storage failures; format still applies for the current render tree.
    }
  }, [format])

  return [format, setFormat]
}
