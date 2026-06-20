// Receiver "Signal Setup" additional-parameter groups + their draft
// slice, lifted out of App.tsx as a small bounded slice toward a
// ReceiverSection extract. Behavior-neutral move: same
// buildAdditionalSettingsGroups + selectViewDrafts calls + same dep
// arrays, just colocated.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ParameterDraftEntry
} from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'

import { selectViewDrafts } from '../selectors/view-drafts'
import { isReceiverReviewParamId } from '../param-review'
import {
  type AdditionalSettingsGroup,
  buildAdditionalSettingsGroups
} from '../view-models/peripherals'

export interface UseReceiverAdditionalResult {
  receiverAdditionalGroups: AdditionalSettingsGroup[]
  receiverAdditionalDraftEntries: ParameterDraftEntry[]
  receiverAdditionalStagedDrafts: ParameterDraftEntry[]
  receiverAdditionalInvalidDrafts: ParameterDraftEntry[]
}

/**
 * Builds the Receiver "Signal Setup" additional-parameter groups for the
 * current snapshot, then narrows the global draft-entry list to those
 * groups' parameters and splits it into staged + invalid subsets.
 * Outputs are byte-identical to the App.tsx originals.
 */
export function useReceiverAdditional(input: {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  parameterDraftEntries: readonly ParameterDraftEntry[]
}): UseReceiverAdditionalResult {
  const { snapshot, metadataCatalog, parameterDraftEntries } = input

  const receiverAdditionalGroups = useMemo(
    () =>
      buildAdditionalSettingsGroups(
        snapshot,
        metadataCatalog,
        'receiver',
        new Set(snapshot.parameters.filter((parameter) => isReceiverReviewParamId(parameter.id)).map((parameter) => parameter.id))
      ),
    [metadataCatalog, snapshot]
  )
  const {
    entries: receiverAdditionalDraftEntries,
    staged: receiverAdditionalStagedDrafts,
    invalid: receiverAdditionalInvalidDrafts
  } = useMemo(
    () =>
      selectViewDrafts(parameterDraftEntries, (id) =>
        receiverAdditionalGroups.some((group) => group.parameters.some((parameter) => parameter.id === id))
      ),
    [parameterDraftEntries, receiverAdditionalGroups]
  )

  return {
    receiverAdditionalGroups,
    receiverAdditionalDraftEntries,
    receiverAdditionalStagedDrafts,
    receiverAdditionalInvalidDrafts
  }
}
