// Generic "additional-parameters scope" helper, factored out of App.tsx.
//
// Each App.tsx view that has an "Additional settings" surface previously
// inlined the SAME pair of useMemos: build the per-view AdditionalSettingsGroup
// list from the metadata catalog (filtered against an excluded-id set), then
// narrow the global draft-entry list to that group's parameter ids and split
// the result into staged + invalid subsets. That pair appeared 5 times in
// App.tsx (setup / ports / receiver / power / output) — this hook collapses
// the pair into one named bag, byte-identical to the originals (same memos,
// same dep arrays, same Set-of-ids derivation).

import { useMemo } from 'react'

import type {
  ConfiguratorSnapshot,
  ParameterDraftEntry
} from '@arduconfig/ardupilot-core'
import type {
  AppViewId,
  NormalizedFirmwareMetadataBundle
} from '@arduconfig/param-metadata'

import { selectViewDrafts } from '../selectors/view-drafts'
import {
  type AdditionalSettingsGroup,
  buildAdditionalSettingsGroups
} from '../view-models/peripherals'

export interface UseAdditionalScopeResult {
  groups: AdditionalSettingsGroup[]
  entries: ParameterDraftEntry[]
  staged: ParameterDraftEntry[]
  invalid: ParameterDraftEntry[]
}

/**
 * Builds a view's additional-settings groups and the matching draft
 * slice. `excludedParameterIds` is the predicate that identifies ids
 * already rendered by the view's primary surface (so they don't show up
 * twice in the Additional list). Omit it to exclude nothing.
 *
 * Output values are byte-identical to the App.tsx originals: same
 * useMemo bodies, same dep arrays, same Set construction (snapshot
 * parameter ids → filter via predicate → `new Set`).
 *
 * `excludedParameterIds` should be a stable function reference (a
 * module-level predicate, or a `useCallback` value) so the inner Set
 * memo only re-runs on snapshot changes, matching the original App.tsx
 * behavior.
 */
export function useAdditionalScope(input: {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  viewId: AppViewId
  excludedParameterIds?: (parameterId: string) => boolean
  parameterDraftEntries: readonly ParameterDraftEntry[]
}): UseAdditionalScopeResult {
  const { snapshot, metadataCatalog, viewId, excludedParameterIds, parameterDraftEntries } = input

  const groups = useMemo(
    () =>
      buildAdditionalSettingsGroups(
        snapshot,
        metadataCatalog,
        viewId,
        excludedParameterIds === undefined
          ? new Set<string>()
          : new Set(
              snapshot.parameters
                .filter((parameter) => excludedParameterIds(parameter.id))
                .map((parameter) => parameter.id)
            )
      ),
    [excludedParameterIds, metadataCatalog, snapshot, viewId]
  )
  const { entries, staged, invalid } = useMemo(
    () =>
      selectViewDrafts(parameterDraftEntries, (id) =>
        groups.some((group) => group.parameters.some((parameter) => parameter.id === id))
      ),
    [groups, parameterDraftEntries]
  )

  return { groups, entries, staged, invalid }
}
