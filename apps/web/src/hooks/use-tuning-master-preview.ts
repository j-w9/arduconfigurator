// Tuning master-slider preview cluster, lifted out of App.tsx. The
// Tuning workbench's "master" rates/PID/filter sliders compose into a
// draft-value preview the operator can stage in one click. Three
// derived values flow from the slider state + the current FC values:
//   - the per-id current value Map (snapshot-or-staged-draft)
//   - the scaled draft-values object the sliders would write
//   - the entries that would actually change (filtered to status==='staged')
// Plus a "defaults active" boolean for the "no changes pending" gate.
//
// Pure behavior-neutral move: useMemo bodies + dep arrays byte-identical
// to the App.tsx originals.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ParameterDraftEntry,
  deriveParameterDraftEntries
} from '@arduconfig/ardupilot-core'

import { selectParameterById } from '../selectors/parameter-read'
import { TUNING_FILTER_PARAM_IDS, TUNING_PARAM_IDS } from '../tuning-params'
import { normalizeTuningNumericValue } from '../tuning-control'

export interface UseTuningMasterPreviewResult {
  tuningMasterPreviewDraftValues: Record<string, string>
  tuningMasterPreviewEntries: ParameterDraftEntry[]
  tuningMasterDefaultsActive: boolean
}

/**
 * Derives the Tuning master-slider preview state (scaled draft values +
 * the entries those drafts would stage + the "no changes" defaults
 * gate). Inputs are the live snapshot, the current parameter-draft Map
 * (so a slider preview composes ON TOP of any pending staged tuning
 * edits), and the 5 master-slider scalars.
 *
 * Outputs are byte-identical to the App.tsx originals.
 */
export function useTuningMasterPreview(input: {
  snapshot: ConfiguratorSnapshot
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  tuningMasterPiGain: number
  tuningMasterDGain: number
  tuningMasterFeedforwardGain: number
  tuningMasterPitchRatio: number
  tuningMasterFilterStrength: number
}): UseTuningMasterPreviewResult {
  const {
    snapshot,
    parameterDraftById,
    tuningMasterPiGain,
    tuningMasterDGain,
    tuningMasterFeedforwardGain,
    tuningMasterPitchRatio,
    tuningMasterFilterStrength
  } = input

  const currentTuningValueById = useMemo(() => {
    const values = new Map<string, number>()
    TUNING_PARAM_IDS.forEach((paramId) => {
      const parameter = selectParameterById(snapshot, paramId)
      if (!parameter) {
        return
      }
      const draft = parameterDraftById.get(parameter.id)
      values.set(parameter.id, draft?.nextValue ?? parameter.value)
    })
    return values
  }, [parameterDraftById, snapshot.parameters])
  const tuningMasterPreviewDraftValues = useMemo(() => {
    const nextDraftValues: Record<string, string> = {}
    const applyScale = (
      paramIds: readonly string[],
      scale: number,
      usePitchRatio = false
    ) => {
      paramIds.forEach((paramId) => {
        const parameter = selectParameterById(snapshot, paramId)
        const currentValue = currentTuningValueById.get(paramId)
        if (!parameter || currentValue === undefined) {
          return
        }

        let effectiveScale = scale
        if (usePitchRatio && paramId.includes('_PIT_')) {
          effectiveScale *= tuningMasterPitchRatio
        }

        const normalizedValue = normalizeTuningNumericValue(parameter, currentValue * effectiveScale)
        nextDraftValues[paramId] = String(normalizedValue)
      })
    }

    applyScale(
      ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_YAW_P', 'ATC_RAT_YAW_I'],
      tuningMasterPiGain,
      true
    )
    applyScale(['ATC_RAT_RLL_D', 'ATC_RAT_PIT_D', 'ATC_RAT_YAW_D'], tuningMasterDGain, true)
    applyScale(['ATC_RAT_RLL_FF', 'ATC_RAT_PIT_FF', 'ATC_RAT_YAW_FF'], tuningMasterFeedforwardGain, true)
    applyScale(TUNING_FILTER_PARAM_IDS, tuningMasterFilterStrength, false)

    return nextDraftValues
  }, [
    currentTuningValueById,
    tuningMasterDGain,
    tuningMasterFeedforwardGain,
    tuningMasterFilterStrength,
    tuningMasterPiGain,
    tuningMasterPitchRatio,
    snapshot.parameters
  ])
  const tuningMasterPreviewEntries = useMemo(
    () => deriveParameterDraftEntries(snapshot.parameters, tuningMasterPreviewDraftValues).filter((entry) => entry.status === 'staged'),
    [snapshot.parameters, tuningMasterPreviewDraftValues]
  )
  const tuningMasterDefaultsActive =
    Math.abs(tuningMasterPiGain - 1) < 0.001 &&
    Math.abs(tuningMasterDGain - 1) < 0.001 &&
    Math.abs(tuningMasterFeedforwardGain - 1) < 0.001 &&
    Math.abs(tuningMasterPitchRatio - 1) < 0.001 &&
    Math.abs(tuningMasterFilterStrength - 1) < 0.001

  return {
    tuningMasterPreviewDraftValues,
    tuningMasterPreviewEntries,
    tuningMasterDefaultsActive
  }
}
