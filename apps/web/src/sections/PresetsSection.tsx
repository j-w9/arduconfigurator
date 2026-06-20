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
  selectedPreset: NormalizedPresetDefinition | undefined
  selectedPresetDiff: ParameterPresetDiffResult | undefined
  selectedPresetApplicability: ParameterPresetApplicabilityResult
  selectedPresetDiffGroups: readonly ParameterDraftGroup[]
  selectedPresetChangedEntries: readonly ParameterDraftEntry[]
  selectedPresetInvalidEntries: readonly ParameterDraftEntry[]
  savedSnapshots: readonly SavedParameterSnapshot[]
  presetApplyAcknowledged: boolean
  setPresetApplyAcknowledged: Dispatch<SetStateAction<boolean>>
  setSelectedPresetId: Dispatch<SetStateAction<string | undefined>>
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
    selectedPreset,
    selectedPresetDiff,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    savedSnapshots,
    presetApplyAcknowledged,
    setPresetApplyAcknowledged,
    setSelectedPresetId,
    runtime,
    formatCategoryLabel,
    onApplySelectedPreset,
    onStageSelectedPresetDiff,
    onEraseSettings
  } = props

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
      changedCount={selectedPresetDiff?.changedCount ?? 0}
      autoBackupCount={savedSnapshots.filter((snapshotEntry) => snapshotEntry.tags.includes('auto-backup')).length}
      groups={presetGroups.map((group): PresetsGroup => ({
        id: group.id,
        label: group.label,
        description: group.description,
        cardCount: metadataCatalog.presetsByGroup[group.id]?.length ?? 0,
        cards: (metadataCatalog.presetsByGroup[group.id] ?? []).map((preset): PresetsCard => {
          const preview = presetPreviewById.get(preset.id)
          const isActive = preset.id === selectedPreset?.id
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
      selected={selectedPreset ? {
        label: selectedPreset.label,
        description: selectedPreset.description,
        groupLabel: selectedPreset.groupDefinition.label,
        applicabilityStatus: selectedPresetApplicability.status,
        applicabilityTone: toneForPresetApplicability(selectedPresetApplicability.status),
        applicabilityReasons: selectedPresetApplicability.reasons,
        paramCount: selectedPreset.values.length,
        changedCount: selectedPresetChangedEntries.length,
        unchangedCount: selectedPresetDiff?.unchangedCount ?? 0,
        unknownCount: selectedPresetDiff?.unknownParameterIds.length ?? 0,
        tags: selectedPreset.tags ?? [],
        note: selectedPreset.note,
        prerequisites: selectedPreset.prerequisites ?? [],
        cautions: selectedPreset.cautions ?? [],
        diffGroups: selectedPresetDiffGroups.map((group) => ({
          category: group.category,
          categoryLabel: formatCategoryLabel(group.category),
          changedCount: group.entries.length,
          entries: group.entries.map((draft) => ({
            id: draft.id,
            label: draft.label,
            fromToText: `${formatParameterValue(draft.currentValue, draft.definition?.unit)} to ${formatParameterValue(draft.nextValue, draft.definition?.unit)}`,
            deltaText: formatParameterDelta(draft.delta, draft.definition?.unit)
          }))
        })),
        invalidEntries: selectedPresetInvalidEntries.map((draft) => ({
          id: draft.id,
          label: draft.label,
          rawValue: draft.rawValue,
          reason: draft.reason ?? 'Invalid value'
        }))
      } : null}
      applyAcknowledged={presetApplyAcknowledged}
      onAcknowledgedChange={setPresetApplyAcknowledged}
      onSelectPreset={setSelectedPresetId}
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
        snapshot.vehicle?.vehicle && snapshot.vehicle.vehicle !== 'ArduCopter'
          ? `The curated preset library is currently defined only for ArduCopter. No bundles ship for ${snapshot.vehicle.vehicle} yet, so the library is empty here. Erase all settings still works on every vehicle.`
          : undefined
      }
    />
  )
}
