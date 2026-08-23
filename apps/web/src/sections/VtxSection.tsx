// VtxSection — App.tsx's `activeViewId === 'vtx'` block, lifted into its
// own component. Same pattern as Failsafe/Logs sections: owns the per-view
// derivations (param-id lookups, scalar reads, draft slice) and renders
// VtxView. App.tsx hands in snapshot, draft pool, edit helpers, and the
// list of serial-port view models so we can filter for VTX control ports.

import { formatArducopterVtxEnable } from '@arduconfig/param-metadata'
import type { ConfiguratorSnapshot, ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { VTX_PARAM_IDS } from '../param-groups'
import { isVtxReviewParamId } from '../param-review'
import { readRoundedParameter } from '../selectors/parameter-read'
import { selectViewCatalog } from '../selectors/view-catalog'
import { selectViewDrafts } from '../selectors/view-drafts'
import {
  isAnalogVtxControlSerialProtocol,
  isDigitalVtxSerialProtocol,
  isVtxControlSerialProtocol,
  type SerialPortViewModel
} from '../serial-port-helpers'
import type { UseVtxTableResult } from '../hooks/use-vtx-table'
import { VtxView } from '../views/Vtx'

export interface VtxSectionProps {
  /** The OSD/VTX switcher, rendered under the panel title like every other
   *  view's tab strip. */
  headerNav?: ReactNode
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
  vtxTable: UseVtxTableResult
}

export function VtxSection(props: VtxSectionProps) {
  const {
    headerNav,
    snapshot,
    serialPortViewModels,
    editedValues,
    setDraft,
    parameterDraftEntries,
    parameterDraftById,
    canApplyDraftParameters,
    busyAction,
    onApplyScopedDrafts,
    onDiscardScopedDrafts,
    vtxTable
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
  const vtxTypesParameter = vtxParameterById.get('VTX_TYPES')

  const vtxEnabled = readRoundedParameter(snapshot, 'VTX_ENABLE')
  const vtxFrequency = readRoundedParameter(snapshot, 'VTX_FREQ')
  const vtxPower = readRoundedParameter(snapshot, 'VTX_POWER')
  const vtxMaxPower = readRoundedParameter(snapshot, 'VTX_MAX_POWER')
  const vtxOptions = readRoundedParameter(snapshot, 'VTX_OPTIONS')
  const vtxTypes = readRoundedParameter(snapshot, 'VTX_TYPES')

  const vtxLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isVtxControlSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )

  // For a digital/MSP video system (DJI/HDZero/Walksnail over MSP DisplayPort)
  // the @VTX table is LEARNED — the goggles push their bands/power into the FC
  // over MSP_SET_VTXTABLE_*. We must not author/upload it, so the table renders
  // read-only. An analog VTX-control link (SmartAudio/Tramp/Crossfire) means the
  // operator authors the table, so it wins even alongside an MSP DisplayPort OSD
  // (a common analog-VTX + digital-goggles combo): learned only when a digital
  // VTX link exists AND no analog control link does.
  const vtxTableLearned = useMemo(() => {
    const ports = serialPortViewModels
    const hasDigitalVtx = ports.some((port) => isDigitalVtxSerialProtocol(port.protocolValue))
    const hasAnalogControl = ports.some((port) => isAnalogVtxControlSerialProtocol(port.protocolValue))
    return hasDigitalVtx && !hasAnalogControl
  }, [serialPortViewModels])

  const { entries: vtxDraftEntries, staged: vtxStagedDrafts, invalid: vtxInvalidDrafts } = useMemo(
    () => selectViewDrafts(parameterDraftEntries, isVtxReviewParamId),
    [parameterDraftEntries]
  )

  return (
    <VtxView
      headerNav={headerNav}
      linkPorts={vtxLinkPorts}
      enabledLabel={formatArducopterVtxEnable(vtxEnabled)}
      enableField={vtxEnableParameter ? { parameter: vtxEnableParameter, liveValue: vtxEnabled } : undefined}
      frequencyField={vtxFrequencyParameter ? { parameter: vtxFrequencyParameter, liveValue: vtxFrequency } : undefined}
      powerField={vtxPowerParameter ? { parameter: vtxPowerParameter, liveValue: vtxPower } : undefined}
      maxPowerField={vtxMaxPowerParameter ? { parameter: vtxMaxPowerParameter, liveValue: vtxMaxPower } : undefined}
      optionsField={vtxOptionsParameter ? { parameter: vtxOptionsParameter, liveValue: vtxOptions } : undefined}
      typesField={vtxTypesParameter ? { parameter: vtxTypesParameter, liveValue: vtxTypes } : undefined}
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
      vtxTable={vtxTable}
      tableLearned={vtxTableLearned}
    />
  )
}
