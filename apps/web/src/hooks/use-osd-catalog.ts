// OSD-parameter catalog. Same shape as the GPS/VTX/Power catalog hooks,
// but also returns the byId Map because useOsdEditor and the OsdSection
// prop both consume it directly.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { OSD_PARAM_IDS } from '../osd-params'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UseOsdCatalogResult {
  osdParameterById: Map<string, ParameterState>
  osdTypeParameter: ParameterState | undefined
  osdChannelParameter: ParameterState | undefined
  osdSwitchMethodParameter: ParameterState | undefined
  mspOptionsParameter: ParameterState | undefined
  mspOsdCellCountParameter: ParameterState | undefined
}

/**
 * Selects the OSD parameter catalog from a snapshot and exposes 5 named
 * parameters the OSD surface renders inline. Also returns the byId Map
 * because useOsdEditor and OsdSection consume it directly.
 */
export function useOsdCatalog(snapshot: ConfiguratorSnapshot): UseOsdCatalogResult {
  const { byId: osdParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, OSD_PARAM_IDS),
    [snapshot.parameters]
  )
  const osdTypeParameter = osdParameterById.get('OSD_TYPE')
  const osdChannelParameter = osdParameterById.get('OSD_CHAN')
  const osdSwitchMethodParameter = osdParameterById.get('OSD_SW_METHOD')
  const mspOptionsParameter = osdParameterById.get('MSP_OPTIONS')
  const mspOsdCellCountParameter = osdParameterById.get('MSP_OSD_NCELLS')

  return {
    osdParameterById,
    osdTypeParameter,
    osdChannelParameter,
    osdSwitchMethodParameter,
    mspOptionsParameter,
    mspOsdCellCountParameter
  }
}
