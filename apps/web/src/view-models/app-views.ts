// App view descriptors (nav badges/tones) for the top-level view switcher.
//
// Part of the App.tsx view-model decomposition. The per-view badge + tone
// list was built inline in a ~260-line useMemo that maps metadataCatalog.appViews
// and switch-derives a status badge from per-view draft counts, exercise
// completion, and live-verification flags. Pure data (no JSX, no handlers), so
// it is lifted verbatim into buildAppViews. App.tsx passes the inputs in and
// keeps the same memo dependency array. Behavior-preserving.

import {
  deriveOutputMappingSummary,
  evaluateParameterPresetApplicability
} from '@arduconfig/ardupilot-core'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { normalizeFirmwareMetadata } from '@arduconfig/param-metadata'
import type { AppViewDescriptor, SetupFlowSectionDescriptor } from '../app-types'
import type { SavedParameterSnapshot } from '../snapshot-library'
import { buildSerialPortViewModels } from '../serial-port-helpers'
import type { ConfigSection } from '../views/Config'

export interface AppViewsInputs {
  completedSetupSectionCount: number
  configInvalidDrafts: ParameterDraftEntry[]
  configSections: readonly ConfigSection[]
  configStagedDrafts: ParameterDraftEntry[]
  configuredOutputs: ReturnType<typeof deriveOutputMappingSummary>['motorOutputs']
  guidedSetupComplete: boolean
  isCopterVehicle: boolean
  isPlaneVehicle: boolean
  isRoverVehicle: boolean
  isSubVehicle: boolean
  metadataCatalog: ReturnType<typeof normalizeFirmwareMetadata>
  osdInvalidDrafts: ParameterDraftEntry[]
  osdLinkPorts: ReturnType<typeof buildSerialPortViewModels>
  osdStagedDrafts: ParameterDraftEntry[]
  outputMapping: ReturnType<typeof deriveOutputMappingSummary>
  planeTuningControlCount: number
  planeTuningInvalidDrafts: ParameterDraftEntry[]
  planeTuningStagedDrafts: ParameterDraftEntry[]
  portsAdditionalInvalidDrafts: ParameterDraftEntry[]
  portsAdditionalStagedDrafts: ParameterDraftEntry[]
  portsInvalidDrafts: ParameterDraftEntry[]
  portsStagedDrafts: ParameterDraftEntry[]
  powerAdditionalInvalidDrafts: ParameterDraftEntry[]
  powerAdditionalStagedDrafts: ParameterDraftEntry[]
  powerInvalidDrafts: ParameterDraftEntry[]
  powerStagedDrafts: ParameterDraftEntry[]
  presetDefinitions: ReturnType<typeof normalizeFirmwareMetadata>['presets']
  receiverAdditionalInvalidDrafts: ParameterDraftEntry[]
  receiverAdditionalStagedDrafts: ParameterDraftEntry[]
  receiverInvalidDrafts: ParameterDraftEntry[]
  receiverStagedDrafts: ParameterDraftEntry[]
  roverTuningControlCount: number
  roverTuningInvalidDrafts: ParameterDraftEntry[]
  roverTuningStagedDrafts: ParameterDraftEntry[]
  savedSnapshots: SavedParameterSnapshot[]
  selectedPresetApplicability: ReturnType<typeof evaluateParameterPresetApplicability>
  selectedPresetChangedEntries: ParameterDraftEntry[]
  selectedPresetInvalidEntries: ParameterDraftEntry[]
  selectedSnapshotChangedEntries: ParameterDraftEntry[]
  selectedSnapshotInvalidEntries: ParameterDraftEntry[]
  serialPortViewModels: ReturnType<typeof buildSerialPortViewModels>
  setupFlowSections: SetupFlowSectionDescriptor[]
  snapshot: ConfiguratorSnapshot
  stagedParameterDrafts: ParameterDraftEntry[]
  subTuningControlCount: number
  subTuningInvalidDrafts: ParameterDraftEntry[]
  subTuningStagedDrafts: ParameterDraftEntry[]
  totalOutputInvalidDrafts: number
  totalOutputStagedDrafts: number
  tuningInvalidDrafts: ParameterDraftEntry[]
  tuningParameters: ParameterState[]
  tuningStagedDrafts: ParameterDraftEntry[]
  vtxInvalidDrafts: ParameterDraftEntry[]
  vtxLinkPorts: ReturnType<typeof buildSerialPortViewModels>
  vtxStagedDrafts: ParameterDraftEntry[]
}

