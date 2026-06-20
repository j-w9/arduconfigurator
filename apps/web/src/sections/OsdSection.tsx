// OsdSection — App.tsx's `activeViewId === 'osd'` block, lifted into its
// own component. The useOsdEditor state (activeOsdScreen, copied layout,
// etc.) STAYS in App.tsx and is threaded in so it persists across view
// switches. The section owns the draft slice + the OsdView render.

import { ARDUCOPTER_MSP_OPTION_BIT_LABELS, formatArducopterMspOsdCellCount, formatArducopterOsdSwitchMethod, formatArducopterOsdType } from '@arduconfig/param-metadata'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { useMemo } from 'react'

import type { UseOsdEditorResult } from '../hooks/use-osd-editor'
import { isOsdReviewParamId } from '../param-review'
import { normalizeBitmaskValue } from '../parameter-format'
import { readRoundedParameter } from '../selectors/parameter-read'
import { selectViewDrafts } from '../selectors/view-drafts'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { isOsdSerialProtocol, type SerialPortViewModel } from '../serial-port-helpers'
import { OsdView } from '../views/Osd'

export interface OsdSectionProps {
  snapshot: ConfiguratorSnapshot
  osdParameterById: ReadonlyMap<string, ParameterState>
  serialPortViewModels: readonly SerialPortViewModel[]
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
  updateDrafts: (mutator: (existing: Record<string, string>) => Record<string, string>) => void
  parameterDraftEntries: readonly ParameterDraftEntry[]
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  osdEditor: UseOsdEditorResult
  onApplyScopedDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  onDiscardScopedDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function OsdSection(props: OsdSectionProps) {
  const {
    snapshot,
    osdParameterById,
    serialPortViewModels,
    editedValues,
    setDraft,
    updateDrafts,
    parameterDraftEntries,
    parameterDraftById,
    canApplyDraftParameters,
    busyAction,
    osdEditor,
    onApplyScopedDrafts,
    onDiscardScopedDrafts
  } = props

  const osdType = readRoundedParameter(snapshot, 'OSD_TYPE')
  const osdChannel = readRoundedParameter(snapshot, 'OSD_CHAN')
  const osdSwitchMethod = readRoundedParameter(snapshot, 'OSD_SW_METHOD')
  const mspOptions = readRoundedParameter(snapshot, 'MSP_OPTIONS')
  const mspOsdCellCount = readRoundedParameter(snapshot, 'MSP_OSD_NCELLS')

  const osdTypeParameter = osdParameterById.get('OSD_TYPE')
  const osdChannelParameter = osdParameterById.get('OSD_CHAN')
  const osdSwitchMethodParameter = osdParameterById.get('OSD_SW_METHOD')
  const mspOptionsParameter = osdParameterById.get('MSP_OPTIONS')
  const mspOsdCellCountParameter = osdParameterById.get('MSP_OSD_NCELLS')

  const editedMspOptions = normalizeBitmaskValue(editedValues.MSP_OPTIONS, mspOptions)

  const osdLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isOsdSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )

  const { entries: osdDraftEntries, staged: osdStagedDrafts, invalid: osdInvalidDrafts } = useMemo(
    () => selectViewDrafts(parameterDraftEntries, isOsdReviewParamId),
    [parameterDraftEntries]
  )

  return (
    <OsdView
      linkPorts={osdLinkPorts}
      typeField={osdTypeParameter ? { parameter: osdTypeParameter, liveValue: osdType } : undefined}
      channelField={osdChannelParameter ? { parameter: osdChannelParameter, liveValue: osdChannel } : undefined}
      switchMethodField={osdSwitchMethodParameter ? { parameter: osdSwitchMethodParameter, liveValue: osdSwitchMethod } : undefined}
      previewToolbar={{
        backendText: `Backend ${formatArducopterOsdType(osdType)}`,
        switchingText: `Switching ${formatArducopterOsdSwitchMethod(osdSwitchMethod)}`,
        cellsText: `Cells ${formatArducopterMspOsdCellCount(mspOsdCellCount)}`
      }}
      previewElements={osdEditor.osdPreviewElements}
      elementMatrix={osdEditor.osdElementMatrix}
      onElementMove={osdEditor.handleOsdElementMove}
      activeScreen={osdEditor.activeOsdScreen}
      onSelectScreen={osdEditor.setActiveOsdScreen}
      onCopyLayout={osdEditor.handleCopyOsdLayout}
      onPasteLayout={osdEditor.handlePasteOsdLayout}
      canPasteLayout={osdEditor.copiedOsdLayout !== undefined}
      pasteSourceScreen={osdEditor.copiedOsdLayout?.sourceScreen}
      screenOptionFields={osdEditor.osdScreenOptionFields}
      screenEnableEntries={osdEditor.osdScreenEnableEntries}
      mspConfigPills={(() => {
        const pills: string[] = osdLinkPorts.map((port) => `${port.label}: ${port.protocolLabel}`)
        if (mspOptionsParameter) {
          pills.push(`MSP options: ${describeBitmaskSelections(mspOptions, ARDUCOPTER_MSP_OPTION_BIT_LABELS, 'No special options')}`)
        }
        return pills
      })()}
      cellCountField={mspOsdCellCountParameter ? { parameter: mspOsdCellCountParameter, liveValue: mspOsdCellCount } : undefined}
      mspOptionsField={mspOptionsParameter ? {
        parameter: mspOptionsParameter,
        bits: Object.entries(ARDUCOPTER_MSP_OPTION_BIT_LABELS).map(([bitString, label]) => {
          const bit = Number(bitString)
          return { bit, label, isChecked: hasBitmaskFlag(editedMspOptions, bit) }
        }),
        captionText: (() => {
          const draft = parameterDraftById.get(mspOptionsParameter.id)
          if (draft?.status === 'staged') {
            return `Staged ${describeBitmaskSelections(draft.nextValue, ARDUCOPTER_MSP_OPTION_BIT_LABELS, 'No special options')}`
          }
          return draft?.reason ?? `Current ${describeBitmaskSelections(mspOptions, ARDUCOPTER_MSP_OPTION_BIT_LABELS, 'No special options')}`
        })(),
        onToggleBit: (bit, on) => {
          updateDrafts((existing) => {
            const currentValue = normalizeBitmaskValue(existing[mspOptionsParameter.id], mspOptions)
            const nextValue = toggleBitmaskFlag(currentValue, bit, on)
            return { ...existing, [mspOptionsParameter.id]: String(nextValue) }
          })
        }
      } : undefined}
      editedValues={editedValues}
      onEditChange={(paramId, value) => setDraft(paramId, value)}
      draftStatusById={parameterDraftById}
      stagedCount={osdStagedDrafts.length}
      invalidCount={osdInvalidDrafts.length}
      draftCount={osdDraftEntries.length}
      canApply={canApplyDraftParameters}
      isApplying={busyAction === 'osd:apply'}
      isBusy={busyAction !== undefined}
      onApply={() => void onApplyScopedDrafts(osdDraftEntries, 'osd:apply', 'OSD')}
      onRevert={() => onDiscardScopedDrafts(osdDraftEntries.map((entry) => entry.id), 'OSD')}
    />
  )
}
