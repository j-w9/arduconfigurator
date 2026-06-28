// PresetsSection — App.tsx's `activeViewId === 'presets'` block. The PresetsView
// call ran ~120 lines inline because the slot shapes (groups, selected diff,
// invalid entries) require a fair amount of mapping. Now lifted into a section
// that takes the small set of derived state + the apply / erase handlers.

import type { Dispatch, ReactElement, SetStateAction } from 'react'
import type {
  ConfiguratorSnapshot,
  ParameterDraftEntry,
  ParameterDraftGroup,
  ParameterPresetApplicabilityResult,
  ParameterPresetDiffResult
} from '@arduconfig/ardupilot-core'
import { deriveParameterDraftEntries } from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle, NormalizedPresetDefinition, PresetGroupDefinition } from '@arduconfig/param-metadata'

import type { ParameterFollowUp, ParameterNotice } from '../hooks/use-parameter-feedback'
import { formatParameterDelta, formatParameterValue } from '../parameter-format'
import type { SavedParameterSnapshot } from '../snapshot-library'
import { toneForPresetApplicability } from '../tone-helpers'
import { PresetsView, type PresetsCard, type PresetsGroup } from '../views/Presets'

interface PresetPreview {
  diff: ParameterPresetDiffResult
  applicability: ParameterPresetApplicabilityResult
}

export interface PresetsSectionProps {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  parameterFollowUp: ParameterFollowUp | undefined
  presetNotice: ParameterNotice | undefined
  presetDefinitions: readonly NormalizedPresetDefinition[]
  presetGroups: readonly PresetGroupDefinition[]
  presetPreviewById: ReadonlyMap<string, PresetPreview>
  selectedPresets: readonly NormalizedPresetDefinition[]
  selectedPresetConflicts: readonly string[]
  selectedPresetUnknownIds: readonly string[]
  selectedPresetTouchedCount: number
  selectedPresetApplicability: ParameterPresetApplicabilityResult
  selectedPresetDiffGroups: readonly ParameterDraftGroup[]
  selectedPresetChangedEntries: readonly ParameterDraftEntry[]
  selectedPresetInvalidEntries: readonly ParameterDraftEntry[]
  /** Param ids the operator dropped from the combined diff (excluded from apply). */
  droppedPresetParamIds: readonly string[]
  onTogglePresetParamDrop: (paramId: string) => void
  savedSnapshots: readonly SavedParameterSnapshot[]
  presetApplyAcknowledged: boolean
  setPresetApplyAcknowledged: Dispatch<SetStateAction<boolean>>
  onTogglePreset: (presetId: string) => void
  runtime: unknown
  formatCategoryLabel: (categoryId: string | undefined) => string
  onApplySelectedPreset: () => void | Promise<void>
  onStageSelectedPresetDiff: () => void
  onEraseSettings: () => void | Promise<void>
}

