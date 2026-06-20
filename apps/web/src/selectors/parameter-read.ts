import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

// Primitive parameter readers shared across every view. Lifted out of
// App.tsx (readRoundedParameter alone had 57 call sites) so per-view
// view-model modules can import them instead of depending on App.tsx —
// a prerequisite for decomposing the larger per-view derived-state
// clusters (serial ports, etc.). Pure; behavior-identical to the
// originals.
//
// Reads are O(1): we cache an id→ParameterState Map keyed off the
// `snapshot.parameters` array identity. The runtime hands out a fresh
// array on every emit, so the cache rebuild fires exactly once per
// snapshot tick instead of the ~80 ad-hoc `find()` scans App.tsx used
// to do per render.

const parameterMapCache = new WeakMap<readonly ParameterState[], Map<string, ParameterState>>()

function parameterMap(snapshot: ConfiguratorSnapshot): Map<string, ParameterState> {
  const parameters = snapshot.parameters
  let map = parameterMapCache.get(parameters)
  if (map === undefined) {
    map = new Map<string, ParameterState>()
    for (const parameter of parameters) {
      map.set(parameter.id, parameter)
    }
    parameterMapCache.set(parameters, map)
  }
  return map
}

export function selectParameterById(
  snapshot: ConfiguratorSnapshot,
  paramId: string
): ParameterState | undefined {
  return parameterMap(snapshot).get(paramId)
}

export function selectParametersByIds(
  snapshot: ConfiguratorSnapshot,
  paramIds: readonly string[]
): Array<ParameterState | undefined> {
  const map = parameterMap(snapshot)
  return paramIds.map((id) => map.get(id))
}

export function readParameterValue(
  snapshot: ConfiguratorSnapshot,
  paramId: string
): number | undefined {
  return parameterMap(snapshot).get(paramId)?.value
}

export function readRoundedParameter(
  snapshot: ConfiguratorSnapshot,
  paramId: string
): number | undefined {
  const value = readParameterValue(snapshot, paramId)
  return value === undefined ? undefined : Math.round(value)
}
