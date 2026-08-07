// Preset-catalog derivations factored out of App.tsx. Lists the available preset
// definitions and their non-empty groups, precomputes each preset's
// diff-against-snapshot + applicability, then resolves the *set* of selected
// presets into a single merged preview: the union of their desired values
// (later selection wins on overlap, with overlaps flagged as conflicts), run
// through selectEntityDiff for the grouped/changed/invalid/signature bag, plus a
// combined applicability (worst status + per-preset reasons).

import { useCallback, useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ParameterPresetApplicabilityResult,
  deriveDraftValuesFromParameterPreset,
  evaluateParameterPresetApplicability
} from '@arduconfig/ardupilot-core'
import type {
  NormalizedFirmwareMetadataBundle,
  NormalizedPresetDefinition,
  PresetGroupDefinition
} from '@arduconfig/param-metadata'

import { selectEntityDiff } from '../selectors/entity-diff'
import {
  evaluatePresetDependencies,
  presetDependencyClass,
  remapPresetSerialPort,
  serialPortIndexOf,
  type PresetDependencyRecord
} from '../view-models/preset-dependencies'
import { USER_PRESET_GROUP, type UserPresetRecord, toPresetDefinition } from '../user-preset-library'

const APPLICABILITY_RANK = { ready: 0, caution: 1, blocked: 2 } as const

/** Chosen target SERIALn index per preset id — see selectedPresetSerialRemap. */
export type PresetSerialRemapTargets = Readonly<Record<string, number>>

