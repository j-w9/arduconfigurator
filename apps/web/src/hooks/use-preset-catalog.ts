// Preset-catalog derivations factored out of App.tsx. The Motors-tab preset
// picker repeated a fixed chain of useMemos: list the available preset
// definitions and their non-empty groups, precompute each preset's
// diff-against-snapshot + applicability, then resolve the selected preset into
// its preview/diff/applicability and run the selected diff through
// selectEntityDiff for the grouped/changed/invalid/signature bag. Output values
// are byte-identical to the App.tsx originals.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  deriveDraftValuesFromParameterPreset,
  evaluateParameterPresetApplicability
} from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'

import { selectEntityDiff } from '../selectors/entity-diff'

export function usePresetCatalog(input: {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  selectedPresetId: string | undefined
}) {
  const { snapshot, metadataCatalog, selectedPresetId } = input

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
  const selectedPreset = useMemo(
    () => presetDefinitions.find((preset) => preset.id === selectedPresetId) ?? presetDefinitions[0],
    [presetDefinitions, selectedPresetId]
  )
  const selectedPresetPreview = selectedPreset ? presetPreviewById.get(selectedPreset.id) : undefined
  const selectedPresetDiff = selectedPresetPreview?.diff
  const selectedPresetApplicability = selectedPresetPreview?.applicability ?? {
    status: 'caution' as const,
    reasons: ['Select a preset to review its compatibility and diff.']
  }
  const {
    groups: selectedPresetDiffGroups,
    changed: selectedPresetChangedEntries,
    invalid: selectedPresetInvalidEntries,
    signature: selectedPresetDiffSignature
  } = useMemo(
    () => selectEntityDiff(snapshot.parameters, selectedPresetDiff?.draftValues),
    [selectedPresetDiff, snapshot.parameters]
  )

  return {
    presetDefinitions,
    presetGroups,
    presetPreviewById,
    selectedPreset,
    selectedPresetPreview,
    selectedPresetDiff,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    selectedPresetDiffSignature
  }
}
