// Parameter-draft derivations factored out of App.tsx. Builds the full set of
// values derived from the live draft pool: the draft entries (snapshot values
// overlaid with pending edits), an id-keyed map, the status summary, the staged
// and invalid subsets, their grouped views, and the reboot-required staged
// subset. Output values are byte-identical to the inline App.tsx originals.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  deriveParameterDraftEntries,
  groupParameterDraftEntries,
  summarizeParameterDraftEntries
} from '@arduconfig/ardupilot-core'

import type { ParameterDraftValues } from './use-parameter-drafts'

export function useParameterDraftDerivations(input: {
  snapshot: ConfiguratorSnapshot
  editedValues: ParameterDraftValues
  enumOverrides?: ReadonlySet<string>
}) {
  const { snapshot, editedValues, enumOverrides } = input

  const parameterDraftEntries = useMemo(
    () => deriveParameterDraftEntries(snapshot.parameters, editedValues, enumOverrides),
    [editedValues, snapshot.parameters, enumOverrides]
  )
  const parameterDraftById = useMemo(
    () => new Map(parameterDraftEntries.map((entry) => [entry.id, entry])),
    [parameterDraftEntries]
  )
  const parameterDraftSummary = useMemo(() => summarizeParameterDraftEntries(parameterDraftEntries), [parameterDraftEntries])
  const stagedParameterDrafts = useMemo(
    () => parameterDraftEntries.filter((entry) => entry.status === 'staged'),
    [parameterDraftEntries]
  )
  const invalidParameterDrafts = useMemo(
    () => parameterDraftEntries.filter((entry) => entry.status === 'invalid'),
    [parameterDraftEntries]
  )
  const stagedParameterGroups = useMemo(
    () => groupParameterDraftEntries(parameterDraftEntries, ['staged']),
    [parameterDraftEntries]
  )
  const invalidParameterGroups = useMemo(
    () => groupParameterDraftEntries(parameterDraftEntries, ['invalid']),
    [parameterDraftEntries]
  )
  const rebootRequiredDrafts = useMemo(
    () => stagedParameterDrafts.filter((draft) => draft.definition?.rebootRequired),
    [stagedParameterDrafts]
  )

  return {
    parameterDraftEntries,
    parameterDraftById,
    parameterDraftSummary,
    stagedParameterDrafts,
    invalidParameterDrafts,
    stagedParameterGroups,
    invalidParameterGroups,
    rebootRequiredDrafts
  }
}