export interface PresetSerialRemapState {
  presetId: string
  /** Port the preset's values were captured on. */
  savedPort: number
  /** SERIALn indices this aircraft actually has, ascending. */
  availablePorts: number[]
  /** Currently chosen target (equals savedPort when no remap is active). */
  selectedPort: number
  /** Remapped ids that do not exist on this aircraft — the remap is a no-op for these. */
  missingOnTarget: string[]
}

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
  /** Operator-authored presets from browser storage, merged in as a group. */
  userPresets?: readonly UserPresetRecord[]
  serialRemapTargets?: PresetSerialRemapTargets
}) {
  const { snapshot, metadataCatalog, selectedPresetIds, userPresets, serialRemapTargets } = input

  // Deliberately a linear scan rather than a Map built per snapshot: dependency
  // evaluation reads a handful of named params (MOT_BAT_VOLT_MAX, FRAME_CLASS)
  // and only for presets that declared a dependency, so indexing all ~590
  // parameters on every telemetry tick would cost far more than it saves.
  const readLiveParameter = useCallback(
    (paramId: string) => snapshot.parameters.find((parameter) => parameter.id === paramId)?.value,
    [snapshot.parameters]
  )

  // Dependency answers, keyed by preset id. Only user presets have them —
  // curated bundle presets carry a hand-written `compatibility` block instead.
  const dependenciesByPresetId = useMemo(
    () => new Map((userPresets ?? []).map((record) => [record.id, record.dependencies as readonly PresetDependencyRecord[]])),
    [userPresets]
  )

  /**
   * Present saved presets in the exact shape the curated ones have, so the
   * whole downstream pipeline (diff, applicability, cards, apply) is shared and
   * this feature adds no second code path.
   *
   * The serial remap is applied HERE, before the diff is taken, which is what
   * makes it honest: the operator sees the remapped SERIALn ids in the review
   * list and applies exactly what is on screen.
   *
   * The dependency list deliberately does NOT include anything derived from the
   * live parameters. Everything downstream of `presetDefinitions` — the merged
   * draft values, selectEntityDiff over the whole parameter tree, the draft
   * entry derivation — is memoised on this array's identity, and on main that
   * identity was `metadataCatalog.presets`, i.e. constant across a session. An
   * earlier revision of this feature threaded the aircraft's known param ids in
   * here for the remap's missing-on-target check, which quietly broke that
   * stability and re-ran the whole preset diff pipeline on every telemetry tick.
   * The missing-on-target report lives on `selectedPresetSerialRemap` instead,
   * where it is computed once for the one preset the operator is looking at.
   */
  const userPresetDefinitions = useMemo<NormalizedPresetDefinition[]>(
    () =>
      (userPresets ?? []).map((record, index) => {
        const base = toPresetDefinition(record, index)
        const savedPort = record.dependencies.find((entry) => entry.classId === 'serial-port')?.context?.serialPorts?.[0]
        const targetPort = serialRemapTargets?.[record.id]
        const remap =
          savedPort !== undefined && targetPort !== undefined && targetPort !== savedPort
            ? remapPresetSerialPort(base.values, savedPort, targetPort)
            : undefined

        return {
          ...base,
          values: remap?.values ?? base.values,
          tags: base.tags ?? [],
          groupDefinition: USER_PRESET_GROUP,
          // The dependency labels double as a plain-language contents list on
          // the card ("Serial port position, Battery pack") — cheaper to read
          // than the raw param list and it is the thing that decides whether
          // this preset belongs on this aircraft.
          cautions:
            remap && remap.remapped.length > 0
              ? [`Remapped ${remap.remapped.length} value(s) from SERIAL${savedPort} to SERIAL${targetPort}.`]
              : []
        }
      }),
    [userPresets, serialRemapTargets]
  )

  const presetDefinitions = useMemo(
    () => [...metadataCatalog.presets, ...userPresetDefinitions],
    [metadataCatalog.presets, userPresetDefinitions]
  )
  const presetsByGroup = useMemo<Record<string, readonly NormalizedPresetDefinition[]>>(
    () => ({ ...metadataCatalog.presetsByGroup, [USER_PRESET_GROUP.id]: userPresetDefinitions }),
    [metadataCatalog.presetsByGroup, userPresetDefinitions]
  )
  const presetGroups = useMemo<PresetGroupDefinition[]>(
    () =>
      [...metadataCatalog.presetGroups, USER_PRESET_GROUP]
        .filter((group) => (presetsByGroup[group.id] ?? []).length > 0)
        .sort((left, right) => left.order - right.order),
    [metadataCatalog.presetGroups, presetsByGroup]
  )
  const presetPreviewById = useMemo(
    () =>
      new Map(
        presetDefinitions.map((preset) => {
          const applicability = evaluateParameterPresetApplicability(snapshot, preset)
          const dependencies = dependenciesByPresetId.get(preset.id)
          // Dependency warnings only ever raise 'ready' to 'caution' (see
          // preset-dependencies.ts — they never block), so a curated preset's
          // 'blocked' frame-class verdict still wins.
          const dependencyResult = dependencies?.length ? evaluatePresetDependencies(dependencies, readLiveParameter) : undefined
          return [
            preset.id,
            {
              diff: deriveDraftValuesFromParameterPreset(snapshot.parameters, preset),
              applicability: dependencyResult
                ? {
                    status:
                      APPLICABILITY_RANK[dependencyResult.status] > APPLICABILITY_RANK[applicability.status]
                        ? dependencyResult.status
                        : applicability.status,
                    reasons: [...applicability.reasons, ...dependencyResult.reasons]
                  }
                : applicability
            }
          ]
        })
      ),
    // Deliberately narrow: `snapshot` itself changes on every telemetry tick,
    // and re-diffing every preset at telemetry rate is pure waste. Applicability
    // and the diff read only the parameter list and the vehicle type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presetDefinitions, snapshot.parameters, snapshot.vehicle?.vehicle, dependenciesByPresetId, readLiveParameter]
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

  // The port-remap control only makes sense for ONE user preset at a time: the
  // remap rewrites that preset's own ids, and offering it over a merged
  // multi-preset diff would be ambiguous about which preset's ports move.
  const selectedPresetSerialRemap = useMemo<PresetSerialRemapState | undefined>(() => {
    if (selectedPresets.length !== 1) {
      return undefined
    }
    const preset = selectedPresets[0]
    const savedPort = dependenciesByPresetId
      .get(preset.id)
      ?.find((entry) => entry.classId === 'serial-port')?.context?.serialPorts?.[0]
    if (savedPort === undefined) {
      return undefined
    }
    // Built here and not at hook scope so it costs nothing on the overwhelmingly
    // common path (no user preset selected, or one with no port dependency) —
    // and so it never becomes a per-tick dependency of `presetDefinitions`.
    const knownParamIds = new Set(snapshot.parameters.map((parameter) => parameter.id))
    // Offer only ports this aircraft actually reports, so the operator cannot
    // pick a UART the board does not have.
    const availablePorts = [
      ...new Set(
        [...knownParamIds].map((paramId) => serialPortIndexOf(paramId)).filter((port): port is number => port !== undefined)
      )
    ].sort((left, right) => left - right)
    const selectedPort = serialRemapTargets?.[preset.id] ?? savedPort
    // `preset.values` has ALREADY been remapped above, so the check is simply
    // "which of the remapped ids does this board not have" — re-running the
    // remap here would find nothing left to move and report a falsely clean bill.
    const missingOnTarget =
      selectedPort === savedPort
        ? []
        : preset.values
            .map((entry) => entry.paramId)
            .filter((paramId) => serialPortIndexOf(paramId) === selectedPort && !knownParamIds.has(paramId))
    return { presetId: preset.id, savedPort, availablePorts, selectedPort, missingOnTarget }
  }, [selectedPresets, dependenciesByPresetId, snapshot.parameters, serialRemapTargets])

  /** Plain-language list of what the selected preset declared it depends on. */
  const selectedPresetDependencyLabels = useMemo(
    () =>
      [
        ...new Set(
          selectedPresets.flatMap((preset) =>
            (dependenciesByPresetId.get(preset.id) ?? []).map((entry) => presetDependencyClass(entry.classId).label)
          )
        )
      ],
    [selectedPresets, dependenciesByPresetId]
  )

  return {
    presetDefinitions,
    presetsByGroup,
    presetGroups,
    selectedPresetSerialRemap,
    selectedPresetDependencyLabels,
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
