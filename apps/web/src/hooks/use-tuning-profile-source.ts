// Tuning-profile source-backup builder, lifted out of App.tsx. The
// Snapshots / Provisioning tab's "create tuning profile" workflow needs
// a snapshot-like backup file built from the current FC parameters,
// with an optional override layer of any pending staged tuning edits.
// Three derived values plus a "can create" gate:
//   - tuningProfileSourceBackup       (the ready-to-save backup file)
//   - tuningProfileSourceUsesStaged   (raw mode boolean for UI gating)
//   - tuningProfileSourceHasStagedTuning (any tuning param actually staged?)
//   - canCreateTuningProfile          ('parameters present' AND mode-gate)
//
// Pure behavior-neutral move. The backup body sets exportedAt =
// new Date().toISOString() in the useMemo body, matching the App.tsx
// original — the timestamp refreshes each time the memo recomputes.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ParameterBackupEntry,
  type ParameterBackupFile,
  type ParameterDraftEntry
} from '@arduconfig/ardupilot-core'

import type { TuningProfileSourceMode } from './use-library-forms'
import { selectParameterById } from '../selectors/parameter-read'
import { TUNING_PARAM_IDS } from '../tuning-params'
import { sortTuningBackupEntries } from '../library-helpers'

export interface UseTuningProfileSourceResult {
  tuningProfileSourceBackup: ParameterBackupFile
  tuningProfileSourceUsesStaged: boolean
  tuningProfileSourceHasStagedTuning: boolean
  canCreateTuningProfile: boolean
}

/**
 * Builds the tuning-profile source backup + "can create" gate for the
 * Snapshots/Provisioning library "create tuning profile" form. Inputs
 * are the live snapshot, the parameter-draft Map, and the operator's
 * "live vs staged" radio selection. Outputs are byte-identical to the
 * App.tsx originals.
 */
export function useTuningProfileSource(input: {
  snapshot: ConfiguratorSnapshot
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  tuningProfileSourceInput: TuningProfileSourceMode
}): UseTuningProfileSourceResult {
  const { snapshot, parameterDraftById, tuningProfileSourceInput } = input

  const tuningProfileSourceBackup = useMemo<ParameterBackupFile>(() => {
    const sourceUsesStaged = tuningProfileSourceInput === 'staged'
    const parameterEntries = sortTuningBackupEntries(
      TUNING_PARAM_IDS.reduce<ParameterBackupEntry[]>((entries, paramId) => {
        const parameter = selectParameterById(snapshot, paramId)
        if (!parameter) {
          return entries
        }

        const draft = parameterDraftById.get(paramId)
        const nextValue = sourceUsesStaged && draft?.status === 'staged' && draft.nextValue !== undefined ? draft.nextValue : parameter.value
        entries.push({
          id: parameter.id,
          value: nextValue,
          category: parameter.definition?.category,
          label: parameter.definition?.label,
          unit: parameter.definition?.unit
        })
        return entries
      }, [])
    )

    return {
      schemaVersion: 1 as const,
      application: 'ArduConfigurator' as const,
      firmware: snapshot.vehicle?.vehicle ?? 'Unknown',
      exportedAt: new Date().toISOString(),
      parameterCount: parameterEntries.length,
      vehicle: snapshot.vehicle
        ? {
            firmware: snapshot.vehicle.firmware,
            vehicle: snapshot.vehicle.vehicle,
            systemId: snapshot.vehicle.systemId,
            componentId: snapshot.vehicle.componentId,
            flightMode: snapshot.vehicle.flightMode
          }
        : undefined,
      parameters: parameterEntries
    }
  }, [parameterDraftById, snapshot.parameters, snapshot.vehicle, tuningProfileSourceInput])
  const tuningProfileSourceUsesStaged = tuningProfileSourceInput === 'staged'
  const tuningProfileSourceHasStagedTuning = useMemo(
    () => TUNING_PARAM_IDS.some((paramId) => parameterDraftById.get(paramId)?.status === 'staged'),
    [parameterDraftById]
  )
  const canCreateTuningProfile =
    tuningProfileSourceBackup.parameters.length > 0 &&
    (!tuningProfileSourceUsesStaged || tuningProfileSourceHasStagedTuning)

  return {
    tuningProfileSourceBackup,
    tuningProfileSourceUsesStaged,
    tuningProfileSourceHasStagedTuning,
    canCreateTuningProfile
  }
}
