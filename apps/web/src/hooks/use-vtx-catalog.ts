// VTX-parameter catalog, lifted out of App.tsx as a small bounded slice
// toward a Ports/VTX section cleanup. Same shape as useGpsCatalog and
// useReceiverSupportCatalog: a selectViewCatalog memo + N .get() pulls,
// byte-identical to the App.tsx original.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { VTX_PARAM_IDS } from '../param-groups'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UseVtxCatalogResult {
  vtxEnableParameter: ParameterState | undefined
  vtxFrequencyParameter: ParameterState | undefined
  vtxPowerParameter: ParameterState | undefined
  vtxMaxPowerParameter: ParameterState | undefined
  vtxOptionsParameter: ParameterState | undefined
}

/**
 * Selects the VTX parameter catalog from a snapshot and exposes the 5
 * named parameters the VTX configuration surface renders inline. Output
 * values are byte-identical to the App.tsx originals.
 */
export function useVtxCatalog(snapshot: ConfiguratorSnapshot): UseVtxCatalogResult {
  const { byId: vtxParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, VTX_PARAM_IDS),
    [snapshot.parameters]
  )
  const vtxEnableParameter = vtxParameterById.get('VTX_ENABLE')
  const vtxFrequencyParameter = vtxParameterById.get('VTX_FREQ')
  const vtxPowerParameter = vtxParameterById.get('VTX_POWER')
  const vtxMaxPowerParameter = vtxParameterById.get('VTX_MAX_POWER')
  const vtxOptionsParameter = vtxParameterById.get('VTX_OPTIONS')

  return {
    vtxEnableParameter,
    vtxFrequencyParameter,
    vtxPowerParameter,
    vtxMaxPowerParameter,
    vtxOptionsParameter
  }
}