export function PresetsSection(props: PresetsSectionProps): ReactElement {
  const {
    snapshot,
    metadataCatalog,
    busyAction,
    canApplyDraftParameters,
    parameterFollowUp,
    presetNotice,
    presetDefinitions,
    presetGroups,
    presetPreviewById,
    selectedPresets,
    selectedPresetConflicts,
    selectedPresetUnknownIds,
    selectedPresetTouchedCount,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    droppedPresetParamIds,
    onTogglePresetParamDrop,
    savedSnapshots,
    presetApplyAcknowledged,
    setPresetApplyAcknowledged,
    onTogglePreset,
    runtime,
    formatCategoryLabel,
    onApplySelectedPreset,
    onStageSelectedPresetDiff,
    onEraseSettings
  } = props

  const hasSelection = selectedPresets.length > 0
  const unchangedCount = Math.max(
    0,
    selectedPresetTouchedCount - selectedPresetChangedEntries.length - selectedPresetInvalidEntries.length
  )
  // Surface params set by more than one selected preset (later pick wins) as a
  // caution so a silent overwrite never happens.
  const conflictCautions =
    selectedPresetConflicts.length > 0
      ? [
          `${selectedPresetConflicts.length} parameter(s) are set by more than one selected preset — the later selection wins: ${selectedPresetConflicts.join(', ')}.`
        ]
      : []
  const dedupe = (values: readonly string[]): string[] => [...new Set(values)]
  const single = selectedPresets.length === 1 ? selectedPresets[0] : undefined
  const selectedPanel = hasSelection
    ? {
        label: single ? single.label : `${selectedPresets.length} presets selected`,
        description: single
          ? single.description
          : `Combined diff for ${selectedPresets.map((preset) => preset.label).join(', ')}.`,
        groupLabel: single ? single.groupDefinition.label : 'Multiple categories',
        applicabilityStatus: selectedPresetApplicability.status,
        applicabilityTone: toneForPresetApplicability(selectedPresetApplicability.status),
        applicabilityReasons: selectedPresetApplicability.reasons,
        paramCount: selectedPresetTouchedCount,
        changedCount: selectedPresetChangedEntries.length,
        unchangedCount,
        unknownCount: selectedPresetUnknownIds.length,
        tags: single ? single.tags ?? [] : dedupe(selectedPresets.flatMap((preset) => preset.tags ?? [])),
        note: single ? single.note : undefined,
        prerequisites: dedupe(selectedPresets.flatMap((preset) => preset.prerequisites ?? [])),
        cautions: [...conflictCautions, ...dedupe(selectedPresets.flatMap((preset) => preset.cautions ?? []))],
        diffGroups: selectedPresetDiffGroups.map((group) => ({
          category: group.category,
          categoryLabel: formatCategoryLabel(group.category),
          changedCount: group.entries.length,
          entries: group.entries.map((draft) => ({
            id: draft.id,
            label: draft.label,
            fromToText: `${formatParameterValue(draft.currentValue, draft.definition?.unit)} to ${formatParameterValue(draft.nextValue, draft.definition?.unit)}`,
            deltaText: formatParameterDelta(draft.delta, draft.definition?.unit),
            dropped: droppedPresetParamIds.includes(draft.id)
          }))
        })),
        invalidEntries: selectedPresetInvalidEntries.map((draft) => ({
          id: draft.id,
          label: draft.label,
          rawValue: draft.rawValue,
          reason: draft.reason ?? 'Invalid value'
        }))
      }
    : null

  return (
    <PresetsView
      headerTone={toneForPresetApplicability(selectedPresetApplicability.status)}
      headerBadgeLabel={
        selectedPresetInvalidEntries.length > 0
          ? `${selectedPresetInvalidEntries.length} invalid`
          : selectedPresetChangedEntries.length > 0
            ? `${selectedPresetChangedEntries.length} diff`
            : `${presetDefinitions.length} presets`
      }
      notice={presetNotice ? { tone: presetNotice.tone, toneLabel: presetNotice.tone, text: presetNotice.text } : null}
      followUp={parameterFollowUp ? { requiresReboot: parameterFollowUp.requiresReboot, text: parameterFollowUp.text } : null}
      familiesCount={presetGroups.length}
      totalCount={presetDefinitions.length}
      changedCount={selectedPresetChangedEntries.length}
      autoBackupCount={savedSnapshots.filter((snapshotEntry) => snapshotEntry.tags.includes('auto-backup')).length}
      groups={presetGroups.map((group): PresetsGroup => ({
        id: group.id,
        label: group.label,
        description: group.description,
        cardCount: metadataCatalog.presetsByGroup[group.id]?.length ?? 0,
        cards: (metadataCatalog.presetsByGroup[group.id] ?? []).map((preset): PresetsCard => {
          const preview = presetPreviewById.get(preset.id)
          const isActive = selectedPresets.some((selected) => selected.id === preset.id)
          const cardChangedCount = preview?.diff.changedCount ?? 0
          const cardInvalidCount = deriveParameterDraftEntries(snapshot.parameters, preview?.diff.draftValues ?? {}).filter(
            (entry) => entry.status === 'invalid'
          ).length
          return {
            id: preset.id,
            label: preset.label,
            description: preset.description,
            paramCount: preset.values.length,
            tags: preset.tags ?? [],
            note: preset.note,
            changedCount: cardChangedCount,
            invalidCount: cardInvalidCount,
            badgeLabel:
              cardInvalidCount > 0
                ? `${cardInvalidCount} invalid`
                : preview?.applicability.status === 'blocked'
                  ? 'blocked'
                  : cardChangedCount > 0
                    ? `${cardChangedCount} diff`
                    : 'matches',
            badgeTone:
              cardInvalidCount > 0
                ? 'danger'
                : preview
                  ? toneForPresetApplicability(preview.applicability.status)
                  : 'neutral',
            isActive
          }
        })
      }))}
      selected={selectedPanel}
      onToggleDropParam={onTogglePresetParamDrop}
      applyAcknowledged={presetApplyAcknowledged}
      onAcknowledgedChange={setPresetApplyAcknowledged}
      onSelectPreset={onTogglePreset}
      onApplyPreset={() => void onApplySelectedPreset()}
      onStageDraft={onStageSelectedPresetDiff}
      isApplying={busyAction === 'presets:apply'}
      isBusy={busyAction !== undefined}
      canApply={canApplyDraftParameters}
      applicabilityBlocked={selectedPresetApplicability.status === 'blocked'}
      hasChanges={selectedPresetChangedEntries.length > 0}
      hasInvalid={selectedPresetInvalidEntries.length > 0}
      onEraseSettings={
        runtime && snapshot.connection.kind === 'connected'
          ? () => void onEraseSettings()
          : undefined
      }
      isErasing={busyAction === 'presets:erase'}
      eraseDisabledReason={
        snapshot.connection.kind !== 'connected'
          ? 'Connect to a vehicle first.'
          : snapshot.vehicle?.armed
            ? 'Disarm the vehicle before erasing settings.'
            : undefined
      }
      libraryRestrictedNote={
        presetDefinitions.length === 0
          ? `No curated presets ship for ${snapshot.vehicle?.vehicle ?? 'this vehicle'} yet, so the library is empty here. Erase all settings still works on every vehicle.`
          : undefined
      }
    />
  )
}
