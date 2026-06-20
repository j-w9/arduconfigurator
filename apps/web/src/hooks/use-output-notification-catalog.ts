// Output-notification (LED + buzzer) parameter catalog, lifted out of
// App.tsx as the last inline selectViewCatalog cluster. Same shape as
// useGpsCatalog / useVtxCatalog / useReceiverSupportCatalog: a
// selectViewCatalog memo + N .get() pulls, byte-identical to the
// App.tsx original.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { OUTPUT_NOTIFICATION_PARAM_IDS } from '../param-groups'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UseOutputNotificationCatalogResult {
  notificationLedTypesParameter: ParameterState | undefined
  notificationLedLengthParameter: ParameterState | undefined
  notificationLedBrightnessParameter: ParameterState | undefined
  notificationLedOverrideParameter: ParameterState | undefined
  notificationBuzzTypesParameter: ParameterState | undefined
  notificationBuzzVolumeParameter: ParameterState | undefined
}

/**
 * Selects the output-notification (LED + buzzer) parameter catalog from
 * a snapshot and exposes the 6 named parameters the Outputs surface
 * renders inline. The intermediate Map is private to the hook.
 *
 * Output values are byte-identical to the App.tsx originals.
 */
export function useOutputNotificationCatalog(snapshot: ConfiguratorSnapshot): UseOutputNotificationCatalogResult {
  const { byId: outputNotificationParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, OUTPUT_NOTIFICATION_PARAM_IDS),
    [snapshot.parameters]
  )
  const notificationLedTypesParameter = outputNotificationParameterById.get('NTF_LED_TYPES')
  const notificationLedLengthParameter = outputNotificationParameterById.get('NTF_LED_LEN')
  const notificationLedBrightnessParameter = outputNotificationParameterById.get('NTF_LED_BRIGHT')
  const notificationLedOverrideParameter = outputNotificationParameterById.get('NTF_LED_OVERRIDE')
  const notificationBuzzTypesParameter = outputNotificationParameterById.get('NTF_BUZZ_TYPES')
  const notificationBuzzVolumeParameter = outputNotificationParameterById.get('NTF_BUZZ_VOLUME')

  return {
    notificationLedTypesParameter,
    notificationLedLengthParameter,
    notificationLedBrightnessParameter,
    notificationLedOverrideParameter,
    notificationBuzzTypesParameter,
    notificationBuzzVolumeParameter
  }
}
