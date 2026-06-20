// Power-review parameter catalog, lifted out of App.tsx as a small
// bounded slice toward a PowerSection cleanup. Same shape as
// useGpsCatalog / useVtxCatalog / useReceiverSupportCatalog: a
// selectViewCatalog memo + N .get() pulls, byte-identical to the
// App.tsx original.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { POWER_REVIEW_PARAM_IDS } from '../param-groups'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface UsePowerReviewCatalogResult {
  batteryMonitorParameter: ParameterState | undefined
  batteryCapacityParameter: ParameterState | undefined
  batteryArmVoltageParameter: ParameterState | undefined
  batteryArmMahParameter: ParameterState | undefined
  batteryVoltageSourceParameter: ParameterState | undefined
  batteryLowVoltageParameter: ParameterState | undefined
  batteryLowMahParameter: ParameterState | undefined
  batteryFailsafeParameter: ParameterState | undefined
  batteryCriticalVoltageParameter: ParameterState | undefined
  batteryCriticalMahParameter: ParameterState | undefined
  batteryCriticalFailsafeParameter: ParameterState | undefined
  throttleFailsafeParameter: ParameterState | undefined
  throttleFailsafeValueParameter: ParameterState | undefined
}

/**
 * Selects the Power-review parameter catalog from a snapshot and
 * exposes the 13 named parameters the Power configuration surface
 * renders inline. Output values are byte-identical to the App.tsx
 * originals.
 */
export function usePowerReviewCatalog(snapshot: ConfiguratorSnapshot): UsePowerReviewCatalogResult {
  const { byId: powerReviewParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, POWER_REVIEW_PARAM_IDS),
    [snapshot.parameters]
  )
  const batteryMonitorParameter = powerReviewParameterById.get('BATT_MONITOR')
  const batteryCapacityParameter = powerReviewParameterById.get('BATT_CAPACITY')
  const batteryArmVoltageParameter = powerReviewParameterById.get('BATT_ARM_VOLT')
  const batteryArmMahParameter = powerReviewParameterById.get('BATT_ARM_MAH')
  const batteryVoltageSourceParameter = powerReviewParameterById.get('BATT_FS_VOLTSRC')
  const batteryLowVoltageParameter = powerReviewParameterById.get('BATT_LOW_VOLT')
  const batteryLowMahParameter = powerReviewParameterById.get('BATT_LOW_MAH')
  const batteryFailsafeParameter = powerReviewParameterById.get('BATT_FS_LOW_ACT')
  const batteryCriticalVoltageParameter = powerReviewParameterById.get('BATT_CRT_VOLT')
  const batteryCriticalMahParameter = powerReviewParameterById.get('BATT_CRT_MAH')
  const batteryCriticalFailsafeParameter = powerReviewParameterById.get('BATT_FS_CRT_ACT')
  const throttleFailsafeParameter = powerReviewParameterById.get('FS_THR_ENABLE')
  const throttleFailsafeValueParameter = powerReviewParameterById.get('FS_THR_VALUE')

  return {
    batteryMonitorParameter,
    batteryCapacityParameter,
    batteryArmVoltageParameter,
    batteryArmMahParameter,
    batteryVoltageSourceParameter,
    batteryLowVoltageParameter,
    batteryLowMahParameter,
    batteryFailsafeParameter,
    batteryCriticalVoltageParameter,
    batteryCriticalMahParameter,
    batteryCriticalFailsafeParameter,
    throttleFailsafeParameter,
    throttleFailsafeValueParameter
  }
}
