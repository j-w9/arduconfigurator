// Tuning parameter catalog + per-cluster derived groups, lifted out of
// App.tsx as a moderate bounded slice toward a TuningCopterSection
// follow-up. Resolves TUNING_PARAM_IDS against the live snapshot once
// and exposes (a) the full per-id Map and parameters list, (b) five
// flat-list slices (flight-feel, accel-limit, acro, advanced-PID,
// filter), and (c) three per-axis group lists (PID, filter, advanced
// PID). Behavior-identical to the App.tsx originals: same memos, same
// dep arrays, same filter typeguard.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import {
  TUNING_ACCEL_LIMIT_PARAM_IDS,
  TUNING_ACRO_PARAM_IDS,
  TUNING_ADVANCED_PID_AXIS_GROUPS,
  TUNING_ADVANCED_PID_PARAM_IDS,
  TUNING_FILTER_AXIS_GROUPS,
  TUNING_FILTER_PARAM_IDS,
  TUNING_FLIGHT_FEEL_PARAM_IDS,
  TUNING_PARAM_IDS,
  TUNING_PID_AXIS_GROUPS
} from '../tuning-params'
import { selectViewCatalog } from '../selectors/view-catalog'

export interface TuningParameterAxisGroup {
  id: string
  label: string
  paramIds: readonly string[]
  parameters: ParameterState[]
}

export interface UseTuningCatalogResult {
  tuningParameters: ParameterState[]
  tuningParameterById: Map<string, ParameterState>
  flightFeelParameters: ParameterState[]
  tuningAccelerationParameters: ParameterState[]
  acroTuningParameters: ParameterState[]
  tuningAdvancedPidParameters: ParameterState[]
  tuningFilterParameters: ParameterState[]
  tuningPidAxisGroups: TuningParameterAxisGroup[]
  tuningFilterAxisGroups: TuningParameterAxisGroup[]
  tuningAdvancedPidAxisGroups: TuningParameterAxisGroup[]
}

/**
 * Selects the Tuning parameter catalog from a snapshot and exposes the
 * full set of derived groups the Tuning workbench reads — the flat
 * list, the per-id Map (consumed by counterpart-lookup code outside the
 * Tuning surface), the five flat-list slices, and the three per-axis
 * group lists. Output values are byte-identical to the App.tsx originals.
 */
export function useTuningCatalog(snapshot: ConfiguratorSnapshot): UseTuningCatalogResult {
  const { parameters: tuningParameters, byId: tuningParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, TUNING_PARAM_IDS),
    [snapshot.parameters]
  )
  const flightFeelParameters = useMemo(
    () =>
      TUNING_FLIGHT_FEEL_PARAM_IDS.map((paramId) => tuningParameterById.get(paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [tuningParameterById]
  )
  const tuningAccelerationParameters = useMemo(
    () =>
      TUNING_ACCEL_LIMIT_PARAM_IDS.map((paramId) => tuningParameterById.get(paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [tuningParameterById]
  )
  const acroTuningParameters = useMemo(
    () =>
      TUNING_ACRO_PARAM_IDS.map((paramId) => tuningParameterById.get(paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [tuningParameterById]
  )
  const tuningAdvancedPidParameters = useMemo(
    () =>
      TUNING_ADVANCED_PID_PARAM_IDS.map((paramId) => tuningParameterById.get(paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [tuningParameterById]
  )
  const tuningFilterParameters = useMemo(
    () =>
      TUNING_FILTER_PARAM_IDS.map((paramId) => tuningParameterById.get(paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [tuningParameterById]
  )
  const tuningPidAxisGroups = useMemo(
    () =>
      TUNING_PID_AXIS_GROUPS.map((group) => ({
        ...group,
        parameters: group.paramIds
          .map((paramId) => tuningParameterById.get(paramId))
          .filter((parameter): parameter is ParameterState => parameter !== undefined)
      })),
    [tuningParameterById]
  )
  const tuningFilterAxisGroups = useMemo(
    () =>
      TUNING_FILTER_AXIS_GROUPS.map((group) => ({
        ...group,
        parameters: group.paramIds
          .map((paramId) => tuningParameterById.get(paramId))
          .filter((parameter): parameter is ParameterState => parameter !== undefined)
      })),
    [tuningParameterById]
  )
  const tuningAdvancedPidAxisGroups = useMemo(
    () =>
      TUNING_ADVANCED_PID_AXIS_GROUPS.map((group) => ({
        ...group,
        parameters: group.paramIds
          .map((paramId) => tuningParameterById.get(paramId))
          .filter((parameter): parameter is ParameterState => parameter !== undefined)
      })),
    [tuningParameterById]
  )

  return {
    tuningParameters,
    tuningParameterById,
    flightFeelParameters,
    tuningAccelerationParameters,
    acroTuningParameters,
    tuningAdvancedPidParameters,
    tuningFilterParameters,
    tuningPidAxisGroups,
    tuningFilterAxisGroups,
    tuningAdvancedPidAxisGroups
  }
}
