import { type ParameterState } from '@arduconfig/ardupilot-core'

export interface ViewCatalog {
  /** The view's parameters, in the order its id list declares them. */
  parameters: ParameterState[]
  /** The same parameters keyed by id for O(1) lookup. */
  byId: Map<string, ParameterState>
}

/**
 * The per-view catalog pair App.tsx repeats for ~8 surfaces: resolve a
 * fixed list of parameter ids against the current snapshot (dropping any
 * the vehicle hasn't reported yet), then index the survivors by id.
 *
 * Behaviorally identical to the two chained `useMemo`s it replaces —
 * same id order, same `snapshot.parameters.find` resolution, same
 * undefined filtering, and the map is still built from the resolved
 * list, so both recompute exactly when `snapshot.parameters` changes.
 */
export function selectViewCatalog(
  snapshotParameters: readonly ParameterState[],
  paramIds: readonly string[]
): ViewCatalog {
  const parameters = paramIds
    .map((paramId) => snapshotParameters.find((parameter) => parameter.id === paramId))
    .filter((parameter): parameter is ParameterState => parameter !== undefined)
  return {
    parameters,
    byId: new Map(parameters.map((parameter) => [parameter.id, parameter]))
  }
}
