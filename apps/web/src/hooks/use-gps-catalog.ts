// GPS-parameter catalog, lifted out of App.tsx as a small bounded slice
// toward a PortsSection cleanup. Resolves GPS_PARAM_IDS against the live
// snapshot once and exposes the 4 named parameters the GPS surface reads.
// Behavior-identical to the App.tsx original: same selectViewCatalog memo
// + same .get() lookups.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { GPS_PARAM_IDS } from '../param-groups'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UseGpsCatalogResult {
  gpsAutoConfigParameter: ParameterState | undefined
  gpsAutoSwitchParameter: ParameterState | undefined
  gpsPrimaryParameter: ParameterState | undefined
  gpsRateParameter: ParameterState | undefined
}

/**
 * Selects the GPS parameter catalog from a snapshot and exposes the 4
 * named parameters the GPS configuration surface renders inline. Output
 * values are byte-identical to the App.tsx originals.
 */
export function useGpsCatalog(snapshot: ConfiguratorSnapshot): UseGpsCatalogResult {
  const { byId: gpsParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, GPS_PARAM_IDS),
    [snapshot.parameters]
  )
  const gpsAutoConfigParameter = gpsParameterById.get('GPS_AUTO_CONFIG')
  const gpsAutoSwitchParameter = gpsParameterById.get('GPS_AUTO_SWITCH')
  const gpsPrimaryParameter = gpsParameterById.get('GPS_PRIMARY')
  const gpsRateParameter = gpsParameterById.get('GPS_RATE_MS')

  return {
    gpsAutoConfigParameter,
    gpsAutoSwitchParameter,
    gpsPrimaryParameter,
    gpsRateParameter
  }
}
