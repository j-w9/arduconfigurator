// VtxSection — App.tsx's `activeViewId === 'vtx'` block, lifted into its
// own component. Same pattern as Failsafe/Logs sections: owns the per-view
// derivations (param-id lookups, scalar reads, draft slice) and renders
// VtxView. App.tsx hands in snapshot, draft pool, edit helpers, and the
// list of serial-port view models so we can filter for VTX control ports.

import { formatArducopterVtxEnable } from '@arduconfig/param-metadata'
import type { ConfiguratorSnapshot, ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { useMemo } from 'react'

import { VTX_PARAM_IDS } from '../param-groups'
import { isVtxReviewParamId } from '../param-review'
import { readRoundedParameter } from '../selectors/parameter-read'
import { selectViewCatalog } from '../selectors/view-catalog'
import { selectViewDrafts } from '../selectors/view-drafts'
import { isVtxControlSerialProtocol, type SerialPortViewModel } from '../serial-port-helpers'
import { VtxView } from '../views/Vtx'

export interface VtxSectionProps {
  snapshot: ConfiguratorSnapshot
  serialPortViewModels: readonly SerialPortViewModel[]
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
  parameterDraftEntries: readonly ParameterDraftEntry[]
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  onApplyScopedDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  onDiscardScopedDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function VtxSection(props: VtxSectionProps) {
  const {
    snapshot,
    serialPortViewModels,
    editedValues,
    setDraft,
    parameterDraftEntries,
    parameterDraftById,
    canApplyDraftParameters,
    busyAction,
    onApplyScopedDrafts,
    onDiscardScopedDrafts
  } = props

  const { byId: vtxParameterById } = useMemo(
    () => selectViewCatalog(snapshot.parameters, VTX_PARAM_IDS),
    [snapshot.parameters]
  )
  const vtxEnableParameter = vtxParameterById.get('VTX_ENABLE')
  const vtxFrequencyParameter = vtxParameterById.get('VTX_FREQ')
  const vtxPowerParameter = vtxParameterById.get('VTX_POWER')
  const vtxMaxPowerParameter = vtxParameterById.get('VTX_MAX_POWER')
  const vtxOptionsParameter = vtxParameterById.get('VTX_OPTIONS')

  const vtxEnabled = readRoundedParameter(snapshot, 'VTX_ENABLE')
  const vtxFrequency = readRoundedParameter(snapshot, 'VTX_FREQ')
  const vtxPower = readRoundedParameter(snapshot, 'VTX_POWER')
  const vtxMaxPower = readRoundedParameter(snapshot, 'VTX_MAX_POWER')
  const vtxOptions = readRoundedParameter(snapshot, 'VTX_OPTIONS')

  const vtxLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isVtxControlSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )

  const { entries: vtxDraftEntries, staged: vtxStagedDrafts, invalid: vtxInvalidDrafts } = useMemo(
    () => selectViewDrafts(parameterDraftEntries, isVtxReviewParamId),
    [parameterDraftEntries]
  )

  return (
    <VtxView
      linkPorts={vtxLinkPorts}
      enabledLabel={formatArducopterVtxEnable(vtxEnabled)}
      enableField={vtxEnableParameter ? { parameter: vtxEnableParameter, liveValue: vtxEnabled } : undefined}
      frequencyField={vtxFrequencyParameter ? { parameter: vtxFrequencyParameter, liveValue: vtxFrequency } : undefined}
      powerField={vtxPowerParameter ? { parameter: vtxPowerParameter, liveValue: vtxPower } : undefined}
      maxPowerField={vtxMaxPowerParameter ? { parameter: vtxMaxPowerParameter, liveValue: vtxMaxPower } : undefined}
      optionsField={vtxOptionsParameter ? { parameter: vtxOptionsParameter, liveValue: vtxOptions } : undefined}
      editedValues={editedValues}
      onEditChange={(paramId, value) => setDraft(paramId, value)}
      draftStatusById={parameterDraftById}
      stagedCount={vtxStagedDrafts.length}
      invalidCount={vtxInvalidDrafts.length}
      draftCount={vtxDraftEntries.length}
      canApply={canApplyDraftParameters}
      isApplying={busyAction === 'vtx:apply'}
      isBusy={busyAction !== undefined}
      onApply={() => void onApplyScopedDrafts(vtxDraftEntries, 'vtx:apply', 'VTX')}
      onRevert={() => onDiscardScopedDrafts(vtxDraftEntries.map((entry) => entry.id), 'VTX')}
    />
  )
}
