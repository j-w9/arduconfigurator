// Receiver-support parameter catalog, lifted out of App.tsx as a small
// bounded slice toward a ReceiverSection extract. Resolves the receiver
// support param-id list once against the live snapshot, then exposes the
// 6 named parameters the Receiver workbench reads. Behavior-identical to
// the App.tsx originals — same selectViewCatalog memo + same .get()
// lookups.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { RECEIVER_SUPPORT_PARAM_IDS } from '../param-groups'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UseReceiverSupportCatalogResult {
  receiverSupportParameterById: Map<string, ParameterState>
  modeChannelParameter: ParameterState | undefined
  rssiTypeParameter: ParameterState | undefined
  rssiChannelParameter: ParameterState | undefined
  rssiChannelLowParameter: ParameterState | undefined
  rssiChannelHighParameter: ParameterState | undefined
  rcOptionsParameter: ParameterState | undefined
}

/**
 * Selects the receiver-support parameter catalog from a snapshot and
 * exposes the 6 named parameters the Receiver workbench renders inline.
 * Output values are byte-identical to the App.tsx originals.
 */
export function useReceiverSupportCatalog(snapshot: ConfiguratorSnapshot): UseReceiverSupportCatalogResult {
  const { byId: receiverSupportParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, RECEIVER_SUPPORT_PARAM_IDS),
    [snapshot.parameters]
  )
  const modeChannelParameter =
    receiverSupportParameterById.get('FLTMODE_CH') ?? receiverSupportParameterById.get('MODE_CH')
  const rssiTypeParameter = receiverSupportParameterById.get('RSSI_TYPE')
  const rssiChannelParameter = receiverSupportParameterById.get('RSSI_CHANNEL')
  const rssiChannelLowParameter = receiverSupportParameterById.get('RSSI_CHAN_LOW')
  const rssiChannelHighParameter = receiverSupportParameterById.get('RSSI_CHAN_HIGH')
  const rcOptionsParameter = receiverSupportParameterById.get('RC_OPTIONS')

  return {
    receiverSupportParameterById,
    modeChannelParameter,
    rssiTypeParameter,
    rssiChannelParameter,
    rssiChannelLowParameter,
    rssiChannelHighParameter,
    rcOptionsParameter
  }
}
