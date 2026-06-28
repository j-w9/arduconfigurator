// Preset-catalog derivations factored out of App.tsx. Lists the available preset
// definitions and their non-empty groups, precomputes each preset's
// diff-against-snapshot + applicability, then resolves the *set* of selected
// presets into a single merged preview: the union of their desired values
// (later selection wins on overlap, with overlaps flagged as conflicts), run
// through selectEntityDiff for the grouped/changed/invalid/signature bag, plus a
// combined applicability (worst status + per-preset reasons).

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ParameterPresetApplicabilityResult,
  deriveDraftValuesFromParameterPreset,
  evaluateParameterPresetApplicability
} from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle, NormalizedPresetDefinition } from '@arduconfig/param-metadata'

import { selectEntityDiff } from '../selectors/entity-diff'

const APPLICABILITY_RANK = { ready: 0, caution: 1, blocked: 2 } as const

/** A preset's diff against the live snapshot, narrowed to what the merge needs. */
interface PresetDraftPreview {
  diff: { draftValues: Record<string, string>; unknownParameterIds: readonly string[] }
}

/**
 * Merge the desired values of several selected presets into one draft set.
 * Later presets in the list win on overlap; any param written by more than one
 * preset to a differing value is reported as a conflict so the UI can warn.
 * Pure + structurally typed so it unit-tests without React.
 */
export function mergeSelectedPresetDrafts(
  presets: readonly { id: string }[],
  previewById: ReadonlyMap<string, PresetDraftPreview>
): { mergedDraftValues: Record<string, string>; conflicts: string[]; unknownIds: string[]; touchedCount: number } {
  const merged: Record<string, string> = {}
  const conflictSet = new Set<string>()
  const unknown = new Set<string>()
  for (const preset of presets) {
    const diff = previewById.get(preset.id)?.diff
    if (!diff) {
      continue
    }
    for (const [paramId, value] of Object.entries(diff.draftValues)) {
      if (paramId in merged && merged[paramId] !== value) {
        conflictSet.add(paramId)
      }
      merged[paramId] = value
    }
    for (const id of diff.unknownParameterIds) {
      unknown.add(id)
    }
  }
  return {
    mergedDraftValues: merged,
    conflicts: [...conflictSet],
    unknownIds: [...unknown],
    touchedCount: Object.keys(merged).length
  }
}

export function usePresetCatalog(input: {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  selectedPresetIds: readonly string[]
}) {
  const { snapshot, metadataCatalog, selectedPresetIds } = input

  const presetDefinitions = useMemo(() => metadataCatalog.presets, [metadataCatalog.presets])
  const presetGroups = useMemo(
    () => metadataCatalog.presetGroups.filter((group) => (metadataCatalog.presetsByGroup[group.id] ?? []).length > 0),
    [metadataCatalog.presetGroups, metadataCatalog.presetsByGroup]
  )
  const presetPreviewById = useMemo(
    () =>
      new Map(
        presetDefinitions.map((preset) => [
          preset.id,
          {
            diff: deriveDraftValuesFromParameterPreset(snapshot.parameters, preset),
            applicability: evaluateParameterPresetApplicability(snapshot, preset)
          }
        ])
      ),
    [presetDefinitions, snapshot.parameters, snapshot.vehicle?.vehicle]
  )

  // Resolve the selected ids into preset definitions, preserving the order in
  // which the operator picked them (that order decides the conflict winner).
  const selectedPresets = useMemo(
    () =>
      selectedPresetIds
        .map((id) => presetDefinitions.find((preset) => preset.id === id))
        .filter((preset): preset is NormalizedPresetDefinition => preset !== undefined),
    [presetDefinitions, selectedPresetIds]
  )

  // Merge every selected preset's desired values into one draft set. Presets
  // come from different categories so overlaps are rare; when two selected
  // presets disagree on a param the later selection wins, and the param id is
  // flagged so the UI can warn about the overwrite.
  const { mergedDraftValues, conflicts, unknownIds, touchedCount } = useMemo(
    () => mergeSelectedPresetDrafts(selectedPresets, presetPreviewById),
    [selectedPresets, presetPreviewById]
  )

  const {
    groups: selectedPresetDiffGroups,
    changed: selectedPresetChangedEntries,
    invalid: selectedPresetInvalidEntries,
    signature: selectedPresetDiffSignature
  } = useMemo(() => selectEntityDiff(snapshot.parameters, mergedDraftValues), [mergedDraftValues, snapshot.parameters])

  const selectedPresetApplicability = useMemo<ParameterPresetApplicabilityResult>(() => {
    if (selectedPresets.length === 0) {
      return {
        status: 'caution',
        reasons: ['Select one or more presets to review their combined compatibility and diff.']
      }
    }
    let status: ParameterPresetApplicabilityResult['status'] = 'ready'
    const reasons: string[] = []
    for (const preset of selectedPresets) {
      const applicability = presetPreviewById.get(preset.id)?.applicability
      if (!applicability) {
        continue
      }
      if (APPLICABILITY_RANK[applicability.status] > APPLICABILITY_RANK[status]) {
        status = applicability.status
      }
      for (const reason of applicability.reasons) {
        const prefixed = selectedPresets.length > 1 ? `${preset.label}: ${reason}` : reason
        if (!reasons.includes(prefixed)) {
          reasons.push(prefixed)
        }
      }
    }
    return { status, reasons }
  }, [selectedPresets, presetPreviewById])

  return {
    presetDefinitions,
    presetGroups,
    presetPreviewById,
    selectedPresets,
    selectedPresetDraftValues: mergedDraftValues,
    selectedPresetConflicts: conflicts,
    selectedPresetUnknownIds: unknownIds,
    selectedPresetTouchedCount: touchedCount,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    selectedPresetDiffSignature
  }
}