export function buildAppViews(inputs: AppViewsInputs): AppViewDescriptor[] {
  const {
    completedSetupSectionCount,
    configInvalidDrafts,
    configSections,
    configStagedDrafts,
    configuredOutputs,
    guidedSetupComplete,
    isCopterVehicle,
    isPlaneVehicle,
    isRoverVehicle,
    isSubVehicle,
    metadataCatalog,
    osdInvalidDrafts,
    osdLinkPorts,
    osdStagedDrafts,
    outputMapping,
    planeTuningControlCount,
    planeTuningInvalidDrafts,
    planeTuningStagedDrafts,
    portsAdditionalInvalidDrafts,
    portsAdditionalStagedDrafts,
    portsInvalidDrafts,
    portsStagedDrafts,
    powerAdditionalInvalidDrafts,
    powerAdditionalStagedDrafts,
    powerInvalidDrafts,
    powerStagedDrafts,
    presetDefinitions,
    receiverAdditionalInvalidDrafts,
    receiverAdditionalStagedDrafts,
    receiverInvalidDrafts,
    receiverStagedDrafts,
    roverTuningControlCount,
    roverTuningInvalidDrafts,
    roverTuningStagedDrafts,
    savedSnapshots,
    selectedPresetApplicability,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    selectedSnapshotChangedEntries,
    selectedSnapshotInvalidEntries,
    serialPortViewModels,
    setupFlowSections,
    snapshot,
    stagedParameterDrafts,
    subTuningControlCount,
    subTuningInvalidDrafts,
    subTuningStagedDrafts,
    totalOutputInvalidDrafts,
    totalOutputStagedDrafts,
    tuningInvalidDrafts,
    tuningParameters,
    tuningStagedDrafts,
    vtxInvalidDrafts,
    vtxLinkPorts,
    vtxStagedDrafts,
  } = inputs

  return metadataCatalog.appViews.map((view) => {
        switch (view.id) {
          case 'setup':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: `${completedSetupSectionCount}/${setupFlowSections.length || 0}`,
              tone: guidedSetupComplete ? 'success' : 'warning'
            }
          case 'receiver':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                receiverInvalidDrafts.length + receiverAdditionalInvalidDrafts.length > 0
                  ? `${receiverInvalidDrafts.length + receiverAdditionalInvalidDrafts.length} invalid`
                  : receiverStagedDrafts.length + receiverAdditionalStagedDrafts.length > 0
                    ? `${receiverStagedDrafts.length + receiverAdditionalStagedDrafts.length} staged`
                    : snapshot.liveVerification.rcInput.verified
                      ? 'live'
                      : 'pending',
              tone:
                receiverInvalidDrafts.length + receiverAdditionalInvalidDrafts.length > 0
                  ? 'danger'
                  : receiverStagedDrafts.length + receiverAdditionalStagedDrafts.length > 0
                    ? 'warning'
                    : snapshot.liveVerification.rcInput.verified
                      ? 'success'
                      : 'warning'
            }
          case 'ports':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                portsStagedDrafts.length + portsAdditionalStagedDrafts.length > 0
                  ? `${portsStagedDrafts.length + portsAdditionalStagedDrafts.length} staged`
                  : `${serialPortViewModels.length} ports`,
              tone:
                portsInvalidDrafts.length + portsAdditionalInvalidDrafts.length > 0
                  ? 'danger'
                  : portsStagedDrafts.length + portsAdditionalStagedDrafts.length > 0
                    ? 'warning'
                    : 'neutral'
            }
          case 'vtx':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                vtxInvalidDrafts.length > 0
                  ? `${vtxInvalidDrafts.length} invalid`
                  : vtxStagedDrafts.length > 0
                    ? `${vtxStagedDrafts.length} staged`
                    : vtxLinkPorts.length > 0
                      ? `${vtxLinkPorts.length} linked`
                      : 'ready',
              tone: vtxInvalidDrafts.length > 0 ? 'danger' : vtxStagedDrafts.length > 0 ? 'warning' : 'neutral'
            }
          case 'osd':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                osdInvalidDrafts.length > 0
                  ? `${osdInvalidDrafts.length} invalid`
                  : osdStagedDrafts.length > 0
                    ? `${osdStagedDrafts.length} staged`
                    : osdLinkPorts.length > 0
                      ? `${osdLinkPorts.length} linked`
                      : 'ready',
              tone: osdInvalidDrafts.length > 0 ? 'danger' : osdStagedDrafts.length > 0 ? 'warning' : 'neutral'
            }
          case 'motors':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                totalOutputInvalidDrafts > 0
                  ? `${totalOutputInvalidDrafts} invalid`
                  : totalOutputStagedDrafts > 0
                    ? `${totalOutputStagedDrafts} staged`
                    : isCopterVehicle
                      ? `${outputMapping.motorOutputs.length} motors`
                      : `${configuredOutputs.length} outputs`,
              tone:
                totalOutputInvalidDrafts > 0
                  ? 'danger'
                  : totalOutputStagedDrafts > 0
                    ? 'warning'
                    : outputMapping.motorOutputs.length > 0
                      ? 'neutral'
                      : 'warning'
            }
          case 'servos':
            // Servos tab badge surfaces auxiliary servo output count so
            // operators see at-a-glance how many aux roles are wired up.
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: `${outputMapping.configuredAuxOutputs.length} aux`,
              tone: outputMapping.configuredAuxOutputs.length > 0 ? 'neutral' : 'warning'
            }
          case 'power':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                powerInvalidDrafts.length + powerAdditionalInvalidDrafts.length > 0
                  ? `${powerInvalidDrafts.length + powerAdditionalInvalidDrafts.length} invalid`
                  : powerStagedDrafts.length + powerAdditionalStagedDrafts.length > 0
                    ? `${powerStagedDrafts.length + powerAdditionalStagedDrafts.length} staged`
                    : snapshot.preArmStatus.healthy
                      ? 'clear'
                      : `${snapshot.preArmStatus.issues.length} issues`,
              tone:
                powerInvalidDrafts.length + powerAdditionalInvalidDrafts.length > 0
                  ? 'danger'
                  : powerStagedDrafts.length + powerAdditionalStagedDrafts.length > 0
                    ? 'warning'
                    : snapshot.preArmStatus.healthy
                      ? 'success'
                      : 'warning'
            }
          case 'snapshots':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: selectedSnapshotChangedEntries.length > 0 ? `${selectedSnapshotChangedEntries.length} diff` : `${savedSnapshots.length} saved`,
              tone: selectedSnapshotInvalidEntries.length > 0 ? 'danger' : selectedSnapshotChangedEntries.length > 0 ? 'warning' : 'neutral'
            }
          case 'tuning':
            // ArduPlane has its own curated Tuning surface (TuningPlaneSection)
            // with the same staged-draft machinery, so it advertises a real
            // staged / control count.
            if (isPlaneVehicle) {
              return {
                id: view.id,
                label: view.label,
                description: view.description,
                badge:
                  planeTuningStagedDrafts.length > 0
                    ? `${planeTuningStagedDrafts.length} staged`
                    : `${planeTuningControlCount} controls`,
                tone:
                  planeTuningInvalidDrafts.length > 0
                    ? 'danger'
                    : planeTuningStagedDrafts.length > 0
                      ? 'warning'
                      : 'neutral'
              }
            }
            // ArduRover has its own curated Tuning surface (TuningRoverSection)
            // with the same staged-draft machinery, so it advertises a real
            // staged / control count.
            if (isRoverVehicle) {
              return {
                id: view.id,
                label: view.label,
                description: view.description,
                badge:
                  roverTuningStagedDrafts.length > 0
                    ? `${roverTuningStagedDrafts.length} staged`
                    : `${roverTuningControlCount} controls`,
                tone:
                  roverTuningInvalidDrafts.length > 0
                    ? 'danger'
                    : roverTuningStagedDrafts.length > 0
                      ? 'warning'
                      : 'neutral'
              }
            }
            // ArduSub has its own curated Tuning surface (TuningSubSection)
            // with the same staged-draft machinery, so it advertises a real
            // staged / control count.
            if (isSubVehicle) {
              return {
                id: view.id,
                label: view.label,
                description: view.description,
                badge:
                  subTuningStagedDrafts.length > 0
                    ? `${subTuningStagedDrafts.length} staged`
                    : `${subTuningControlCount} controls`,
                tone:
                  subTuningInvalidDrafts.length > 0
                    ? 'danger'
                    : subTuningStagedDrafts.length > 0
                      ? 'warning'
                      : 'neutral'
              }
            }
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: tuningStagedDrafts.length > 0 ? `${tuningStagedDrafts.length} staged` : `${tuningParameters.length} controls`,
              tone: tuningInvalidDrafts.length > 0 ? 'danger' : tuningStagedDrafts.length > 0 ? 'warning' : 'neutral'
            }
          case 'presets':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                selectedPresetInvalidEntries.length > 0
                  ? `${selectedPresetInvalidEntries.length} invalid`
                  : selectedPresetChangedEntries.length > 0
                    ? `${selectedPresetChangedEntries.length} diff`
                    : `${presetDefinitions.length} presets`,
              tone:
                selectedPresetApplicability.status === 'blocked'
                  ? 'danger'
                  : selectedPresetApplicability.status === 'caution' || selectedPresetChangedEntries.length > 0
                    ? 'warning'
                    : 'neutral'
            }
          case 'parameters':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: stagedParameterDrafts.length > 0 ? `${stagedParameterDrafts.length} staged` : `${snapshot.parameters.length}`,
              tone: stagedParameterDrafts.length > 0 ? 'warning' : 'neutral'
            }
          case 'config':
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge:
                configInvalidDrafts.length > 0
                  ? `${configInvalidDrafts.length} invalid`
                  : configStagedDrafts.length > 0
                    ? `${configStagedDrafts.length} staged`
                    : `${configSections.length} sections`,
              tone:
                configInvalidDrafts.length > 0
                  ? 'danger'
                  : configStagedDrafts.length > 0
                    ? 'warning'
                    : 'neutral'
            }
          default:
            return {
              id: view.id,
              label: view.label,
              description: view.description,
              badge: '',
              tone: 'neutral'
            }
        }
  })
}

