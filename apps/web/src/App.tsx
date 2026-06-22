import type { ReactElement, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS,
  MAX_MOTOR_TEST_DURATION_SECONDS,
  MAX_MOTOR_TEST_THROTTLE_PERCENT,
  advanceModeSwitchExerciseState,
  advanceRcRangeExerciseState,
  createParameterBackup,
  createIdleModeSwitchExerciseState,
  createIdleRcRangeExerciseState,
  createModeSwitchExerciseState,
  createRcRangeExerciseState,
  deriveCompassSetupAvailability,
  deriveEscSetupSummary,
  buildParametersFromBackup,
  deriveAirframe,
  deriveModeExerciseAssignments,
  deriveModeAssignments,
  deriveModeSwitchEstimate,
  deriveOutputMappingSummary,
  deriveProvisioningProfileBackup,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations,
  deriveRcMapDraftValues,
  evaluateMotorTestEligibility,
  motorTestGuardReasons as computeMotorTestGuardReasons,
  completeModeSwitchExerciseState,
  failRcRangeExerciseState,
  formatRcAxisLabel,
  type MotorTestRequest,
  type ParameterBackupFile,
  type ParameterDraftEntry,
  type ParameterImportCategory,
  type ParameterState,
  type RcAxisId,
  type RcMappingCandidate,
} from '@arduconfig/ardupilot-core'
import {
  arducopterMetadata,
  arduplaneMetadata,
  arduroverMetadata,
  ardusubMetadata,
  findBoardCatalogEntry,
  normalizeFirmwareMetadata,
  mergeUpstreamParameters,
  type AppViewId,
  type UpstreamParameterMap,
} from '@arduconfig/param-metadata'
import { loadUpstreamParameters } from './generated/param-upstream'
import {
  WebSerialTransport,
  getAvailableWebSerialPorts,
  getWebSerialPortInfo,
  type WebSerialPortLike,
} from '@arduconfig/transport'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { describeConnectionError } from './connection-error-help'
import { getDesktopBridge } from './desktop-bridge'
import { createRuntime } from './runtime-factory'
import { useOsdEditor } from './hooks/use-osd-editor'
import { useBoardMediaPicker } from './hooks/use-board-media-picker'
import { useRcMixer } from './hooks/use-rc-mixer'
import { useCalibrationNotices } from './hooks/use-calibration-notices'
import { useLibraryNotices } from './hooks/use-library-notices'
import { useSafetyAcks } from './hooks/use-safety-acks'
import { useSetupWizard } from './hooks/use-setup-wizard'
import { useTuningWorkbench } from './hooks/use-tuning-workbench'
import { usePortsView } from './hooks/use-ports-view'
import { useRcExercises } from './hooks/use-rc-exercises'
import { useMotorManagement } from './hooks/use-motor-management'
import { useMotorTestConfig } from './hooks/use-motor-test-config'
import { useSetupExercises } from './hooks/use-setup-exercises'
import { useViewTaskOverrides } from './hooks/use-view-task-overrides'
import { useReceiverDetailToggles } from './hooks/use-receiver-detail-toggles'
import { usePresetCatalog } from './hooks/use-preset-catalog'
import { useSerialPortModels } from './hooks/use-serial-port-models'
import { useMotorOutputAssignments } from './hooks/use-motor-output-assignments'
import { useConfigSections } from './hooks/use-config-sections'
import { useViewDraftSelectors } from './hooks/use-view-draft-selectors'
import { useParameterDraftDerivations } from './hooks/use-parameter-draft-derivations'
import { useOutputAssignmentVisibility } from './hooks/use-output-assignment-visibility'
import { trackAppEvent, trackViewPageview } from './analytics'
import { assetUrl } from './asset-url'
import { GIT_HASH, GIT_BRANCH } from './build-info'
import {
  TUNING_ALL_PID_PARAM_IDS,
  TUNING_FILTER_PARAM_IDS,
  TUNING_PLANE_PARAM_IDS,
  TUNING_ROVER_PARAM_IDS,
  TUNING_SUB_PARAM_IDS,
} from './tuning-params'
import {
  OUTPUT_REVIEW_PARAM_IDS,
  OUTPUT_NOTIFICATION_PARAM_IDS
} from './param-groups'
import { AttitudePreview } from './preview-components'
import {
  formatParameterSync,
  formatRcLink,
  formatStatHours,
  formatBatteryTelemetry,
  formatDegreeTelemetry,
  formatHeadingTelemetry,
  formatVehicleSystemStatus
} from './status-formatters'
import {
  formatParameterDraftValue,
  formatParameterDisplayValue,
  normalizeBitmaskValue
} from './parameter-format'
import {
  isPortsReviewParamId,
  isPowerReviewParamId,
  isOutputAssignmentParamId,
} from './param-review'
import {
  isNotificationLedServoFunction,
} from './serial-port-helpers'
import {
  batteryHealthTone,
  batteryHealthLabel,
  describeBatteryMonitor,
  formatVoltage,
  formatCurrent,
  formatRemaining
} from './device-display'
import { buildRcChannelDisplays } from './rc-channel-helpers'
import {
  connectButtonLabel,
  describeConnectFailure,
  isStaleSerialHandleError,
  describeRememberedSerialPort
} from './connection-helpers'
import { canApplyParameterChanges, parameterApplyBlockedReason } from './apply-gate'
import { ALL_MOTOR_TEST_OUTPUT, ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS, buildMotorTestRequest } from './motor-test-helpers'
import { isExpertOnlyView, readGuidedSetupShortcutSectionId } from './guided-setup-shortcut'
import { actionLabels, type GuidedActionId } from './guided-action-labels'
import {
  canRunGuidedAction
} from './guided-action-helpers'
import {
  toneForConnection,
  toneForSetup,
  toneForModeSwitchExercise,
  toneForParameterDraftStatus,
  toneForScopedDraftReview
} from './tone-helpers'
import {
  ORIENTATION_EXERCISE_ORDER,
  RC_CALIBRATION_AXIS_ORDER,
  createIdleOrientationExerciseState,
  createOrientationExerciseState,
  advanceOrientationExerciseState,
  failOrientationExerciseState,
  orientationStepLabel,
  createIdleMotorVerificationState,
  createIdleRcCalibrationSessionState,
  createIdleRcMappingSessionState,
  createRcMappingSessionState,
  rcMappingTargetPrompt,
  failRcMappingSessionState,
  rcCalibrationCaptureComplete,
  RC_MAPPING_AUTO_CAPTURE_MS
} from './setup-exercise-helpers'
import { useModeSwitchDerivations } from './hooks/use-mode-switch-derivations'
import { useMotorReorder } from './hooks/use-motor-reorder'
import { useMotorVerificationDerivations } from './hooks/use-motor-verification-derivations'
import { useOrientationDerivations } from './hooks/use-orientation-derivations'
import { useRcCalibrationDerivations } from './hooks/use-rc-calibration-derivations'
import { useRcMappingDerivations } from './hooks/use-rc-mapping-derivations'
import { useRcRangeDerivations } from './hooks/use-rc-range-derivations'
import { useAdditionalScope } from './hooks/use-additional-scope'
import { useGpsCatalog } from './hooks/use-gps-catalog'
import { useOsdCatalog } from './hooks/use-osd-catalog'
import { useOutputNotificationCatalog } from './hooks/use-output-notification-catalog'
import { usePowerReviewCatalog } from './hooks/use-power-review-catalog'
import { useVtxCatalog } from './hooks/use-vtx-catalog'
import { useReceiverAdditional } from './hooks/use-receiver-additional'
import { useReceiverChannelDisplays } from './hooks/use-receiver-channel-displays'
import { useReceiverSupportCatalog } from './hooks/use-receiver-support-catalog'
import { useSelectedProfileDiff } from './hooks/use-selected-profile-diff'
import { useTuningCatalog } from './hooks/use-tuning-catalog'
import { useTuningMasterPreview } from './hooks/use-tuning-master-preview'
import { useTuningProfileSource } from './hooks/use-tuning-profile-source'
import { useReceiverTasks } from './hooks/use-receiver-tasks'
import {
  linkedTuningCounterpartId,
  buildPresetAutoBackupLabel,
  buildPresetAutoBackupNote,
  deriveProvisioningOverlayParametersFromDrafts,
} from './library-helpers'
import {
  tuningInputValue,
  applyTuningEditedValue,
  tuningNumericValue,
  tuningControlBounds,
  formatTuningDisplayValue,
  TuningControl
} from './tuning-control'
import {
  missionTitleForView
} from './setup-format-helpers'
import {
  appViewForPanel,
  OUTPUTS_ORIENTATION_TARGET_ID,
  OUTPUTS_ORIENTATION_BUTTON_ID,
  OUTPUTS_BENCH_TARGET_ID,
  OUTPUTS_MOTOR_START_BUTTON_ID,
  OUTPUTS_MOTOR_TEST_BUTTON_ID,
  OUTPUTS_MOTOR_CONFIRM_BUTTON_ID,
  SETUP_WIZARD_PRIMARY_ACTION_ID
} from './setup-flow-helpers'
import {
  collectTerminalSetupExercises,
  deriveSetupProgressKey,
  loadStoredSetupProgress,
  saveStoredSetupProgress
} from './setup-progress-storage'
import {
  formatModeAssignment,
  MODES_SLOT_DEFINITIONS,
  modeSlotParamId,
} from './modes-failsafe-helpers'
import type {
  OutputTaskId,
  AppViewDescriptor,
  RcCalibrationAxisCapture,
  RcMappingAxisCapture,
  SetupConfirmationRecord,
  SetupSectionOutcome,
  SetupFlowActionDescriptor,
  SetupFlowSectionDescriptor,
  SetupFlowFollowUpDescriptor
} from './app-types'
import { createMotorPreviewNodes } from './view-models/motor-preview'
import { invertGuidedReorderMapping, pickedReorderPositions } from './view-models/motor-reorder-mapping'
import { LiveGpsMapCard } from './live-gps-map'
import { DisconnectedLanding } from './disconnected-landing'
import { FirmwareFlasher } from './firmware/FirmwareFlasher'
import { ScopedField, ScopedSelectField } from './views/ScopedField'
import { ModesView } from './views/Modes'
import { FailsafeSection } from './sections/FailsafeSection'
import { LogsSection } from './sections/LogsSection'
import { CalibrationSection } from './sections/CalibrationSection'
import { OsdSection } from './sections/OsdSection'
import { OutputsSection } from './sections/OutputsSection'
import { ParametersSection } from './sections/ParametersSection'
import { PortsSection } from './sections/PortsSection'
import { PresetsSection } from './sections/PresetsSection'
import { ReceiverSection } from './sections/ReceiverSection'
import { SnapshotsSection } from './sections/SnapshotsSection'
import { TuningCopterSection } from './sections/TuningCopterSection'
import { AutotuneCopterSection } from './sections/AutotuneCopterSection'
import { AutotunePlaneSection } from './sections/AutotunePlaneSection'
import { PlaneSoaringAdsbSection } from './sections/PlaneSoaringAdsbSection'
import { TuningPlaneSection } from './sections/TuningPlaneSection'
import { TuningRoverSection } from './sections/TuningRoverSection'
import { TuningSubSection } from './sections/TuningSubSection'
import { VtxSection } from './sections/VtxSection'
import { PowerView, type PowerDraftItem, type PowerFieldSpec } from './views/Power'
import { CanBusView } from './views/CanBus'
import { RcMixerView } from './views/RcMixer'
import { buildServoFunctionMappingRows } from './view-models/servo-function-mapping'
import { buildFilteredParameters } from './view-models/filtered-parameters'
import { buildOutputReviewDraftSummaries, type OutputReviewDraftSummary } from './view-models/output-review-draft-summaries'
import { buildAppViews } from './view-models/app-views'
import { buildVisibleAppViews } from './view-models/visible-app-views'
import { AdditionalSettingsCard } from './sections/AdditionalSettingsCard'
import { AppHeader } from './sections/AppHeader'
import { ParameterDraftBar } from './sections/ParameterDraftBar'
import { WorkspaceSidebar } from './sections/WorkspaceSidebar'
import { WorkspaceNotes } from './sections/WorkspaceNotes'
import { MotorReorderDialog } from './sections/MotorReorderDialog'
import { SetupWizardAside } from './sections/SetupWizardAside'
import { SetupWizardHeader } from './sections/SetupWizardHeader'
import { SetupWizardDetail } from './sections/SetupWizardDetail'
import { SetupBenchActions } from './sections/SetupBenchActions'
import { StatusDfuCard } from './sections/StatusDfuCard'
import { buildSetupConfirmationSignatures } from './view-models/setup-confirmation-signatures'
import { buildTuningTaskCards } from './view-models/tuning-task-cards'
import { buildOutputTaskCards, recommendOutputTaskId, type OutputTaskCard } from './view-models/output-task-cards'
import { buildSetupFlowSections } from './view-models/setup-flow-sections'
import { buildGuidedSetupOverview } from './view-models/guided-setup-overview'
import { buildVehicleOutputSummary } from './view-models/vehicle-output-summary'
import { ConfigView } from './views/Config'
import { FilesView } from './views/Files'
import { SetupView } from './views/Setup'
import type { TuningTaskCard } from './views/Tuning'
import { useRuntimeSnapshot } from './hooks/use-runtime-snapshot'
import { useMavftpBrowser } from './hooks/use-mavftp-browser'
import { useOnboardLogs } from './hooks/use-onboard-logs'
import { useProductMode } from './hooks/use-product-mode'
import { useGpsCoordFormat } from './hooks/use-gps-coord-format'
import {
  formatLatitudeDecimal,
  formatLongitudeDecimal,
  formatLatitudeDms,
  formatLongitudeDms,
  formatMgrs,
  GPS_COORD_FORMAT_LABELS,
  GPS_COORD_FORMAT_VALUES,
  type GpsCoordFormat
} from './gps-coord-format'
import {
  useTransportSelection,
  DEFAULT_WEBSOCKET_URL,
  DEFAULT_UDP_TARGET,
  DEFAULT_TCP_TARGET,
  udpSupported,
  tcpSupported
} from './hooks/use-transport-selection'
import { useLibraries } from './hooks/use-libraries'
import { useParameterDrafts } from './hooks/use-parameter-drafts'
import { useTuningProfiles } from './hooks/use-tuning-profiles'
import { useParameterBackupIo } from './hooks/use-parameter-backup-io'
import { useSnapshotLibrary } from './hooks/use-snapshot-library'
import { useProvisioningProfiles } from './hooks/use-provisioning-profiles'
import {
  useParameterFeedback,
  type ParameterNotice
} from './hooks/use-parameter-feedback'
import { useLibraryForms } from './hooks/use-library-forms'
import { readParameterValue, readRoundedParameter, selectParameterById } from './selectors/parameter-read'
import {
  buildCanNodePeripheralViewModels,
  buildGpsPeripheralViewModels,
  type AdditionalSettingsGroup
} from './view-models/peripherals'
import { RC_MIXER_FUNCTION_CATALOG } from './view-models/rc-mixer'
import { type StatusTone } from './status-tone'
import {
  createSavedSnapshot,
  type SavedParameterSnapshot,
} from './snapshot-library'
import {
  type SavedTuningProfile,
} from './tuning-profile-library'
import { useServiceWorkerUpdate } from './sw-update'

const UI_PARAMETER_WRITE_OPTIONS = {
  verifyTimeoutMs: 15000
} as const

const PRESET_AUTO_BACKUP_TAGS = ['auto-backup', 'preset'] as const

// 900ms felt "too fast" — the channel locked before the operator had fully
// exercised the stick — so require a longer, more deliberate sustained
// movement, with a slightly roomier gap tolerance so a brief stick pause
// doesn't reset progress. The window itself (RC_MAPPING_AUTO_CAPTURE_MS) now
// lives in setup-exercise-helpers so the rcMapping derivations hook can read
// the same value without going through App.tsx.
const RC_MAPPING_AUTO_CAPTURE_TICK_MS = 80
const RC_MAPPING_AUTO_CAPTURE_GAP_TOLERANCE_MS = 450

// Stable extractors for useSelectedProfileDiff. The hook uses these as
// useMemo deps, so they must be stable function references; a fresh
// inline arrow on each render would defeat memoization.
function resolveSnapshotBackup(profile: SavedParameterSnapshot): ParameterBackupFile {
  return profile.backup
}
function resolveTuningProfileBackup(profile: SavedTuningProfile): ParameterBackupFile {
  return profile.backup
}

// Module-level predicate so useAdditionalScope's groups memo can use it
// as a stable function reference (recomputes only on snapshot changes,
// matching the original inline-arrow behavior in App.tsx).
function isOutputAdditionalExcludedParamId(parameterId: string): boolean {
  return (
    isOutputAssignmentParamId(parameterId) ||
    OUTPUT_REVIEW_PARAM_IDS.includes(parameterId as (typeof OUTPUT_REVIEW_PARAM_IDS)[number]) ||
    OUTPUT_NOTIFICATION_PARAM_IDS.includes(parameterId as (typeof OUTPUT_NOTIFICATION_PARAM_IDS)[number])
  )
}

export function App() {
  const swUpdate = useServiceWorkerUpdate()
  const desktopBridge = getDesktopBridge()
  const webSerialSupported = WebSerialTransport.isSupported()
  const {
    transportMode,
    setTransportMode,
    websocketUrl,
    setWebsocketUrl,
    udpTarget,
    setUdpTarget,
    tcpTarget,
    setTcpTarget,
    selectedSerialPort,
    rememberedSerialPortInfo,
    autoReconnectAvailable,
    rememberSelectedSerialPort,
    reacquireSerialPort
  } = useTransportSelection(webSerialSupported)
  const [productMode, setProductMode] = useProductMode()
  const [gpsCoordFormat, setGpsCoordFormat] = useGpsCoordFormat()
  const [activeViewId, setActiveViewId] = useState<AppViewId>('setup')
  // The selected port is supplied to the transport LAZILY via this ref.
  // It must NOT be a runtime-useMemo dependency: the WebSerial transport
  // calls onPortSelected(port) during connect (with the just-picked
  // port), which flows into setSelectedSerialPort — if that re-keyed the
  // runtime memo, the in-flight runtime was destroyed mid-connect (the
  // old one closed the port it had just opened) → "no heartbeats" until
  // a full page refresh. Keying only on transportMode/websocketUrl keeps
  // the runtime stable across the connect; the resolver still hands the
  // latest remembered port to auto-reconnect.
  const selectedSerialPortRef = useRef<WebSerialPortLike | undefined>(selectedSerialPort)
  useEffect(() => {
    selectedSerialPortRef.current = selectedSerialPort
  }, [selectedSerialPort])
  const runtime = useMemo(
    () =>
      createRuntime(
        transportMode,
        websocketUrl,
        udpTarget,
        tcpTarget,
        () => selectedSerialPortRef.current,
        (port) => {
          rememberSelectedSerialPort(port)
        }
      ),
    [transportMode, websocketUrl, udpTarget, tcpTarget, rememberSelectedSerialPort]
  )
  const snapshot = useRuntimeSnapshot(runtime)
  // The catalog follows the connected vehicle. Pre-connect (or for an
  // unidentified vehicle) it stays on ArduCopter, which is also the runtime's
  // default bundle, so derived setup/category state is consistent on both
  // sides of the runtime boundary.
  // Lazily imported ArduPilot upstream parameter metadata for the connected
  // vehicle (scripts/import-ardupilot-params.mjs output). Each file is large,
  // so it's dynamic-imported on vehicle change and merged under the curated
  // catalog — curated params keep their UX, the rest of the parameter tree
  // gains real labels/descriptions/ranges/options. Keyed by vehicle so a
  // late-arriving load for a previous vehicle can't be applied to the wrong
  // bundle.
  const [upstreamParameters, setUpstreamParameters] = useState<
    { vehicle: string; params: UpstreamParameterMap } | undefined
  >(undefined)
  const activeVehicle = snapshot.vehicle?.vehicle
  useEffect(() => {
    if (!activeVehicle) {
      return
    }
    let cancelled = false
    loadUpstreamParameters(activeVehicle)
      .then((params) => {
        if (!cancelled && params) {
          setUpstreamParameters({ vehicle: activeVehicle, params })
        }
      })
      .catch(() => {
        // Upstream enrichment is best-effort; the curated catalog stands alone.
      })
    return () => {
      cancelled = true
    }
  }, [activeVehicle])

  const activeMetadataBundle = useMemo(() => {
    const base =
      activeVehicle === 'ArduPlane'
        ? arduplaneMetadata
        : activeVehicle === 'ArduRover'
          ? arduroverMetadata
          : activeVehicle === 'ArduSub'
            ? ardusubMetadata
            : arducopterMetadata
    if (upstreamParameters && upstreamParameters.vehicle === activeVehicle) {
      return {
        ...base,
        parameters: mergeUpstreamParameters(base.parameters, upstreamParameters.params)
      }
    }
    return base
  }, [activeVehicle, upstreamParameters])
  const metadataCatalog = useMemo(
    () => normalizeFirmwareMetadata(activeMetadataBundle),
    [activeMetadataBundle]
  )
  const setupSectionIds = useMemo(
    () => activeMetadataBundle.setupSections.map((section) => section.id),
    [activeMetadataBundle]
  )
  const guidedSetupShortcutSectionId = useMemo(
    () => readGuidedSetupShortcutSectionId(setupSectionIds),
    [setupSectionIds]
  )
  // Library hook result bound to a name first so SnapshotsSection can take
  // the full Libraries object; the destructure pulls out the names App
  // still references inline.
  const libraries = useLibraries()
  const {
    savedSnapshots,
    setSavedSnapshots,
    selectedSnapshotId,
    setSelectedSnapshotId,
    savedProvisioningProfiles,
    setSavedProvisioningProfiles,
    selectedProvisioningProfileId,
    setSelectedProvisioningProfileId,
    savedTuningProfiles,
    setSavedTuningProfiles,
    selectedTuningProfileId,
    setSelectedTuningProfileId,
    tuningProfileStorageNotice
  } = libraries
  const [selectedPresetId, setSelectedPresetId] = useState<string>()
  const [desktopSnapshotLibraryPath, setDesktopSnapshotLibraryPath] = useState<string>()
  const [desktopSnapshotLibraryName, setDesktopSnapshotLibraryName] = useState<string>()
  // Form-input state bound to a name first so SnapshotsSection can take
  // the full LibraryForms object; the destructure pulls out the names App
  // still references inline.
  const libraryForms = useLibraryForms()
  const {
    snapshotLabelInput,
    setSnapshotLabelInput,
    snapshotNoteInput,
    setSnapshotNoteInput,
    snapshotTagsInput,
    setSnapshotTagsInput,
    snapshotProtectedInput,
    setSnapshotProtectedInput,
    provisioningProfileLabelInput,
    setProvisioningProfileLabelInput,
    provisioningProfileModelInput,
    setProvisioningProfileModelInput,
    provisioningProfileFleetInput,
    setProvisioningProfileFleetInput,
    provisioningProfileMissionInput,
    setProvisioningProfileMissionInput,
    provisioningProfileNoteInput,
    setProvisioningProfileNoteInput,
    provisioningProfileTagsInput,
    setProvisioningProfileTagsInput,
    provisioningProfileChecklistInput,
    setProvisioningProfileChecklistInput,
    provisioningProfileProtectedInput,
    setProvisioningProfileProtectedInput,
    provisioningProfileSourceInput,
    includeDraftOverlayInProvisioningProfile,
    setIncludeDraftOverlayInProvisioningProfile,
    tuningProfileLabelInput,
    setTuningProfileLabelInput,
    tuningProfileNoteInput,
    setTuningProfileNoteInput,
    tuningProfileProtectedInput,
    setTuningProfileProtectedInput,
    tuningProfileSourceInput,
    setTuningProfileSourceInput
  } = libraryForms
  const {
    parameterSearch,
    setParameterSearch,
    selectedParameterId,
    setSelectedParameterId,
    parameterNotice,
    setParameterNotice,
    parameterFollowUp,
    setParameterFollowUp
  } = useParameterFeedback()
  const {
    editedValues,
    setDraft,
    clearDraft,
    clearDrafts,
    clearAllDrafts,
    mergeDrafts,
    replaceDrafts,
    updateDrafts
  } = useParameterDrafts()
  const onboardLogs = useOnboardLogs(runtime)
  // Library-tab notices (snapshot / provisioning / tuning-profile / preset /
  // session ParameterNotice banners + the post-copy sticky flag) live in
  // their own hook — see use-library-notices.ts.
  const {
    snapshotNotice,
    setSnapshotNotice,
    provisioningNotice,
    setProvisioningNotice,
    tuningProfileNotice,
    setTuningProfileNotice,
    presetNotice,
    setPresetNotice,
    sessionNotice,
    setSessionNotice,
    noticesCopied,
    setNoticesCopied
  } = useLibraryNotices()
  const [busyAction, setBusyAction] = useState<string>()
  // Progress for the batch "Apply All / Write all" param write so the button
  // shows "Writing… (N/M)" instead of a frozen "Writing…" while a large
  // show-all → write-all batch grinds through one verified write at a time.
  const [applyAllProgress, setApplyAllProgress] = useState<{ completed: number; total: number }>()
  // Setup-tab guided exercises that aren't RC-side and aren't motor-side
  // (orientation 6-pose, mode-switch activity observer, mode-switch
  // exercise) live in their own hook — see use-setup-exercises.ts.
  const {
    orientationExercise,
    setOrientationExercise,
    modeSwitchActivity,
    setModeSwitchActivity,
    modeSwitchExercise,
    setModeSwitchExercise
  } = useSetupExercises()
  // RC exercise state machines (hold-each-stick range, channel auto-mapping,
  // hold-to-lock auto-capture, full per-axis calibration) live in a focused
  // hook — see use-rc-exercises.ts.
  // Bound to a name first so ReceiverSection can take the full result;
  // the destructure pulls out what App.tsx references inline.
  const rcExercises = useRcExercises()
  const {
    rcRangeExercise,
    setRcRangeExercise,
    rcMappingSession,
    setRcMappingSession,
    rcMappingAutoCaptureState,
    setRcMappingAutoCaptureState,
    rcCalibrationSession,
    setRcCalibrationSession
  } = rcExercises
  // Per-view sub-task pins for the Receiver and Outputs tabs (Tuning's
  // override lives in useTuningWorkbench because it pairs with the
  // workbench scale-multiplier state).
  const {
    receiverTaskOverride,
    setReceiverTaskOverride,
    outputTaskOverride,
    setOutputTaskOverride
  } = useViewTaskOverrides()
  // Tuning-tab workbench state (sub-task override, roll/pitch link, advanced
  // controls toggle, five master-scale multipliers) lives in its own hook —
  // see use-tuning-workbench.ts. Bound to a name first so TuningCopterSection
  // can take the full result; the destructure pulls out what App.tsx
  // references inline.
  const tuningWorkbench = useTuningWorkbench()
  const {
    tuningTaskOverride,
    tuningRollPitchLinked,
    tuningMasterPiGain,
    setTuningMasterPiGain,
    tuningMasterDGain,
    setTuningMasterDGain,
    tuningMasterFeedforwardGain,
    setTuningMasterFeedforwardGain,
    tuningMasterPitchRatio,
    setTuningMasterPitchRatio,
    tuningMasterFilterStrength,
    setTuningMasterFilterStrength
  } = tuningWorkbench
  // Receiver-tab detail toggles (per-channel rows + mapping diagnostics).
  const receiverDetailToggles = useReceiverDetailToggles()
  const { setShowReceiverChannelDetails, setShowReceiverMappingDiagnostics } = receiverDetailToggles
  // Motor-test request-builder state (selected output + throttle % +
  // duration s) lives in its own hook — see use-motor-test-config.ts.
  const motorTestConfig = useMotorTestConfig()
  const {
    motorTestOutput,
    setMotorTestOutput,
    motorTestThrottlePercent,
    setMotorTestThrottlePercent,
    motorTestDurationSeconds,
    setMotorTestDurationSeconds
  } = motorTestConfig
  // Motor verification + reorder + Betaflight-style guided identify state
  // lives in its own hook — see use-motor-management.ts. The guided
  // identify flow spins each motor output in order, operator clicks the
  // physical position that spun, and the accumulated map inverts into
  // motorReorderSelections at end-of-sequence so the existing Stage
  // Reorder path writes the correct SERVOn_FUNCTION drafts.
  const motorManagement = useMotorManagement()
  const {
    motorVerification,
    setMotorVerification,
    motorReorderDialogOpen,
    setMotorReorderDialogOpen,
    motorReorderSelections,
    setMotorReorderSelections,
    guidedReorderActive,
    setGuidedReorderActive,
    guidedReorderStep,
    setGuidedReorderStep,
    guidedReorderMapping,
    setGuidedReorderMapping,
    guidedReorderAwaitingSpin,
    setGuidedReorderAwaitingSpin,
    guidedReorderCompleted,
    setGuidedReorderCompleted
  } = motorManagement
  // Motor-reorder dialog tab state. The dialog hosts both the BF-style
  // motor-reorder workbench and a direction-test surface so the operator
  // never has to leave the popout to spin a motor or flip a reversal.
  const [motorDialogTab, setMotorDialogTab] = useState<'reorder' | 'direction'>('reorder')
  // Spin-error banner — when spinGuidedReorderStep or a manual dialog spin
  // fails (FC rejected DO_MOTOR_TEST, eligibility check failed, etc.) we
  // used to swallow the error; surface it inside the dialog so the
  // operator sees WHY no motor moved.
  const [motorDialogSpinError, setMotorDialogSpinError] = useState<string | undefined>(undefined)

  // Two-step confirm for the Status-page "Enter DFU / bootloader" action.
  const [statusDfuArmed, setStatusDfuArmed] = useState(false)
  // Calibration-tab feedback (battery voltage input + per-card notices +
  // ESC two-step arm gate) lives in a focused hook now — see use-calibration-notices.ts.
  // CompassMot was removed from the Calibration tab in favour of in-flight
  // log-driven calibration; ESC is the only remaining motor-spinning cal.
  // Bound to a name first so CalibrationSection can take the full result;
  // the destructure pulls out what App.tsx references inline.
  const calibrationNotices = useCalibrationNotices()
  // motorReorderSelections moved into useMotorManagement (above) — it was
  // previously declared ~6,300 lines below in the original App.tsx,
  // alone before the single return: a latent hook-order hazard one
  // early-return away from a crash. Now bundled with the rest of the
  // motor-management state.
  // Files-tab MAVFTP browser — request/response (not snapshot-streamed); the
  // hook owns path/listing/loading/error + navigate/download/upload/delete.
  // This is the single MAVFTP surface (the old developer browser that lived
  // in the Expert/Parameters tab was removed in favour of this Files tab).
  const filesBrowser = useMavftpBrowser({
    runtime,
    connected: snapshot.connection.kind === 'connected',
    isActive: activeViewId === 'files',
    setBusyAction
  })
  // Safety-acknowledgment gates (props removed / test area clear / USB
  // bench / snapshot restore / provisioning restore / preset apply) live
  // in their own hook — see use-safety-acks.ts. Bound to a name first so
  // SnapshotsSection can take the full result object (it needs the
  // snapshot-restore + provisioning-restore pair); the destructure then
  // pulls out what App still references inline.
  const safetyAcks = useSafetyAcks()
  const {
    propsRemovedAcknowledged,
    setPropsRemovedAcknowledged,
    testAreaAcknowledged,
    setTestAreaAcknowledged,
    usbBenchAcknowledged,
    setUsbBenchAcknowledged,
    snapshotRestoreAcknowledged,
    setSnapshotRestoreAcknowledged,
    provisioningRestoreAcknowledged,
    setProvisioningRestoreAcknowledged,
    presetApplyAcknowledged,
    setPresetApplyAcknowledged
  } = safetyAcks
  // Ports-tab view state (show-all toggles + per-port custom-baud inputs +
  // expanded options row) lives in its own hook — see use-ports-view.ts.
  // Bound to a name first so PortsSection can take the full result; the
  // destructure pulls out what App.tsx still references inline.
  const portsView = usePortsView()
  const {
    showAllOutputAssignments,
    setShowAllOutputAssignments,
    showAllSerialPorts
  } = portsView
  // Setup-tab wizard view-state (selected section / overview-vs-wizard /
  // focus-after-section-change / per-section confirmations) lives in
  // its own hook — see use-setup-wizard.ts.
  const {
    selectedSetupSectionId,
    setSelectedSetupSectionId,
    setupMode,
    setSetupMode,
    pendingSetupWizardFocusId,
    setPendingSetupWizardFocusId,
    setupConfirmations,
    setSetupConfirmations
  } = useSetupWizard(guidedSetupShortcutSectionId)
  const parameterBackupInputRef = useRef<HTMLInputElement>(null)
  // Categories stripped when importing a backup from another airframe.
  // All ON by default (field feedback): calibration offsets, stream rates,
  // and missions are per-airframe values you re-measure or re-plan, so
  // importing them silently is the surprising path. Uncheck to carry them.
  const [parameterImportExclusions, setParameterImportExclusions] = useState<
    Record<ParameterImportCategory, boolean>
  >({ calibration: true, 'stream-rates': true, mission: true })
  const {
    handleExportParameterBackup,
    handleExportParameterBackupAsParm,
    handleExportParameterBackupAsParams,
    handleImportParameterBackup
  } = useParameterBackupIo({
    snapshot,
    parameterImportExclusions,
    replaceDrafts,
    setParameterNotice,
    setParameterFollowUp
  })
  const snapshotImportInputRef = useRef<HTMLInputElement>(null)
  const provisioningImportInputRef = useRef<HTMLInputElement>(null)
  const guidedSetupShortcutAppliedRef = useRef(false)
  const rcMappingCandidateRef = useRef<RcMappingCandidate | undefined>(undefined)
  const rcMappingTargetAxisRef = useRef<RcAxisId | undefined>(undefined)
  const rcMappingAutoCaptureTrackerRef = useRef<{
    axisId?: RcAxisId
    channelNumber?: number
    accumulatedMs: number
    lastTickAtMs?: number
    lastMatchedAtMs?: number
  }>({
    accumulatedMs: 0
  })
  const captureRcMappingCandidateRef = useRef<((candidate: RcMappingCandidate, source?: 'manual' | 'auto') => void) | undefined>(
    undefined
  )
  const previousModeSwitchRef = useRef<{ slot?: number; pwm?: number }>({})
  const serialAutoReconnectAttemptedRef = useRef(false)
  // Armed when we issue a reboot on a web-serial link so the resulting drop
  // (the FC re-enumerates over USB) drives a polling reconnect via the same
  // proven handleConnect path the Connect button uses — including its
  // stale-handle reacquire, which the first attempt at this feature was missing.
  const expectRebootReconnectRef = useRef(false)
  const rebootReconnectingRef = useRef(false)
  const previousConnectionKindRef = useRef(snapshot.connection.kind)
  const previousGuidedSectionRef = useRef<string | undefined>(undefined)
  const boardCatalogEntry = useMemo(() => findBoardCatalogEntry(snapshot.hardware.board?.boardType), [snapshot.hardware.board?.boardType])
  const rcChannelDisplays = buildRcChannelDisplays(snapshot)
  const airframe = deriveAirframe(snapshot, snapshot.vehicle?.vehicle)
  // Copter (and the pre-connect / Unknown default) keeps motor-matrix
  // framing; Plane/Rover/Sub are not a quad, so vehicle-specific surfaces
  // branch off this instead of showing Copter motor logic.
  const isCopterVehicle = (snapshot.vehicle?.vehicle ?? 'ArduCopter') === 'ArduCopter'
  // Each non-Copter vehicle now has its own curated Tuning surface:
  // ArduPlane -> TuningPlaneSection, ArduRover -> TuningRoverSection,
  // ArduSub -> TuningSubSection. (Copter uses TuningCopterSection.)
  const isPlaneVehicle = snapshot.vehicle?.vehicle === 'ArduPlane'
  const isRoverVehicle = snapshot.vehicle?.vehicle === 'ArduRover'
  const isSubVehicle = snapshot.vehicle?.vehicle === 'ArduSub'
  // How many of the curated Plane tuning params the connected FC actually
  // streams — used for the Tuning nav badge so it advertises a real count
  // instead of the misleading Copter "via Params" fallback.
  const planeTuningControlCount = TUNING_PLANE_PARAM_IDS.reduce(
    (total, paramId) => (selectParameterById(snapshot, paramId) !== undefined ? total + 1 : total),
    0
  )
  // Same control-count surfacing for the curated ArduRover tuning surface.
  const roverTuningControlCount = TUNING_ROVER_PARAM_IDS.reduce(
    (total, paramId) => (selectParameterById(snapshot, paramId) !== undefined ? total + 1 : total),
    0
  )
  // Same control-count surfacing for the curated ArduSub tuning surface.
  const subTuningControlCount = TUNING_SUB_PARAM_IDS.reduce(
    (total, paramId) => (selectParameterById(snapshot, paramId) !== undefined ? total + 1 : total),
    0
  )
  // ArduPlane frame configuration (QuadPlane / tailsitter). The catalog
  // already defines these with enum options; surface them editable in the
  // Setup airframe section so Plane builds aren't a raw-parameter hunt.
  const qEnableParameter = selectParameterById(snapshot, 'Q_ENABLE')
  const qFrameClassParameter = selectParameterById(snapshot, 'Q_FRAME_CLASS')
  const qFrameTypeParameter = selectParameterById(snapshot, 'Q_FRAME_TYPE')
  // Copter FRAME_CLASS / FRAME_TYPE — enum params already mapped to the
  // Motors view. Surface them as editable dropdowns there (was read-only,
  // forcing operators into Expert → Parameters to change frame geometry).
  const frameClassParameter = selectParameterById(snapshot, 'FRAME_CLASS')
  const frameTypeParameter = selectParameterById(snapshot, 'FRAME_TYPE')
  const frameConfigEditable = isCopterVehicle && frameClassParameter !== undefined
  const modeAssignments = deriveModeAssignments(snapshot, snapshot.vehicle?.vehicle)
  const modeExerciseAssignments = deriveModeExerciseAssignments(snapshot, snapshot.vehicle?.vehicle)
  const modeSwitchEstimate = deriveModeSwitchEstimate(snapshot, snapshot.vehicle?.vehicle)
  const outputMapping = deriveOutputMappingSummary(snapshot, snapshot.vehicle?.vehicle)
  // Per-vehicle output summary for non-Copter airframes (Plane/Rover/Sub):
  // group the configured outputs by role instead of the bare "not a
  // multirotor matrix" note. Read-only review; editing stays in Servos.
  const vehicleOutputSummary = buildVehicleOutputSummary(snapshot.vehicle?.vehicle, outputMapping.outputs)
  // Per-channel servo function rows for the Servos tab mapping table.
  // Recomputed on every snapshot tick; lightweight (16 channels max).
  const servoMappingRows = useMemo(
    () => buildServoFunctionMappingRows(snapshot, outputMapping.outputs),
    [snapshot, outputMapping.outputs]
  )
  // Config tab — BF-style baseline grab-bag. Section content is mostly
  // read-only for now; editable surfaces (orientation, arming, identity)
  // land as follow-up PRs. The sections array is small (5 items) and
  // doesn't need to be useMemo'd, but pre-build the parametersById map
  // once so each section card can render in O(1).
  const { configParametersById, configSections, isConfigParamId } = useConfigSections(snapshot)
  // Memoized on snapshot: snapshot is a fresh object every telemetry tick, so
  // these unmemoized derivations produced a new reference each render and made
  // their downstream consumers re-run every tick — the RC-calibration effect
  // (keyed on rcAxisObservations), the setup-confirmation-signature memo (keyed
  // on escSetup/currentRcAxisChannelMap/rcAxisObservations), and the
  // useReceiverChannelDisplays / useRcMappingDerivations hooks. Same fix as
  // filteredParameters below.
  const escSetup = useMemo(() => deriveEscSetupSummary(snapshot), [snapshot])
  const currentRcAxisChannelMap = useMemo(() => deriveRcAxisChannelMap(snapshot), [snapshot])
  const rcAxisObservations = useMemo(() => deriveRcAxisObservations(snapshot), [snapshot])
  const receiverChannelDisplays = useReceiverChannelDisplays({
    snapshot,
    rcChannelDisplays,
    rcAxisObservations,
    modeSwitchEstimate
  })
  const gpsAutoConfig = readRoundedParameter(snapshot, 'GPS_AUTO_CONFIG')
  const gpsAutoSwitch = readRoundedParameter(snapshot, 'GPS_AUTO_SWITCH')
  const gpsPrimary = readRoundedParameter(snapshot, 'GPS_PRIMARY')
  const gpsRateMs = readRoundedParameter(snapshot, 'GPS_RATE_MS')
  const osdType = readRoundedParameter(snapshot, 'OSD_TYPE')
  const osdChannel = readRoundedParameter(snapshot, 'OSD_CHAN')
  const osdSwitchMethod = readRoundedParameter(snapshot, 'OSD_SW_METHOD')
  const mspOptions = readRoundedParameter(snapshot, 'MSP_OPTIONS')
  const mspOsdCellCount = readRoundedParameter(snapshot, 'MSP_OSD_NCELLS')
  const vtxEnabled = readRoundedParameter(snapshot, 'VTX_ENABLE')
  const vtxFrequency = readRoundedParameter(snapshot, 'VTX_FREQ')
  const vtxPower = readRoundedParameter(snapshot, 'VTX_POWER')
  const vtxMaxPower = readRoundedParameter(snapshot, 'VTX_MAX_POWER')
  const batteryMonitor = readRoundedParameter(snapshot, 'BATT_MONITOR')
  const batteryCapacity = readRoundedParameter(snapshot, 'BATT_CAPACITY')
  const batteryArmVoltage = readParameterValue(snapshot, 'BATT_ARM_VOLT')
  const batteryArmMah = readRoundedParameter(snapshot, 'BATT_ARM_MAH')
  const batteryLowVoltage = readParameterValue(snapshot, 'BATT_LOW_VOLT')
  const batteryFailsafe = readRoundedParameter(snapshot, 'BATT_FS_LOW_ACT')
  const batteryCriticalVoltage = readParameterValue(snapshot, 'BATT_CRT_VOLT')
  const batteryCriticalFailsafe = readRoundedParameter(snapshot, 'BATT_FS_CRT_ACT')
  const compassSetupAvailability = deriveCompassSetupAvailability(snapshot)
  const boardOrientation = readRoundedParameter(snapshot, 'AHRS_ORIENTATION')
  const configuredModeChannel = readRoundedParameter(snapshot, 'FLTMODE_CH') ?? readRoundedParameter(snapshot, 'MODE_CH')
  const rssiType = readRoundedParameter(snapshot, 'RSSI_TYPE')
  const rssiChannel = readRoundedParameter(snapshot, 'RSSI_CHANNEL')
  const rssiChannelLow = readRoundedParameter(snapshot, 'RSSI_CHAN_LOW')
  const rssiChannelHigh = readRoundedParameter(snapshot, 'RSSI_CHAN_HIGH')
  const throttleFailsafe = readRoundedParameter(snapshot, 'FS_THR_ENABLE')
  const throttleFailsafeValue = readRoundedParameter(snapshot, 'FS_THR_VALUE')
  const notificationLedTypes = readRoundedParameter(snapshot, 'NTF_LED_TYPES')
  const notificationLedLength = readRoundedParameter(snapshot, 'NTF_LED_LEN')
  const notificationLedBrightness = readRoundedParameter(snapshot, 'NTF_LED_BRIGHT')
  const notificationLedOverride = readRoundedParameter(snapshot, 'NTF_LED_OVERRIDE')
  const notificationBuzzTypes = readRoundedParameter(snapshot, 'NTF_BUZZ_TYPES')
  const notificationBuzzVolume = readRoundedParameter(snapshot, 'NTF_BUZZ_VOLUME')
  const activePreArmIssues = snapshot.preArmStatus.issues
  const configuredOutputs = [...outputMapping.motorOutputs, ...outputMapping.configuredAuxOutputs].sort(
    (left, right) => left.channelNumber - right.channelNumber
  )
  const visibleDisabledOutputs = outputMapping.disabledOutputs.slice(0, 6)
  const motorTestRequest = buildMotorTestRequest(motorTestOutput, motorTestThrottlePercent, motorTestDurationSeconds)
  const motorTestExpertOptions = { expertMode: productMode === 'expert' }
  const motorTestEligibility = evaluateMotorTestEligibility(snapshot, motorTestRequest, motorTestExpertOptions)
  const coreMotorTestGuardReasons = computeMotorTestGuardReasons(snapshot, motorTestRequest, {
    propsRemoved: propsRemovedAcknowledged,
    testAreaClear: testAreaAcknowledged
  }, motorTestExpertOptions)
  // A physical USB (web-serial) link means someone is at the bench with the
  // craft; require the extra USB-bench acknowledgement before any spin.
  const motorTestOverUsb = transportMode === 'web-serial' && snapshot.connection.kind === 'connected'
  const motorTestGuardReasons =
    motorTestOverUsb && !usbBenchAcknowledged
      ? [...coreMotorTestGuardReasons, 'Confirm the craft is on the bench with props off (USB connection detected).']
      : coreMotorTestGuardReasons
  const canRunMotorTest = motorTestGuardReasons.length === 0
  const selectedMotorTestOutputLabel =
    motorTestOutput === ALL_MOTOR_TEST_OUTPUT
      ? `All ${outputMapping.motorOutputs.length} mapped motors (sequence)`
      : motorTestOutput === ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS
        ? `All ${outputMapping.motorOutputs.length} mapped motors (at once)`
        : motorTestEligibility.selectedOutput
        ? `OUT${motorTestEligibility.selectedOutput.channelNumber}${
            motorTestEligibility.selectedOutput.motorNumber !== undefined ? ` / M${motorTestEligibility.selectedOutput.motorNumber}` : ''
          }`
        : undefined
  const canRunModeSwitchExercise =
    snapshot.connection.kind === 'connected' &&
    snapshot.liveVerification.rcInput.verified &&
    modeExerciseAssignments.length >= 2 &&
    modeSwitchEstimate.channelNumber !== undefined
  const canRunRcRangeExercise = snapshot.connection.kind === 'connected' && snapshot.liveVerification.rcInput.verified
  const canRunRcMappingExercise = snapshot.connection.kind === 'connected' && snapshot.liveVerification.rcInput.verified
  const canRunOrientationExercise = snapshot.connection.kind === 'connected' && snapshot.liveVerification.attitudeTelemetry.verified
  const canCaptureRcCalibration = snapshot.connection.kind === 'connected' && snapshot.liveVerification.rcInput.verified
  const canRunMotorVerification =
    snapshot.connection.kind === 'connected' &&
    snapshot.parameterStats.status === 'complete' &&
    snapshot.vehicle !== undefined &&
    !snapshot.vehicle.armed &&
    outputMapping.motorOutputs.length > 0
  const canApplyDraftParameters = canApplyParameterChanges(snapshot)

  useEffect(() => {
    if (
      transportMode !== 'web-serial' ||
      !autoReconnectAvailable ||
      !selectedSerialPort ||
      serialAutoReconnectAttemptedRef.current ||
      busyAction !== undefined ||
      snapshot.connection.kind !== 'idle'
    ) {
      return
    }

    serialAutoReconnectAttemptedRef.current = true
    let cancelled = false

    void (async () => {
      setBusyAction('connect:auto-serial')
      try {
        setSessionNotice(undefined)
        await runtime.connect()
        await runtime.requestParameterList()
      } catch (error) {
        // Release the port on a genuine failure so a retry re-establishes
        // without a page refresh — BUT do not tear down a link that is
        // actually up: waitForVehicle()'s reject is a timer, so a
        // heartbeat landing just after the heartbeat timeout (slow-boot
        // Cube/Plane; DEFAULT_HEARTBEAT_TIMEOUT_MS) leaves a connected
        // vehicle, and a
        // requestParameterList() hiccup on a live link is recoverable by
        // re-pulling, not by dropping the connection. Only the genuine
        // stale-'connected'-without-vehicle case needs the teardown.
        const teardownSnapshot = runtime.getSnapshot()
        if (
          !(
            teardownSnapshot.connection.kind === 'connected' &&
            teardownSnapshot.vehicle !== undefined
          )
        ) {
          await runtime.disconnect().catch(() => {})
        }
        if (!cancelled) {
          setSessionNotice({
            tone: 'warning',
            text: `Auto-reconnect to the remembered serial port failed. ${describeConnectFailure('web-serial', runtime.getSnapshot().connection, error)}`
          })
        }
      } finally {
        // The effect re-runs as connection state changes; only clear the auto-serial sentinel so
        // Setup actions do not stay falsely blocked after the port is already connected.
        setBusyAction((current) => (current === 'connect:auto-serial' ? undefined : current))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [autoReconnectAvailable, busyAction, runtime, selectedSerialPort, snapshot.connection.kind, transportMode])

  // Auto-reconnect after a reboot we initiated. The reboot drops the serial
  // link (the FC re-enumerates over USB), landing connection.kind on
  // 'disconnected'/'error'. Drive the same handleConnect path the Connect
  // button uses — crucially it reacquires the re-enumerated device's fresh
  // handle (the stale handle is why the first attempt hung) and bounds the
  // heartbeat wait. Cancellation rides on rebootReconnectingRef (NOT the effect
  // cleanup, which would re-fire on every connection.kind transition the
  // reconnect itself causes).
  useEffect(() => {
    if (transportMode !== 'web-serial' || !selectedSerialPort) {
      return
    }
    if (!expectRebootReconnectRef.current || rebootReconnectingRef.current) {
      return
    }
    if (snapshot.connection.kind !== 'disconnected' && snapshot.connection.kind !== 'error') {
      return
    }
    expectRebootReconnectRef.current = false
    rebootReconnectingRef.current = true
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
      // One reconnect attempt. Handles BOTH reboot USB quirks:
      //  - bootloader-first: the rebooting board enumerates as the bootloader
      //    (no MAVLink heartbeat) before the firmware re-enumerates;
      //  - composite device: ArduPilot FCs expose TWO CDC serial interfaces on
      //    the same VID/PID — only one carries MAVLink. The picker/matcher
      //    can't tell them apart, so reconnect could grab the silent one.
      // So we try EVERY currently-granted port that shares the FC's VID/PID and
      // keep the one that actually answers a heartbeat (short probe); the wrong
      // interface / a bootloader just times out and we move on. Returns true
      // once a heartbeating vehicle is synced.
      const targetInfo = getWebSerialPortInfo(selectedSerialPortRef.current)
      const attempt = async (): Promise<boolean> => {
        let ports: WebSerialPortLike[]
        try {
          ports = await getAvailableWebSerialPorts()
        } catch {
          return false
        }
        const matching = ports.filter((port) => {
          const info = getWebSerialPortInfo(port)
          return (
            targetInfo !== undefined &&
            info !== undefined &&
            info.usbVendorId === targetInfo.usbVendorId &&
            info.usbProductId === targetInfo.usbProductId
          )
        })
        const candidates = matching.length > 0 ? matching : ports
        for (const candidate of candidates) {
          if (!rebootReconnectingRef.current) {
            return false
          }
          // Point the transport resolver at this handle synchronously; the
          // setSelectedSerialPort state update lags a render.
          selectedSerialPortRef.current = candidate
          try {
            await runtime.connect()
            await runtime.waitForVehicle({ timeoutMs: 4000 })
            await runtime.requestParameterList()
            // This interface heartbeats — remember it as the live port.
            rememberSelectedSerialPort(candidate)
            return true
          } catch {
            await runtime.disconnect().catch(() => {})
          }
        }
        return false
      }
      setSessionNotice({ tone: 'neutral', text: 'Rebooting — waiting for the flight controller to reconnect…' })
      // Give the board time to drop off USB and start re-enumerating.
      await wait(2500)
      const deadlineMs = Date.now() + 60_000
      try {
        while (rebootReconnectingRef.current && Date.now() < deadlineMs) {
          if (await attempt()) {
            const current = runtime.getSnapshot()
            if (current.connection.kind === 'connected' && current.vehicle !== undefined) {
              setSessionNotice({ tone: 'success', text: 'Reconnected after reboot.' })
              return
            }
          }
          await wait(1200)
        }
        if (rebootReconnectingRef.current) {
          setSessionNotice({
            tone: 'warning',
            text: 'Could not auto-reconnect after the reboot — click Connect to reconnect.'
          })
        }
      } finally {
        rebootReconnectingRef.current = false
      }
    })()
  }, [snapshot.connection.kind, transportMode, selectedSerialPort, runtime, rememberSelectedSerialPort])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePageHide = () => {
      void runtime.disconnect().catch(() => {})
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [runtime])

  const restoredSetupProgressKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    setParameterNotice(undefined)
    setPresetNotice(undefined)
    setSessionNotice(undefined)
    setParameterFollowUp(undefined)
    setSetupConfirmations({})
    // A new runtime (transport switch) wiped the confirmations above; allow
    // the durable-progress restore to re-run once the next board identifies
    // itself — its storage key decides whether anything comes back.
    restoredSetupProgressKeyRef.current = undefined
  }, [runtime])

  // Durable guided-setup progress (see setup-progress-storage.ts): the
  // in-memory preservation added for planned reboots does not survive a
  // page reload, which is common around FC reboots (Web Serial
  // re-enumeration, a reflexive F5) and regressed every exercise- and
  // confirmation-gated wizard step on real hardware. Keyed by board
  // identity; restore fills only idle/empty slots so live in-session state
  // always wins, and restored confirmations still pass through the
  // parameter-bound signature gate before they count.
  const setupProgressKey = useMemo(
    () => deriveSetupProgressKey(snapshot),
    [snapshot.connection.kind, snapshot.hardware.board, snapshot.vehicle]
  )

  useEffect(() => {
    if (setupProgressKey === undefined || restoredSetupProgressKeyRef.current === setupProgressKey) {
      return
    }

    restoredSetupProgressKeyRef.current = setupProgressKey
    const stored = loadStoredSetupProgress(setupProgressKey)
    if (!stored) {
      return
    }

    setSetupConfirmations((current) => ({ ...stored.confirmations, ...current }))
    setOrientationExercise((current) =>
      current.status === 'idle' && stored.exercises.orientationExercise ? stored.exercises.orientationExercise : current
    )
    setModeSwitchExercise((current) =>
      current.status === 'idle' && stored.exercises.modeSwitchExercise ? stored.exercises.modeSwitchExercise : current
    )
    setRcRangeExercise((current) =>
      current.status === 'idle' && stored.exercises.rcRangeExercise ? stored.exercises.rcRangeExercise : current
    )
    setRcMappingSession((current) =>
      current.status === 'idle' && stored.exercises.rcMappingSession ? stored.exercises.rcMappingSession : current
    )
    setRcCalibrationSession((current) =>
      current.status === 'idle' && stored.exercises.rcCalibrationSession ? stored.exercises.rcCalibrationSession : current
    )
    setMotorVerification((current) =>
      current.status === 'idle' && stored.exercises.motorVerification ? stored.exercises.motorVerification : current
    )
  }, [setupProgressKey])

  useEffect(() => {
    // Save only after the restore for this key ran, so an empty fresh
    // session can't clobber stored progress before hydration.
    if (setupProgressKey === undefined || restoredSetupProgressKeyRef.current !== setupProgressKey) {
      return
    }

    const exercises = collectTerminalSetupExercises({
      orientationExercise,
      modeSwitchExercise,
      rcRangeExercise,
      rcMappingSession,
      rcCalibrationSession,
      motorVerification
    })
    if (Object.keys(setupConfirmations).length === 0 && Object.keys(exercises).length === 0) {
      return
    }

    saveStoredSetupProgress(setupProgressKey, {
      version: 1,
      savedAtMs: Date.now(),
      confirmations: setupConfirmations,
      exercises
    })
  }, [
    modeSwitchExercise,
    motorVerification,
    orientationExercise,
    rcCalibrationSession,
    rcMappingSession,
    rcRangeExercise,
    setupConfirmations,
    setupProgressKey
  ])

  useEffect(() => {
    trackViewPageview(activeViewId)
    trackAppEvent('View Opened', {
      view: activeViewId,
      connection: snapshot.connection.kind
    })
  }, [activeViewId, snapshot.connection.kind])

  // Switching tabs at the bottom of one page must not land the operator at
  // the bottom of the next — every tab opens scrolled-to-top, like every
  // other configurator (MP / BF). Instant scroll (not smooth) so quick tab
  // cycling stays responsive.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [activeViewId])

  useEffect(() => {
    if (activeViewId !== 'setup' || setupMode !== 'wizard' || !selectedSetupSectionId) {
      previousGuidedSectionRef.current = undefined
      return
    }

    if (previousGuidedSectionRef.current === selectedSetupSectionId) {
      return
    }

    previousGuidedSectionRef.current = selectedSetupSectionId
    trackAppEvent('Guided Setup Step Viewed', {
      step: selectedSetupSectionId
    })
  }, [activeViewId, selectedSetupSectionId, setupMode])

  useEffect(() => {
    const previousKind = previousConnectionKindRef.current
    const nextKind = snapshot.connection.kind

    if (previousKind !== nextKind && nextKind === 'connected') {
      trackAppEvent('Connection Established', {
        transport: transportMode
      })
    }

    previousConnectionKindRef.current = nextKind
  }, [snapshot.connection.kind, transportMode])

  useEffect(() => {
    if (snapshot.connection.kind === 'connected' && snapshot.vehicle !== undefined) {
      setSessionNotice(undefined)
    }
  }, [snapshot.connection.kind, snapshot.vehicle])

  // Depend on the primitive error message, not the connection object:
  // snapshot.connection gets a fresh identity every telemetry tick, so
  // [snapshot.connection] re-fired this effect (re-setting an identical
  // notice) on every tick. (`message` only exists on the error variant,
  // so it is narrowed here rather than read inside the dep array.)
  const connectionErrorMessage =
    snapshot.connection.kind === 'error' ? snapshot.connection.message : undefined
  useEffect(() => {
    if (connectionErrorMessage !== undefined) {
      setSessionNotice({ tone: 'danger', text: describeConnectionError(connectionErrorMessage) })
    }
  }, [connectionErrorMessage])

  useEffect(() => {
    if (snapshot.connection.kind !== 'connected') {
      previousModeSwitchRef.current = {}
      setModeSwitchActivity(undefined)
      // In-flight exercises track live telemetry and must reset on link
      // loss, but TERMINAL results are already-captured data: they survive
      // the planned FC reboots setup itself requires (SERIALx_PROTOCOL /
      // RCMAP_* writes, guided reboot) so the wizard doesn't regress to
      // step one. The signature-gated operator confirmation remains the
      // final review gate if the link comes back on different hardware.
      setOrientationExercise((current) => (current.status === 'passed' ? current : createIdleOrientationExerciseState()))
      setModeSwitchExercise((current) => (current.status === 'passed' ? current : createIdleModeSwitchExerciseState()))
      setRcRangeExercise((current) => (current.status === 'passed' ? current : createIdleRcRangeExerciseState()))
      setRcMappingSession((current) => (current.status === 'ready' ? current : createIdleRcMappingSessionState()))
      setRcCalibrationSession((current) => (current.status === 'ready' ? current : createIdleRcCalibrationSessionState()))
      setMotorVerification((current) => (current.status === 'passed' ? current : createIdleMotorVerificationState()))
      setPropsRemovedAcknowledged(false)
      setTestAreaAcknowledged(false)
      setUsbBenchAcknowledged(false)
      setParameterNotice(undefined)
      setShowReceiverChannelDetails(false)
      setShowReceiverMappingDiagnostics(false)
      return
    }

    if (modeSwitchEstimate.estimatedSlot === undefined || modeSwitchEstimate.pwm === undefined) {
      return
    }

    const previous = previousModeSwitchRef.current
    const slotChanged = previous.slot !== undefined && previous.slot !== modeSwitchEstimate.estimatedSlot
    const pwmChanged = previous.pwm !== undefined && Math.abs(previous.pwm - modeSwitchEstimate.pwm) >= 40

    if (slotChanged || pwmChanged) {
      setModeSwitchActivity({
        previousSlot: previous.slot,
        currentSlot: modeSwitchEstimate.estimatedSlot,
        previousPwm: previous.pwm,
        currentPwm: modeSwitchEstimate.pwm,
        changedAtMs: Date.now()
      })
    }

    previousModeSwitchRef.current = {
      slot: modeSwitchEstimate.estimatedSlot,
      pwm: modeSwitchEstimate.pwm
    }
  }, [snapshot.connection.kind, modeSwitchEstimate.estimatedSlot, modeSwitchEstimate.pwm])

  useEffect(() => {
    if (activeViewId === 'receiver') {
      return
    }

    setReceiverTaskOverride(undefined)
    setShowReceiverMappingDiagnostics(false)
  }, [activeViewId])

  useEffect(() => {
    if (outputMapping.motorOutputs.length === 0) {
      setMotorTestOutput(undefined)
      return
    }

    setMotorTestOutput((current) => {
      if (
        current === ALL_MOTOR_TEST_OUTPUT ||
        current === ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS ||
        (current !== undefined && outputMapping.motorOutputs.some((output) => output.channelNumber === current))
      ) {
        return current
      }

      return outputMapping.motorOutputs[0]?.channelNumber
    })
  }, [outputMapping.motorOutputs])

  useEffect(() => {
    if (modeSwitchExercise.status !== 'running') {
      return
    }

    setModeSwitchExercise((current) => advanceModeSwitchExerciseState(current, snapshot, snapshot.vehicle?.vehicle))
  }, [modeSwitchExercise.status, snapshot])

  useEffect(() => {
    if (orientationExercise.status !== 'running') {
      return
    }

    setOrientationExercise((current) => advanceOrientationExerciseState(current, snapshot))
  }, [orientationExercise.status, snapshot])

  useEffect(() => {
    if (rcRangeExercise.status !== 'running') {
      return
    }

    setRcRangeExercise((current) => advanceRcRangeExerciseState(current, snapshot))
  }, [rcRangeExercise.status, snapshot])

  useEffect(() => {
    if (rcCalibrationSession.status !== 'capturing') {
      return
    }

    setRcCalibrationSession((current) => {
      if (current.status !== 'capturing') {
        return current
      }

      let changed = false
      const nextCaptures = { ...current.captures }

      rcAxisObservations.forEach((observation) => {
        const existing = nextCaptures[observation.axisId]
        if (!existing) {
          return
        }

        const pwm = observation.pwm
        const nextCapture: RcCalibrationAxisCapture = {
          ...existing,
          channelNumber: observation.channelNumber,
          observedMin: pwm !== undefined ? Math.min(existing.observedMin ?? pwm, pwm) : existing.observedMin,
          observedMax: pwm !== undefined ? Math.max(existing.observedMax ?? pwm, pwm) : existing.observedMax,
          trimPwm:
            observation.axisId === 'throttle'
              ? undefined
              : observation.centeredDetected
                ? observation.pwm
                : existing.trimPwm ?? observation.pwm,
          lowObserved: existing.lowObserved || observation.lowDetected,
          highObserved: existing.highObserved || observation.highDetected,
          centeredObserved:
            observation.axisId === 'throttle'
              ? false
              : existing.centeredObserved || observation.centeredDetected || existing.trimPwm !== undefined
        }

        if (
          nextCapture.channelNumber !== existing.channelNumber ||
          nextCapture.observedMin !== existing.observedMin ||
          nextCapture.observedMax !== existing.observedMax ||
          nextCapture.trimPwm !== existing.trimPwm ||
          nextCapture.lowObserved !== existing.lowObserved ||
          nextCapture.highObserved !== existing.highObserved ||
          nextCapture.centeredObserved !== existing.centeredObserved
        ) {
          nextCaptures[observation.axisId] = nextCapture
          changed = true
        }
      })

      const completed = RC_CALIBRATION_AXIS_ORDER.every((axisId) => rcCalibrationCaptureComplete(nextCaptures[axisId]))
      if (completed) {
        return {
          ...current,
          status: 'ready',
          captures: nextCaptures,
          completedAtMs: Date.now(),
          failureReason: undefined
        }
      }

      return changed ? { ...current, captures: nextCaptures } : current
    })
  }, [rcAxisObservations, rcCalibrationSession.status])

  // Memoized: snapshot is a fresh object every telemetry tick, so an
  // unmemoized filter re-ran over the full (1000+ on real hardware)
  // parameter set on every render and made the effect below re-fire each
  // tick (its [filteredParameters] dep was a new array every render).
  const filteredParameters = useMemo<ParameterState[]>(
    () => buildFilteredParameters({ snapshot, parameterSearch, metadataCatalog }),
    [snapshot.parameters, parameterSearch, metadataCatalog]
  )
  const [parameterEnumOverrides, setParameterEnumOverrides] = useState<ReadonlySet<string>>(() => new Set<string>())
  const {
    parameterDraftEntries,
    parameterDraftById,
    parameterDraftSummary,
    stagedParameterDrafts,
    invalidParameterDrafts,
    stagedParameterGroups,
    invalidParameterGroups,
    rebootRequiredDrafts
  } = useParameterDraftDerivations({ snapshot, editedValues, enumOverrides: parameterEnumOverrides })
  // Snapshot-vs-snapshot compare baseline (fleet management):
  // - undefined / 'live' -> baseline is the live FC snapshot (the
  //   default, existing "Restore Preview" behaviour)
  // - a savedSnapshot.id -> baseline is THAT saved snapshot's
  //   parameter values; the diff then reads "what changed from
  //   snapshot A to snapshot B."
  // This lets a fleet operator compare a pre-firmware-bump snapshot
  // to a post-bump snapshot without their two intentional param
  // changes being drowned in 100s of cross-version defaults.
  const [snapshotCompareBaselineId, setSnapshotCompareBaselineId] = useState<string | undefined>(undefined)
  // Live-FC param index, reused for both the live-baseline path (just
  // pass snapshot.parameters straight through) AND the
  // saved-snapshot-baseline path (used as the definition hydration
  // source so diff rows still render with labels/units even when the
  // baseline values come from a snapshot file).
  const snapshotCompareBaselineParameters = useMemo(() => {
    if (!snapshotCompareBaselineId) return snapshot.parameters
    const baseline = savedSnapshots.find((entry) => entry.id === snapshotCompareBaselineId)
    if (!baseline) return snapshot.parameters
    const liveById = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter]))
    return buildParametersFromBackup(baseline.backup, liveById)
  }, [snapshotCompareBaselineId, savedSnapshots, snapshot.parameters])
  const {
    selectedProfile: selectedSnapshot,
    restore: selectedSnapshotRestore,
    diff: {
      entries: selectedSnapshotDiffEntries,
      groups: selectedSnapshotDiffGroups,
      changed: selectedSnapshotChangedEntries,
      invalid: selectedSnapshotInvalidEntries,
      signature: selectedSnapshotDiffSignature
    }
  } = useSelectedProfileDiff({
    snapshotParameters: snapshotCompareBaselineParameters,
    savedProfiles: savedSnapshots,
    selectedProfileId: selectedSnapshotId,
    resolveBackup: resolveSnapshotBackup
  })
  const {
    handleCaptureLiveSnapshot,
    handleImportSnapshotFile,
    handleExportSnapshotLibrary,
    handleOpenDesktopSnapshotFile,
    handleSaveDesktopSnapshotLibrary,
    handleExportSelectedSnapshotToDesktop,
    handleExportSelectedSnapshot,
    handleDeleteSelectedSnapshot,
    handleToggleSelectedSnapshotProtection
  } = useSnapshotLibrary({
    snapshot,
    desktopBridge,
    selectedSnapshot,
    savedSnapshots,
    setSavedSnapshots,
    setSelectedSnapshotId,
    snapshotLabelInput,
    setSnapshotLabelInput,
    snapshotNoteInput,
    setSnapshotNoteInput,
    snapshotTagsInput,
    setSnapshotTagsInput,
    snapshotProtectedInput,
    setSnapshotProtectedInput,
    desktopSnapshotLibraryPath,
    setDesktopSnapshotLibraryPath,
    desktopSnapshotLibraryName,
    setDesktopSnapshotLibraryName,
    setSnapshotNotice
  })
  const selectedSnapshotRebootSensitiveCount = useMemo(
    () => selectedSnapshotChangedEntries.filter((entry) => entry.definition?.rebootRequired).length,
    [selectedSnapshotChangedEntries]
  )
  const stagedProvisioningOverlayParameters = useMemo(
    () => deriveProvisioningOverlayParametersFromDrafts(stagedParameterDrafts),
    [stagedParameterDrafts]
  )
  const {
    selectedProfile: selectedProvisioningProfile,
    restore: selectedProvisioningProfileRestore,
    diff: {
      entries: selectedProvisioningProfileDiffEntries,
      groups: selectedProvisioningProfileDiffGroups,
      changed: selectedProvisioningProfileChangedEntries,
      invalid: selectedProvisioningProfileInvalidEntries,
      signature: selectedProvisioningProfileDiffSignature
    }
  } = useSelectedProfileDiff({
    snapshotParameters: snapshot.parameters,
    savedProfiles: savedProvisioningProfiles,
    selectedProfileId: selectedProvisioningProfileId,
    resolveBackup: deriveProvisioningProfileBackup
  })
  const {
    handleImportProvisioningLibrary,
    handleCreateProvisioningProfile,
    handleExportProvisioningLibrary,
    handleExportSelectedProvisioningProfile,
    handleDeleteSelectedProvisioningProfile,
    handleToggleSelectedProvisioningProfileProtection
  } = useProvisioningProfiles({
    snapshot,
    selectedSnapshot,
    selectedProvisioningProfile,
    savedProvisioningProfiles,
    setSavedProvisioningProfiles,
    setSelectedProvisioningProfileId,
    stagedProvisioningOverlayParameters,
    includeDraftOverlayInProvisioningProfile,
    setIncludeDraftOverlayInProvisioningProfile,
    provisioningProfileSourceInput,
    provisioningProfileLabelInput,
    setProvisioningProfileLabelInput,
    provisioningProfileModelInput,
    setProvisioningProfileModelInput,
    provisioningProfileFleetInput,
    setProvisioningProfileFleetInput,
    provisioningProfileMissionInput,
    setProvisioningProfileMissionInput,
    provisioningProfileNoteInput,
    setProvisioningProfileNoteInput,
    provisioningProfileTagsInput,
    setProvisioningProfileTagsInput,
    provisioningProfileChecklistInput,
    setProvisioningProfileChecklistInput,
    provisioningProfileProtectedInput,
    setProvisioningProfileProtectedInput,
    setProvisioningNotice
  })
  const {
    selectedProfile: selectedTuningProfile,
    restore: selectedTuningProfileRestore,
    diff: {
      entries: selectedTuningProfileDiffEntries,
      groups: selectedTuningProfileDiffGroups,
      changed: selectedTuningProfileChangedEntries,
      invalid: selectedTuningProfileInvalidEntries
    }
  } = useSelectedProfileDiff({
    snapshotParameters: snapshot.parameters,
    savedProfiles: savedTuningProfiles,
    selectedProfileId: selectedTuningProfileId,
    resolveBackup: resolveTuningProfileBackup
  })
  const {
    tuningProfileSourceBackup,
    tuningProfileSourceUsesStaged,
    canCreateTuningProfile
  } = useTuningProfileSource({ snapshot, parameterDraftById, tuningProfileSourceInput })
  const {
    handleCreateTuningProfile,
    handleDeleteSelectedTuningProfile,
    handleToggleSelectedTuningProfileProtection
  } = useTuningProfiles({
    canCreateTuningProfile,
    tuningProfileSourceUsesStaged,
    tuningProfileSourceBackup,
    selectedTuningProfile,
    savedTuningProfiles,
    setSavedTuningProfiles,
    setSelectedTuningProfileId,
    tuningProfileLabelInput,
    setTuningProfileLabelInput,
    tuningProfileNoteInput,
    setTuningProfileNoteInput,
    tuningProfileProtectedInput,
    setTuningProfileProtectedInput,
    tuningProfileSourceInput,
    setTuningProfileSourceInput,
    setTuningProfileNotice
  })
  const {
    tuningMasterPreviewDraftValues,
    tuningMasterPreviewEntries,
    tuningMasterDefaultsActive
  } = useTuningMasterPreview({
    snapshot,
    parameterDraftById,
    tuningMasterPiGain,
    tuningMasterDGain,
    tuningMasterFeedforwardGain,
    tuningMasterPitchRatio,
    tuningMasterFilterStrength
  })
  const {
    presetDefinitions,
    presetGroups,
    presetPreviewById,
    selectedPreset,
    selectedPresetDiff,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    selectedPresetDiffSignature
  } = usePresetCatalog({ snapshot, metadataCatalog, selectedPresetId })
  const {
    receiverDraftEntries,
    receiverStagedDrafts,
    receiverInvalidDrafts,
    portsDraftEntries,
    portsStagedDrafts,
    portsInvalidDrafts,
    configDraftEntries,
    configStagedDrafts,
    configInvalidDrafts,
    osdStagedDrafts,
    osdInvalidDrafts,
    vtxStagedDrafts,
    vtxInvalidDrafts,
    frameDraftEntries,
    frameStagedDrafts,
    frameInvalidDrafts,
    powerDraftEntries,
    powerStagedDrafts,
    powerInvalidDrafts,
    tuningDraftEntries,
    tuningStagedDrafts,
    tuningInvalidDrafts,
    planeTuningDraftEntries,
    planeTuningStagedDrafts,
    planeTuningInvalidDrafts,
    planeSoaringAdsbDraftEntries,
    planeSoaringAdsbStagedDrafts,
    planeSoaringAdsbInvalidDrafts,
    copterAutotuneDraftEntries,
    copterAutotuneStagedDrafts,
    copterAutotuneInvalidDrafts,
    planeAutotuneDraftEntries,
    planeAutotuneStagedDrafts,
    planeAutotuneInvalidDrafts,
    roverTuningDraftEntries,
    roverTuningStagedDrafts,
    roverTuningInvalidDrafts,
    subTuningDraftEntries,
    subTuningStagedDrafts,
    subTuningInvalidDrafts,
    tuningRateStagedDrafts,
    tuningRateInvalidDrafts,
    tuningPidStagedDrafts,
    tuningPidInvalidDrafts,
    tuningFilterStagedDrafts,
    tuningFilterInvalidDrafts,
    outputReviewDraftEntries,
    outputReviewStagedDrafts,
    outputReviewInvalidDrafts,
    outputNotificationDraftEntries,
    outputNotificationStagedDrafts,
    outputNotificationInvalidDrafts,
    outputAssignmentDraftEntries,
    outputAssignmentStagedDrafts,
    outputAssignmentInvalidDrafts
  } = useViewDraftSelectors({ parameterDraftEntries, isConfigParamId })
  const canApplyAllDraftParameters =
    canApplyDraftParameters && stagedParameterDrafts.length > 0 && invalidParameterDrafts.length === 0
  const rcMappingDerivations = useRcMappingDerivations({
    snapshot,
    rcMappingSession,
    rcMappingAutoCaptureState,
    currentRcAxisChannelMap
  })
  const {
    rcMappingCandidate,
    rcMappingCapturedCount,
    rcMappingTargetGuide,
    rcMappingRejectedReason,
    rcMappingSummary
  } = rcMappingDerivations
  const selectedParameter =
    filteredParameters.find((parameter) => parameter.id === selectedParameterId) ?? filteredParameters[0]
  // Prefer the upstream-enriched catalog definition (label/description/range/
  // options/unit) over the runtime-attached one, which only covers curated
  // params. Falls back to the runtime definition when the catalog has none.
  const selectedParameterDefinition = selectedParameter
    ? metadataCatalog.parameters[selectedParameter.id] ?? selectedParameter.definition
    : undefined
  const selectedParameterDraft = selectedParameter ? parameterDraftById.get(selectedParameter.id) : undefined
  // selectedParameterOption is computed inside ParametersSection now;
  // keep selectedParameterDraft (used by other places in App.tsx — config view).
  void selectedParameterDraft
  void selectedParameterDefinition
  const modeAssignmentParameters = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => modeSlotParamId(snapshot.vehicle?.vehicle, index + 1))
        .map((paramId) => selectParameterById(snapshot, paramId))
        .filter((parameter): parameter is ParameterState => parameter !== undefined),
    [snapshot.parameters, snapshot.vehicle?.vehicle]
  )
  const {
    serialPortViewModels,
    visibleSerialPortViewModels,
    hiddenSerialPortCount,
    receiverLinkPorts,
    vtxLinkPorts,
    osdLinkPorts
  } = useSerialPortModels({ snapshot, boardCatalogEntry, portsDraftEntries, showAllSerialPorts })
  const boardReferenceLinks = boardCatalogEntry?.referenceLinks ?? []
  const boardMediaAssets = boardCatalogEntry?.mediaAssets ?? []
  const boardVariants = boardCatalogEntry?.variants ?? []
  // The FC reports one board_id for a whole family (e.g. all H743 variants), so
  // the operator picks which variant to view official photos for (defaults to
  // the first). The lightbox media selection + Escape-to-close lives here too.
  const boardMediaPicker = useBoardMediaPicker(boardVariants)
  const {
    selectedBoardMedia,
    setSelectedBoardMedia
  } = boardMediaPicker
  const uartsMappedPortCount = snapshot.hardware.uartsFile.mappings.length
  const uartsStatusTone: StatusTone =
    snapshot.hardware.uartsFile.status === 'ready'
      ? 'success'
      : snapshot.hardware.uartsFile.status === 'loading'
        ? 'warning'
        : snapshot.hardware.uartsFile.status === 'unsupported'
          ? 'neutral'
          : snapshot.hardware.uartsFile.status === 'missing' || snapshot.hardware.uartsFile.status === 'error'
            ? 'warning'
            : 'neutral'
  const rememberedSerialPortLabel = describeRememberedSerialPort(rememberedSerialPortInfo)
  const gpsPeripheralViewModels = useMemo(() => buildGpsPeripheralViewModels(snapshot), [snapshot])
  const canNodePeripheralViewModels = useMemo(() => buildCanNodePeripheralViewModels(snapshot), [snapshot.canNodes])
  const {
    gpsAutoConfigParameter,
    gpsAutoSwitchParameter,
    gpsPrimaryParameter,
    gpsRateParameter
  } = useGpsCatalog(snapshot)
  const {
    osdParameterById,
    osdTypeParameter,
    osdChannelParameter,
    osdSwitchMethodParameter,
    mspOptionsParameter,
    mspOsdCellCountParameter
  } = useOsdCatalog(snapshot)
  const osdEditor = useOsdEditor({ snapshot, osdParameterById, editedValues, setDraft, setParameterNotice })
  const {
    vtxEnableParameter,
    vtxFrequencyParameter,
    vtxPowerParameter,
    vtxMaxPowerParameter,
    vtxOptionsParameter
  } = useVtxCatalog(snapshot)
  const receiverSupportCatalog = useReceiverSupportCatalog(snapshot)
  const {
    batteryMonitorParameter,
    batteryCapacityParameter,
    batteryArmVoltageParameter,
    batteryArmMahParameter
    // Failsafe parameter objects (thresholds, voltage source, actions,
    // throttle FS) are not rendered by the Power tab anymore — every
    // failsafe-shaped knob lives on the Failsafe tab now.
  } = usePowerReviewCatalog(snapshot)
  const {
    tuningParameters,
    tuningParameterById,
    flightFeelParameters,
    tuningAccelerationParameters,
    acroTuningParameters,
    tuningAdvancedPidParameters,
    tuningFilterParameters,
    tuningPidAxisGroups,
    tuningFilterAxisGroups,
    tuningAdvancedPidAxisGroups
  } = useTuningCatalog(snapshot)
  const outputReviewParameters = useMemo(
    () =>
      OUTPUT_REVIEW_PARAM_IDS.map((paramId) => selectParameterById(snapshot, paramId)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      ),
    [snapshot.parameters]
  )
  const outputNotificationCatalog = useOutputNotificationCatalog(snapshot)
  const {
    notificationLedTypesParameter,
    notificationBuzzTypesParameter
  } = outputNotificationCatalog
  const motorOutputAssignments = useMotorOutputAssignments({ snapshot, editedValues })
  const {
    outputAssignmentParameters,
    outputAssignmentParameterById,
    effectiveMotorOutputs
  } = motorOutputAssignments
  const motorPreviewCount = Math.max(
    airframe.expectedMotorCount ?? 0,
    effectiveMotorOutputs.length,
    outputMapping.motorOutputs.length
  )
  const motorPreviewNodes = useMemo(
    () => createMotorPreviewNodes(motorPreviewCount, airframe.frameTypeLabel),
    [airframe.frameTypeLabel, motorPreviewCount]
  )
  const motorPreviewGeometryMode = airframe.frameTypeLabel.includes('+') ? 'plus' : 'x'
  const outputAssignmentVisibility = useOutputAssignmentVisibility({
    expectedMotorCount: airframe.expectedMotorCount,
    configuredOutputs,
    outputAssignmentDraftEntries,
    outputAssignmentParameters,
    showAllOutputAssignments
  })
  const {
    motorReorderRows,
    motorReorderDuplicateChannels,
    motorReorderChangedCount,
    motorReorderCanStage
  } = useMotorReorder({ effectiveMotorOutputs, motorReorderSelections })
  // Staged drafts the Motor Setup dialog can write in place (the per-output
  // SERVOn_FUNCTION reorder params + the SERVO_BLH_RVMASK reverse mask), so the
  // operator can Apply + Reboot from inside the popout instead of closing,
  // applying from the Outputs view, refreshing, and reopening.
  const motorReorderDialogParamIds = useMemo(() => {
    const ids = new Set<string>(['SERVO_BLH_RVMASK'])
    effectiveMotorOutputs.forEach((output) => ids.add(output.paramId))
    return ids
  }, [effectiveMotorOutputs])
  const motorReorderDialogStagedDrafts = useMemo(
    () => stagedParameterDrafts.filter((draft) => motorReorderDialogParamIds.has(draft.id)),
    [stagedParameterDrafts, motorReorderDialogParamIds]
  )
  const {
    groups: setupAdditionalGroups,
    entries: setupAdditionalDraftEntries,
    staged: setupAdditionalStagedDrafts,
    invalid: setupAdditionalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'setup',
    parameterDraftEntries
  })
  const {
    groups: portsAdditionalGroups,
    entries: portsAdditionalDraftEntries,
    staged: portsAdditionalStagedDrafts,
    invalid: portsAdditionalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'ports',
    excludedParameterIds: isPortsReviewParamId,
    parameterDraftEntries
  })
  const receiverAdditional = useReceiverAdditional({ snapshot, metadataCatalog, parameterDraftEntries })
  const { receiverAdditionalStagedDrafts, receiverAdditionalInvalidDrafts } = receiverAdditional
  const {
    groups: powerAdditionalGroups,
    entries: powerAdditionalDraftEntries,
    staged: powerAdditionalStagedDrafts,
    invalid: powerAdditionalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'power',
    excludedParameterIds: isPowerReviewParamId,
    parameterDraftEntries
  })
  // Failsafe gets its own additional-settings scope now that the 'failsafe'
  // category routes to the Failsafe view (it used to leak into Power).
  // No exclusion: the FailsafeSection builds its primary rows from
  // buildFailsafeRows + filters those ids out of the additional list at
  // render time so a param doesn't double-render.
  const {
    groups: failsafeAdditionalGroups,
    entries: failsafeAdditionalDraftEntries,
    staged: failsafeAdditionalStagedDrafts,
    invalid: failsafeAdditionalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'failsafe',
    parameterDraftEntries
  })
  const {
    groups: outputAdditionalGroups,
    entries: outputAdditionalDraftEntries,
    staged: outputAdditionalStagedDrafts,
    invalid: outputAdditionalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    // Most "Outputs" categories now route to the Motors tab; aux
    // servo-only additional groups are surfaced separately for the
    // Servos tab below.
    viewId: 'motors',
    excludedParameterIds: isOutputAdditionalExcludedParamId,
    parameterDraftEntries
  })
  const totalOutputInvalidDrafts =
    outputReviewInvalidDrafts.length +
    outputNotificationInvalidDrafts.length +
    outputAssignmentInvalidDrafts.length +
    outputAdditionalInvalidDrafts.length
  const totalOutputStagedDrafts =
    outputReviewStagedDrafts.length +
    outputNotificationStagedDrafts.length +
    outputAssignmentStagedDrafts.length +
    outputAdditionalStagedDrafts.length
  const outputPeripheralStagedDraftCount = outputNotificationStagedDrafts.length + outputAdditionalStagedDrafts.length
  const outputPeripheralInvalidDraftCount = outputNotificationInvalidDrafts.length + outputAdditionalInvalidDrafts.length
  const outputHasPendingReview = totalOutputInvalidDrafts + totalOutputStagedDrafts > 0
  const outputReviewDraftSummaries = useMemo<OutputReviewDraftSummary[]>(
    () =>
      buildOutputReviewDraftSummaries({
        outputAssignmentDraftEntries,
        outputReviewDraftEntries,
        outputNotificationDraftEntries,
        outputAdditionalDraftEntries
      }),
    [outputAdditionalDraftEntries, outputAssignmentDraftEntries, outputNotificationDraftEntries, outputReviewDraftEntries]
  )
  const editedNotificationLedTypes = normalizeBitmaskValue(editedValues.NTF_LED_TYPES, notificationLedTypes)
  const editedNotificationBuzzTypes = normalizeBitmaskValue(editedValues.NTF_BUZZ_TYPES, notificationBuzzTypes)
  const notificationLedOutputs = useMemo(
    () => configuredOutputs.filter((output) => isNotificationLedServoFunction(output.functionValue)),
    [configuredOutputs]
  )
  const recentModeSwitchChange = modeSwitchActivity && Date.now() - modeSwitchActivity.changedAtMs < 3000
  const modeSwitchDerivations = useModeSwitchDerivations({
    snapshot,
    modeSwitchExercise,
    modeSwitchEstimate,
    modeExerciseAssignments
  })
  const { modeSwitchExerciseSummary } = modeSwitchDerivations
  const rcRangeDerivations = useRcRangeDerivations({ snapshot, rcRangeExercise })
  const { rcRangeExerciseCompletedCount, rcRangeExerciseSummary } = rcRangeDerivations

  useEffect(() => {
    if (filteredParameters.length === 0) {
      setSelectedParameterId(undefined)
      return
    }

    if (!selectedParameterId || !filteredParameters.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(filteredParameters[0]?.id)
    }
  }, [filteredParameters, selectedParameterId])

  async function connectAndSync(): Promise<void> {
    await runtime.connect()
    await runtime.requestParameterList()
    if (parameterFollowUp?.refreshRequired) {
      await runtime.waitForParameterSync()
      setParameterFollowUp(undefined)
    }
  }

  async function handleConnect(): Promise<void> {
    setBusyAction('connect')
    try {
      setSessionNotice(undefined)
      await connectAndSync()
    } catch (error) {
      let lastError = error
      // Stale-handle recovery: a re-enumerated FC's picked handle throws
      // "The device has been lost". Until now only a PAGE REFRESH fixed
      // it (mount re-acquires the device's current handle via
      // getPorts()). Do exactly that inline, once: re-acquire, point the
      // transport resolver ref at the fresh handle synchronously (the
      // setState path lags a render), and retry.
      if (
        transportMode === 'web-serial' &&
        isStaleSerialHandleError(runtime.getSnapshot().connection, lastError)
      ) {
        await runtime.disconnect().catch(() => {})
        const freshPort = await reacquireSerialPort()
        if (freshPort) {
          selectedSerialPortRef.current = freshPort
          try {
            await connectAndSync()
            setSessionNotice(undefined)
            return
          } catch (retryError) {
            lastError = retryError
          }
        }
      }

      const currentSnapshot = runtime.getSnapshot()
      setSessionNotice({
        tone: 'danger',
        text: describeConnectFailure(transportMode, currentSnapshot.connection, lastError)
      })
      // Release the port on a genuine failed connect so a retry works
      // without a page refresh — but NOT when a heartbeat arrived just
      // after the waitForVehicle timeout (DEFAULT_HEARTBEAT_TIMEOUT_MS;
      // its reject is a timer; the vehicle can become defined a tick
      // later on a slow-boot Cube/Plane
      // and tearing that live link down forces a needless reconnect).
      // Re-read fresh (not currentSnapshot, captured above) and only tear
      // down the genuine stale-'connected'-without-vehicle case.
      const teardownSnapshot = runtime.getSnapshot()
      if (
        !(
          teardownSnapshot.connection.kind === 'connected' &&
          teardownSnapshot.vehicle !== undefined
        )
      ) {
        await runtime.disconnect().catch(() => {})
      }
    } finally {
      setBusyAction(undefined)
    }
  }

  async function handleDisconnect(): Promise<void> {
    // A deliberate disconnect cancels any in-flight reboot reconnect so the
    // loop can't fight the operator by re-opening the link they just closed.
    expectRebootReconnectRef.current = false
    rebootReconnectingRef.current = false
    setBusyAction('disconnect')
    try {
      setSessionNotice(undefined)
      await runtime.disconnect()
    } finally {
      setBusyAction(undefined)
    }
  }

  async function handleGuidedAction(actionId: GuidedActionId): Promise<void> {
    // Arm reconnect-after-reboot before issuing the command: on a web-serial
    // link the FC drops the moment it reboots, so the flag must be set before
    // the disconnect event lands.
    if (actionId === 'reboot-autopilot' && transportMode === 'web-serial' && selectedSerialPort) {
      expectRebootReconnectRef.current = true
    }
    setBusyAction(actionId)
    try {
      await runtime.runGuidedAction(actionId)
      if (actionId === 'reboot-autopilot') {
        setParameterFollowUp((current) =>
          current?.requiresReboot
            ? {
                ...current,
                requiresReboot: false,
                refreshRequired: true,
                text: 'Reboot requested. Reconnect if needed, then pull parameters again before continuing guided setup.'
              }
            : current
        )
      }
      if (actionId === 'request-parameters') {
        await runtime.waitForParameterSync()
        setParameterFollowUp((current) => (current?.refreshRequired ? undefined : current))
      }
    } catch (error) {
      // runGuidedAction re-throws after the service has already recorded
      // the failure in the guided-action snapshot (failAction + emit), so
      // the inline action card shows it. Catch here so the rejection is
      // surfaced as a notice rather than becoming an unhandled promise
      // rejection — e.g. an autopilot or the demo mock answering
      // PREFLIGHT_CALIBRATION with UNSUPPORTED.
      setParameterNotice({
        tone: 'danger',
        text: `${actionLabels[actionId]} could not be completed: ${
          error instanceof Error ? error.message : 'the autopilot rejected the request.'
        }`
      })
    } finally {
      setBusyAction(undefined)
    }
  }

  function handleCancelGuidedAction(actionId: GuidedActionId): void {
    runtime.cancelGuidedAction(actionId)
    setParameterNotice({
      tone: 'warning',
      text: `${actionLabels[actionId]} cancelled. Parameter writes are unblocked; re-run the calibration before flying.`
    })
  }

  function outputTaskForTarget(targetElementId?: string): OutputTaskId | undefined {
    switch (targetElementId) {
      case OUTPUTS_ORIENTATION_TARGET_ID:
      case OUTPUTS_ORIENTATION_BUTTON_ID:
        return 'motor-setup'
      case OUTPUTS_BENCH_TARGET_ID:
      case OUTPUTS_MOTOR_START_BUTTON_ID:
      case OUTPUTS_MOTOR_TEST_BUTTON_ID:
      case OUTPUTS_MOTOR_CONFIRM_BUTTON_ID:
        return 'direction-test'
      default:
        return undefined
    }
  }

  function scrollToPanel(panelId: string, targetElementId?: string): void {
    const targetViewId = appViewForPanel(panelId)
    const scrollTargetId = targetElementId ?? panelId
    if (targetViewId === 'motors' || targetViewId === 'servos') {
      const outputTaskId = outputTaskForTarget(targetElementId)
      if (outputTaskId) {
        setOutputTaskOverride(outputTaskId)
      }
    }
    const performScroll = () => {
      const target = document.getElementById(scrollTargetId)
      if (!target) {
        return
      }

      const headerOffset = 112
      const targetTop = Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerOffset)
      window.scrollTo({
        top: targetTop,
        behavior: 'smooth'
      })
      window.setTimeout(() => {
        if (target instanceof HTMLElement) {
          target.focus({ preventScroll: true })
        }
      }, 240)
    }
    if (panelId === 'setup-panel-guided') {
      setSetupMode('wizard')
    } else if (panelId === 'setup-panel-link') {
      setSetupMode('overview')
    }
    if (targetViewId !== activeViewId) {
      setActiveViewId(targetViewId)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          performScroll()
        })
      })
      return
    }

    performScroll()
  }

  function openSetupWizard(sectionId?: string, focusTargetId?: string): void {
    if (sectionId) {
      setSelectedSetupSectionId(sectionId)
    } else if (guidedSetupShortcutSectionId) {
      setSelectedSetupSectionId(guidedSetupShortcutSectionId)
    } else if (recommendedSetupSection) {
      setSelectedSetupSectionId(recommendedSetupSection.id)
    }
    setPendingSetupWizardFocusId(focusTargetId)
    setActiveViewId('setup')
    setSetupMode('wizard')
  }

  function closeSetupWizard(): void {
    setPendingSetupWizardFocusId(undefined)
    setSetupMode('overview')
  }

  function focusOutputsTarget(targetElementId: string): void {
    const outputTaskId = outputTaskForTarget(targetElementId)
    if (outputTaskId) {
      setOutputTaskOverride(outputTaskId)
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToPanel('setup-panel-outputs', targetElementId)
      })
    })
  }

  useEffect(() => {
    if (activeViewId !== 'setup' || setupMode !== 'wizard' || !pendingSetupWizardFocusId) {
      return
    }

    const focusId = pendingSetupWizardFocusId
    const timer = window.setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      })

      window.setTimeout(() => {
        const target = document.getElementById(focusId)
        if (target instanceof HTMLElement) {
          target.focus({ preventScroll: true })
        }
        setPendingSetupWizardFocusId(undefined)
      }, 240)
    }, 40)

    return () => window.clearTimeout(timer)
  }, [activeViewId, pendingSetupWizardFocusId, setupMode])

  useEffect(() => {
    if (!guidedSetupShortcutSectionId || guidedSetupShortcutAppliedRef.current) {
      return
    }

    guidedSetupShortcutAppliedRef.current = true
    setSelectedSetupSectionId(guidedSetupShortcutSectionId)
    setActiveViewId('setup')
    setSetupMode('wizard')
  }, [guidedSetupShortcutSectionId])

  function handleDiscardParameterDraft(paramId: string): void {
    clearDraft(paramId)
  }

  function handleDiscardAllParameterDrafts(): void {
    clearAllDrafts()
    setParameterNotice({
      tone: 'neutral',
      text: 'Cleared all local parameter drafts.'
    })
  }

  function handleDiscardScopedParameterDrafts(paramIds: readonly string[], scopeLabel: string): void {
    const removableIds = paramIds.filter((paramId) => editedValues[paramId] !== undefined)
    if (removableIds.length === 0) {
      return
    }

    clearDrafts(removableIds)
    setParameterNotice({
      tone: 'neutral',
      text: `Cleared ${removableIds.length} ${scopeLabel} draft change(s).`
    })
  }

  // Operator opted in to "Override and write anyway" on an enum-mismatch
  // draft (metadata may lag firmware on legitimate new enum values).
  // Toggles membership so the same button can also REMOVE the override and
  // re-flag the draft as invalid for review.
  function handleToggleParameterEnumOverride(paramId: string): void {
    setParameterEnumOverrides((current) => {
      const next = new Set(current)
      if (next.has(paramId)) {
        next.delete(paramId)
      } else {
        next.add(paramId)
      }
      return next
    })
  }

  // Drop overrides for any paramId whose draft has been cleared (applied,
  // discarded, or replaced via a backup import) — otherwise a re-entered
  // value would silently inherit the prior override.
  useEffect(() => {
    setParameterEnumOverrides((current) => {
      if (current.size === 0) return current
      let mutated = false
      const next = new Set<string>()
      current.forEach((paramId) => {
        if (editedValues[paramId] !== undefined) {
          next.add(paramId)
        } else {
          mutated = true
        }
      })
      return mutated ? next : current
    })
  }, [editedValues])

  async function handleApplyScopedParameterDrafts(
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ): Promise<void> {
    if (!canApplyDraftParameters) {
      setParameterNotice({
        tone: 'warning',
        text:
          parameterApplyBlockedReason(snapshot) ??
          'Connect, finish parameter sync, and keep the vehicle disarmed before applying configuration changes.'
      })
      return
    }

    const invalidDrafts = drafts.filter((entry) => entry.status === 'invalid')
    if (invalidDrafts.length > 0) {
      setParameterNotice({
        tone: 'danger',
        text: `${scopeLabel} has ${invalidDrafts.length} invalid value(s). Fix them before applying from this view.`
      })
      return
    }

    const stagedDrafts = drafts.filter((entry) => entry.status === 'staged' && entry.nextValue !== undefined)
    if (stagedDrafts.length === 0) {
      setParameterNotice({
        tone: 'neutral',
        text: `No ${scopeLabel.toLowerCase()} changes are staged in this view.`
      })
      return
    }

    const appliedParamIds: string[] = []
    setBusyAction(busyKey)
    try {
      const rebootRequiredCount = stagedDrafts.filter((entry) => entry.definition?.rebootRequired).length
      const result = await runtime.setParameters(
        stagedDrafts.map((entry) => ({
          paramId: entry.id,
          paramValue: entry.nextValue as number
        })),
        UI_PARAMETER_WRITE_OPTIONS
      )
      appliedParamIds.push(...result.applied.map((entry) => entry.paramId))
      setParameterNotice({
        tone: 'success',
        text:
          result.applied.length === 0
            ? `No ${scopeLabel.toLowerCase()} changes needed to be written.`
            : `Verified ${result.applied.length} ${scopeLabel.toLowerCase()} change(s) from this view.`
      })
      setParameterFollowUp({
        requiresReboot: rebootRequiredCount > 0,
        refreshRequired: true,
        changedCount: result.applied.length,
        text:
          rebootRequiredCount > 0
            ? `${scopeLabel} changed reboot-sensitive settings. Request a reboot, then pull parameters again before continuing setup.`
            : `${scopeLabel} changed live controller values. Auto-refreshing the parameter snapshot…`
      })
      // Auto-refresh the parameter snapshot when no reboot is required —
      // the user previously had to click a separate Refresh button to
      // clear the refreshRequired follow-up bit. Reboot-required follow-
      // ups intentionally do NOT auto-refresh: the operator must reboot
      // first or the pull races the still-old running firmware.
      if (rebootRequiredCount === 0 && result.applied.length > 0) {
        try {
          await runtime.requestParameterList()
          await runtime.waitForParameterSync()
          setParameterFollowUp((current) => (current?.refreshRequired && !current.requiresReboot ? undefined : current))
        } catch {
          // A refresh hiccup is non-fatal — the write itself already
          // verified each value. Leave the follow-up bit so the operator
          // can click Refresh manually.
        }
      }
    } catch (error) {
      setParameterNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : `${scopeLabel} write failed.`
      })
    } finally {
      if (appliedParamIds.length > 0) {
        clearDrafts(appliedParamIds)
      }

      setBusyAction(undefined)
    }
  }

  async function handleApplyParameterDraft(draft: ParameterDraftEntry): Promise<void> {
    if (!canApplyDraftParameters || draft.status !== 'staged' || draft.nextValue === undefined) {
      return
    }

    setBusyAction(`param:${draft.id}`)
    try {
      const result = await runtime.setParameter(draft.id, draft.nextValue, UI_PARAMETER_WRITE_OPTIONS)
      handleDiscardParameterDraft(draft.id)
      const confirmedParameter = selectParameterById(snapshot, result.paramId)
      const requiresReboot = Boolean(draft.definition?.rebootRequired)
      setParameterNotice({
        tone: 'success',
        text: `Verified ${result.paramId} = ${formatParameterDisplayValue(confirmedParameter, result.confirmedValue)}.`
      })
      setParameterFollowUp({
        requiresReboot,
        refreshRequired: true,
        changedCount: 1,
        text: requiresReboot
          ? 'This applied change is marked as reboot-required. Request a reboot, then pull parameters again before continuing guided setup.'
          : 'Pull parameters again if you want a freshly confirmed post-write snapshot.'
      })
    } catch (error) {
      setParameterNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Parameter write failed.'
      })
    } finally {
      setBusyAction(undefined)
    }
  }

  async function handleApplyAllParameterDrafts(): Promise<void> {
    if (!canApplyAllDraftParameters) {
      return
    }

    const appliedParamIds: string[] = []
    setBusyAction('param:apply-all')
    const writeRequests = stagedParameterDrafts
      .filter((draft) => draft.nextValue !== undefined)
      .map((draft) => ({
        paramId: draft.id,
        paramValue: draft.nextValue as number
      }))
    setApplyAllProgress({ completed: 0, total: writeRequests.length })
    try {
      const applyingRebootRequiredCount = stagedParameterDrafts.filter((draft) => draft.definition?.rebootRequired).length
      const result = await runtime.setParameters(
        writeRequests,
        UI_PARAMETER_WRITE_OPTIONS,
        (progress) => setApplyAllProgress({ completed: progress.completed, total: progress.total })
      )
      appliedParamIds.push(...result.applied.map((entry) => entry.paramId))
      setParameterNotice({
        tone: 'success',
        text:
          result.applied.length === 0
            ? 'No staged parameter changes needed to be written.'
            : `Verified ${result.applied.length} staged parameter change(s).`
      })
      setParameterFollowUp({
        requiresReboot: applyingRebootRequiredCount > 0,
        refreshRequired: true,
        changedCount: result.applied.length,
        text:
          applyingRebootRequiredCount > 0
            ? `${applyingRebootRequiredCount} applied change(s) are marked as reboot-required. Request a reboot, then refresh parameters before continuing setup.`
            : 'Auto-refreshing the parameter snapshot after the batch write…'
      })
      // Auto-refresh after the batch write when no reboot is required.
      // Mirrors the scoped-apply path; same caveat — reboot-required
      // writes skip the auto-refresh because the pull would race the
      // still-old running firmware.
      if (applyingRebootRequiredCount === 0 && result.applied.length > 0) {
        try {
          await runtime.requestParameterList()
          await runtime.waitForParameterSync()
          setParameterFollowUp((current) => (current?.refreshRequired && !current.requiresReboot ? undefined : current))
        } catch {
          // Non-fatal — leave the bit for manual Refresh.
        }
      }
    } catch (error) {
      setParameterNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Batch parameter write failed.'
      })
    } finally {
      if (appliedParamIds.length > 0) {
        clearDrafts(appliedParamIds)
      }

      setApplyAllProgress(undefined)
      setBusyAction(undefined)
    }
  }

  // Label for the in-flight batch write — "Writing… (12/200)" once progress is
  // known, plain "Writing…" before the first tick.
  const applyAllBusyLabel =
    applyAllProgress && applyAllProgress.total > 0
      ? `Writing… (${applyAllProgress.completed}/${applyAllProgress.total})`
      : 'Writing…'

  function handleOpenParameterBackup(): void {
    parameterBackupInputRef.current?.click()
  }


  function handleOpenSnapshotImport(): void {
    snapshotImportInputRef.current?.click()
  }

  function handleOpenProvisioningImport(): void {
    provisioningImportInputRef.current?.click()
  }

  function handleStageSelectedProvisioningProfileDiff(): void {
    if (!selectedProvisioningProfile || !selectedProvisioningProfileRestore) {
      return
    }

    if (selectedProvisioningProfileChangedEntries.length === 0) {
      setProvisioningNotice({
        tone: 'neutral',
        text: `Provisioning profile "${selectedProvisioningProfile.label}" already matches the live controller values.`
      })
      return
    }

    replaceDrafts(selectedProvisioningProfileRestore.draftValues)
    setSelectedParameterId(selectedProvisioningProfileChangedEntries[0]?.id ?? selectedParameterId)
    setActiveViewId('parameters')
    setProvisioningNotice({
      tone: 'warning',
      text: `Loaded ${selectedProvisioningProfileRestore.changedCount} provisioning change(s) into the Expert parameter editor draft set.`
    })
  }

  async function handleApplySelectedProvisioningProfile(): Promise<void> {
    if (!selectedProvisioningProfile) {
      return
    }

    if (!provisioningRestoreAcknowledged) {
      setProvisioningNotice({
        tone: 'warning',
        text: 'Acknowledge the overwrite warning before applying a provisioning profile.'
      })
      return
    }

    await handleApplyScopedParameterDrafts(
      selectedProvisioningProfileDiffEntries,
      'provisioning:apply',
      `Provisioning profile: ${selectedProvisioningProfile.label}`
    )
    setProvisioningRestoreAcknowledged(false)
    trackAppEvent('Provisioning Profile Applied', {
      changedCount: selectedProvisioningProfileDiffEntries.length
    })
  }

  function handleStageSelectedSnapshotDiff(): void {
    if (!selectedSnapshot || !selectedSnapshotRestore) {
      return
    }

    if (selectedSnapshotChangedEntries.length === 0) {
      setSnapshotNotice({
        tone: 'neutral',
        text: `Snapshot "${selectedSnapshot.label}" already matches the live controller values.`
      })
      return
    }

    replaceDrafts(selectedSnapshotRestore.draftValues)
    setSelectedParameterId(selectedSnapshotChangedEntries[0]?.id ?? selectedParameterId)
    setActiveViewId('parameters')
    setSnapshotNotice({
      tone: 'warning',
      text: `Loaded ${selectedSnapshotRestore.changedCount} snapshot change(s) into the Expert parameter editor draft set.`
    })
  }

  async function handleApplySelectedSnapshotRestore(): Promise<void> {
    if (!selectedSnapshot) {
      return
    }

    if (!snapshotRestoreAcknowledged) {
      setSnapshotNotice({
        tone: 'warning',
        text: 'Acknowledge the overwrite warning before applying a snapshot restore.'
      })
      return
    }

    await handleApplyScopedParameterDrafts(selectedSnapshotDiffEntries, 'snapshots:apply', `Snapshot restore: ${selectedSnapshot.label}`)
    setSnapshotRestoreAcknowledged(false)
    trackAppEvent('Snapshot Restore Applied', {
      changedCount: selectedSnapshotDiffEntries.length
    })
  }

  function handleStageSelectedPresetDiff(): void {
    if (!selectedPreset || !selectedPresetDiff) {
      return
    }

    if (selectedPresetApplicability.status === 'blocked') {
      setPresetNotice({
        tone: 'danger',
        text: selectedPresetApplicability.reasons[0] ?? 'This preset is not compatible with the current live configuration.'
      })
      return
    }

    if (selectedPresetChangedEntries.length === 0) {
      setPresetNotice({
        tone: 'neutral',
        text: `Preset "${selectedPreset.label}" already matches the current live tuning values.`
      })
      return
    }

    mergeDrafts(selectedPresetDiff.draftValues)
    setActiveViewId('tuning')
    setParameterNotice({
      tone: 'warning',
      text: `Loaded ${selectedPresetChangedEntries.length} preset change(s) into the Tuning view for manual review.`
    })
    setPresetNotice({
      tone: 'warning',
      text: `Preset "${selectedPreset.label}" was loaded into manual tuning drafts instead of being applied directly.`
    })
  }

  async function handleEraseSettings(): Promise<void> {
    if (!runtime || snapshot.connection.kind !== 'connected') {
      setPresetNotice({ tone: 'warning', text: 'Connect to a vehicle before erasing settings.' })
      return
    }
    if (snapshot.vehicle?.armed) {
      setPresetNotice({ tone: 'danger', text: 'Disarm the vehicle before erasing settings.' })
      return
    }
    setBusyAction('presets:erase')
    try {
      await runtime.resetParametersToDefaults()
      // Reboot so the defaults take effect, then the operator re-pulls.
      try {
        await runtime.reboot()
      } catch {
        // The reset itself succeeded; a missing reboot-ack is non-fatal —
        // the operator can power-cycle. Surface the main outcome below.
      }
      setPresetNotice({
        tone: 'success',
        text: 'All parameters reset to firmware defaults and a reboot was requested. Reconnect and pull parameters once the vehicle is back.'
      })
    } catch (error) {
      setPresetNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to erase settings.'
      })
    } finally {
      setBusyAction((current) => (current === 'presets:erase' ? undefined : current))
    }
  }

  async function handleApplySelectedPreset(): Promise<void> {
    if (!selectedPreset || !selectedPresetDiff) {
      return
    }

    if (!canApplyDraftParameters) {
      setPresetNotice({
        tone: 'warning',
        text: 'Connect, finish parameter sync, and keep the vehicle disarmed before applying a preset.'
      })
      return
    }

    if (selectedPresetApplicability.status === 'blocked') {
      setPresetNotice({
        tone: 'danger',
        text: selectedPresetApplicability.reasons[0] ?? 'This preset is not compatible with the current live configuration.'
      })
      return
    }

    if (!presetApplyAcknowledged) {
      setPresetNotice({
        tone: 'warning',
        text: 'Review the diff and acknowledge the overwrite warning before applying a preset.'
      })
      return
    }

    if (selectedPresetInvalidEntries.length > 0) {
      setPresetNotice({
        tone: 'danger',
        text: `Preset "${selectedPreset.label}" has ${selectedPresetInvalidEntries.length} invalid value(s) in the current metadata set.`
      })
      return
    }

    if (selectedPresetChangedEntries.length === 0) {
      setPresetNotice({
        tone: 'neutral',
        text: `Preset "${selectedPreset.label}" already matches the current live tuning values.`
      })
      return
    }

    const autoBackup = createSavedSnapshot(createParameterBackup(snapshot), buildPresetAutoBackupLabel(snapshot, selectedPreset), 'captured', {
      note: buildPresetAutoBackupNote(selectedPreset),
      tags: [...PRESET_AUTO_BACKUP_TAGS, ...selectedPreset.tags, selectedPreset.id]
    })
    setSavedSnapshots((current) => [autoBackup, ...current.filter((entry) => entry.id !== autoBackup.id)])

    setBusyAction('presets:apply')
    try {
      const rebootRequiredCount = selectedPresetChangedEntries.filter((entry) => entry.definition?.rebootRequired).length
      const result = await runtime.setParameters(
        selectedPresetChangedEntries
          .filter((entry) => entry.nextValue !== undefined)
          .map((entry) => ({
            paramId: entry.id,
            paramValue: entry.nextValue as number
          })),
        UI_PARAMETER_WRITE_OPTIONS
      )
      setPresetNotice({
        tone: 'success',
        text:
          result.applied.length === 0
            ? `Preset "${selectedPreset.label}" already matched the live controller. Auto-saved snapshot "${autoBackup.label}".`
            : `Applied preset "${selectedPreset.label}" with ${result.applied.length} verified write(s). Auto-saved snapshot "${autoBackup.label}".`
      })
      setParameterFollowUp({
        requiresReboot: rebootRequiredCount > 0,
        refreshRequired: true,
        changedCount: result.applied.length,
        text:
          rebootRequiredCount > 0
            ? `Preset "${selectedPreset.label}" changed reboot-sensitive settings. Request a reboot, then pull parameters again before flying.`
            : `Preset "${selectedPreset.label}" changed live tuning values. Pull parameters again if you want a clean post-write snapshot.`
      })
    } catch (error) {
      setPresetNotice({
        tone: 'danger',
        text: `${error instanceof Error ? error.message : `Preset "${selectedPreset.label}" failed to apply.`} Pre-apply snapshot "${autoBackup.label}" was saved before any writes were attempted.`
      })
    } finally {
      setPresetApplyAcknowledged(false)
      setBusyAction(undefined)
    }
  }

  async function handleRunMotorTest(): Promise<void> {
    let targetOutput = motorTestOutput

    if (motorVerification.status === 'running' && motorVerification.currentOutputChannel !== undefined) {
      targetOutput = motorVerification.currentOutputChannel
    }

    if (targetOutput === undefined) {
      return
    }

    const effectiveRequest = buildMotorTestRequest(targetOutput, motorTestThrottlePercent, motorTestDurationSeconds)
    const effectiveGuardReasons = computeMotorTestGuardReasons(snapshot, effectiveRequest, {
      propsRemoved: propsRemovedAcknowledged,
      testAreaClear: testAreaAcknowledged
    })

    if (effectiveGuardReasons.length > 0) {
      setMotorTestOutput(targetOutput)
      return
    }

    setBusyAction('motor-test')
    try {
      setMotorTestOutput(targetOutput)
      // Pass the SAME expert options the guard above used — the runtime
      // re-checks eligibility, and a divergence here rejected Expert-mode
      // durations over 5 s that the UI had already allowed.
      await runtime.runMotorTest(
        buildMotorTestRequest(targetOutput, motorTestThrottlePercent, motorTestDurationSeconds) as MotorTestRequest,
        motorTestExpertOptions
      )
    } catch {
      // The motor-test service already records status='failed' + a summary
      // in the snapshot (rendered on the Motor Test Guardrails card), then
      // re-throws. Swallow it here so the void-called handler doesn't leak
      // an unhandled promise rejection.
    } finally {
      setBusyAction(undefined)
    }
  }

  async function handleStopMotorTest(): Promise<void> {
    // Zero-throttle DO_MOTOR_TEST abort. No guard/ack gating — stopping a
    // spinning motor must always be available; the runtime no-ops if no
    // test is active and reports honestly whether the abort was acked.
    setBusyAction('motor-test-stop')
    try {
      await runtime.stopMotorTest()
    } catch {
      // stopMotorTest records the abort outcome in the snapshot and
      // normally resolves; guard against any unexpected reject so the
      // safety-critical Stop button can never leak an unhandled rejection.
    } finally {
      setBusyAction(undefined)
    }
  }

  async function handleRunCurrentMotorVerificationTest(): Promise<void> {
    await handleRunMotorTest()
  }

  function handleStartModeSwitchExercise(): void {
    if (!canRunModeSwitchExercise) {
      return
    }

    setModeSwitchExercise(createModeSwitchExerciseState(snapshot, snapshot.vehicle?.vehicle))
  }

  function handleResetModeSwitchExercise(): void {
    setModeSwitchExercise(createIdleModeSwitchExerciseState())
  }

  function handleCompleteModeSwitchExercise(): void {
    setModeSwitchExercise((current) => completeModeSwitchExerciseState(current))
  }

  // handleFailModeSwitchExercise removed — the Mark Failed button in the
  // switch exercise UI was dropped. Real failure paths (RC telemetry
  // loss, mode-switch channel disappearing) flow through
  // failModeSwitchExerciseState inside advanceModeSwitchExerciseState
  // itself, not via a manual click.

  function handleStartRcRangeExercise(): void {
    if (!canRunRcRangeExercise) {
      return
    }

    setRcRangeExercise(createRcRangeExerciseState(snapshot))
  }

  function handleResetRcRangeExercise(): void {
    setRcRangeExercise(createIdleRcRangeExerciseState())
  }

  function handleFailRcRangeExercise(): void {
    setRcRangeExercise((current) =>
      current.status === 'running'
        ? failRcRangeExerciseState(
            current,
            `Did not complete ${current.currentTargetAxis ? formatRcAxisLabel(current.currentTargetAxis) : 'the current'} stick exercise target.`
          )
        : current
    )
  }

  function handleStartOrientationExercise(): void {
    if (!canRunOrientationExercise) {
      return
    }

    setOrientationExercise(createOrientationExerciseState(snapshot))
  }

  function handleResetOrientationExercise(): void {
    setOrientationExercise(createIdleOrientationExerciseState())
  }

  function handleFailOrientationExercise(): void {
    setOrientationExercise((current) =>
      current.status === 'running'
        ? failOrientationExerciseState(
            current,
            `Did not observe the expected ${orientationStepLabel(current.currentTargetStep ?? 'level')} horizon response.`
          )
        : current
    )
  }

  function handleStartRcMappingExercise(): void {
    if (!canRunRcMappingExercise) {
      return
    }

    rcMappingAutoCaptureTrackerRef.current = {
      accumulatedMs: 0
    }
    setRcMappingAutoCaptureState({ accumulatedMs: 0 })
    setRcMappingSession(createRcMappingSessionState(snapshot))
    clearSetupSectionConfirmation('radio')
  }

  function handleResetRcMappingExercise(): void {
    rcMappingAutoCaptureTrackerRef.current = {
      accumulatedMs: 0
    }
    setRcMappingAutoCaptureState({ accumulatedMs: 0 })
    setRcMappingSession(createIdleRcMappingSessionState())
  }

  function captureRcMappingCandidate(candidate: RcMappingCandidate, source: 'manual' | 'auto' = 'manual'): void {
    let nextNotice: ParameterNotice | undefined
    let shouldClearRadioConfirmation = false
    let mappingCompleted = false

    setRcMappingSession((current) => {
      if (current.status !== 'running' || current.currentTargetAxis === undefined) {
        return current
      }

      const capturedAxis = current.currentTargetAxis
      const captures: Record<RcAxisId, RcMappingAxisCapture> = {
        ...current.captures,
        [capturedAxis]: {
          ...current.captures[capturedAxis],
          detectedChannelNumber: candidate.channelNumber,
          deltaUs: candidate.deltaUs
        }
      }
      const nextTargetAxis = RC_CALIBRATION_AXIS_ORDER.find((axisId) => captures[axisId].detectedChannelNumber === undefined)

      nextNotice = {
        tone: 'success',
        text:
          nextTargetAxis === undefined
            ? 'Captured roll, pitch, throttle, and yaw. Review the detected map and stage any needed RCMAP_* changes.'
            : `${
                source === 'auto' ? 'Captured' : 'Confirmed'
              } ${formatRcAxisLabel(capturedAxis)} on CH${candidate.channelNumber}. Next: ${rcMappingTargetPrompt(nextTargetAxis).title.toLowerCase()}.`
      }
      shouldClearRadioConfirmation = true
      mappingCompleted = nextTargetAxis === undefined

      return nextTargetAxis === undefined
        ? {
            ...current,
            status: 'ready',
            captures,
            currentTargetAxis: undefined,
            completedAtMs: Date.now(),
            failureReason: undefined
          }
        : {
            ...current,
            captures,
            currentTargetAxis: nextTargetAxis
          }
    })

    if (shouldClearRadioConfirmation) {
      clearSetupSectionConfirmation('radio')
    }
    if (mappingCompleted) {
      // Release any operator-pinned Receiver sub-task so the view's
      // auto-routing advances to Endpoints. A pin set by clicking the
      // Mapping card used to stick here, leaving the flow with no visible
      // next step after the final axis captured.
      setReceiverTaskOverride(undefined)
    }
    if (nextNotice) {
      setParameterNotice(nextNotice)
    }
  }

  captureRcMappingCandidateRef.current = captureRcMappingCandidate

  function handleConfirmRcMappingCandidate(): void {
    if (rcMappingSession.status !== 'running' || rcMappingSession.currentTargetAxis === undefined) {
      return
    }

    if (!rcMappingCandidate) {
      setParameterNotice({
        tone: 'warning',
        text:
          rcMappingRejectedReason ??
          `${rcMappingTargetGuide.detail} Keep moving only that control until one receiver channel clearly dominates.`
      })
      return
    }

    captureRcMappingCandidate(rcMappingCandidate, 'manual')
  }

  function handleFailRcMappingExercise(): void {
    setRcMappingSession((current) =>
      current.status === 'running' && current.currentTargetAxis !== undefined
        ? failRcMappingSessionState(
            current,
            `Did not get a clear dominant channel while moving ${formatRcAxisLabel(current.currentTargetAxis)}.`
          )
        : current
    )
  }

  useEffect(() => {
    rcMappingCandidateRef.current = rcMappingCandidate
  }, [rcMappingCandidate])

  useEffect(() => {
    rcMappingTargetAxisRef.current =
      rcMappingSession.status === 'running' ? rcMappingSession.currentTargetAxis : undefined
  }, [rcMappingSession.currentTargetAxis, rcMappingSession.status])

  useEffect(() => {
    if (rcMappingSession.status !== 'running' || rcMappingSession.currentTargetAxis === undefined) {
      rcMappingAutoCaptureTrackerRef.current = {
        accumulatedMs: 0
      }
      setRcMappingAutoCaptureState({ accumulatedMs: 0 })
      return
    }

    const interval = window.setInterval(() => {
      const now = Date.now()
      const latestCandidate = rcMappingCandidateRef.current
      const latestTargetAxis = rcMappingTargetAxisRef.current
      const tracker = rcMappingAutoCaptureTrackerRef.current
      const elapsedSinceLastTick = tracker.lastTickAtMs === undefined ? RC_MAPPING_AUTO_CAPTURE_TICK_MS : now - tracker.lastTickAtMs
      tracker.lastTickAtMs = now

      if (!latestTargetAxis) {
        if (tracker.accumulatedMs !== 0 || tracker.channelNumber !== undefined || tracker.axisId !== undefined) {
          tracker.axisId = undefined
          tracker.channelNumber = undefined
          tracker.accumulatedMs = 0
          tracker.lastMatchedAtMs = undefined
          setRcMappingAutoCaptureState({ accumulatedMs: 0 })
        }
        return
      }

      if (!latestCandidate) {
        const withinGapTolerance =
          tracker.axisId === latestTargetAxis &&
          tracker.channelNumber !== undefined &&
          tracker.lastMatchedAtMs !== undefined &&
          now - tracker.lastMatchedAtMs <= RC_MAPPING_AUTO_CAPTURE_GAP_TOLERANCE_MS

        if (!withinGapTolerance && (tracker.accumulatedMs !== 0 || tracker.channelNumber !== undefined || tracker.axisId !== latestTargetAxis)) {
          tracker.axisId = latestTargetAxis
          tracker.channelNumber = undefined
          tracker.accumulatedMs = 0
          tracker.lastMatchedAtMs = undefined
          setRcMappingAutoCaptureState({ axisId: latestTargetAxis, accumulatedMs: 0 })
        }
        return
      }

      if (tracker.axisId === latestTargetAxis && tracker.channelNumber === latestCandidate.channelNumber) {
        tracker.accumulatedMs = Math.min(
          RC_MAPPING_AUTO_CAPTURE_MS,
          tracker.accumulatedMs + Math.min(elapsedSinceLastTick, RC_MAPPING_AUTO_CAPTURE_GAP_TOLERANCE_MS)
        )
      } else {
        tracker.axisId = latestTargetAxis
        tracker.channelNumber = latestCandidate.channelNumber
        tracker.accumulatedMs = Math.min(elapsedSinceLastTick, RC_MAPPING_AUTO_CAPTURE_TICK_MS)
      }

      tracker.lastMatchedAtMs = now
      setRcMappingAutoCaptureState({
        axisId: latestTargetAxis,
        channelNumber: latestCandidate.channelNumber,
        accumulatedMs: tracker.accumulatedMs
      })

      if (tracker.accumulatedMs >= RC_MAPPING_AUTO_CAPTURE_MS) {
        tracker.accumulatedMs = 0
        tracker.lastMatchedAtMs = undefined
        setRcMappingAutoCaptureState({
          axisId: latestTargetAxis,
          channelNumber: latestCandidate.channelNumber,
          accumulatedMs: RC_MAPPING_AUTO_CAPTURE_MS
        })
        captureRcMappingCandidateRef.current?.(latestCandidate, 'auto')
      }
    }, RC_MAPPING_AUTO_CAPTURE_TICK_MS)

    return () => window.clearInterval(interval)
  }, [rcMappingSession.currentTargetAxis, rcMappingSession.status])

  function handleStageRcMappingDrafts(): void {
    if (rcMappingSession.status !== 'ready') {
      return
    }

    const detectedChannelMap = Object.fromEntries(
      RC_CALIBRATION_AXIS_ORDER.map((axisId) => [axisId, rcMappingSession.captures[axisId].detectedChannelNumber])
    ) as Partial<Record<RcAxisId, number>>
    const nextDrafts = deriveRcMapDraftValues(detectedChannelMap, currentRcAxisChannelMap)
    const draftIds = Object.keys(nextDrafts)

    if (draftIds.length === 0) {
      setParameterNotice({
        tone: 'neutral',
        text: 'Observed RC mapping already matches the current RCMAP_* values.'
      })
      return
    }

    mergeDrafts(nextDrafts)
    clearSetupSectionConfirmation('radio')
    setSelectedParameterId(draftIds[0] ?? selectedParameterId)
    setParameterNotice({
      tone: 'warning',
      text: `Staged ${draftIds.length} RCMAP_* change(s). Review and apply them from the Receiver view, then reboot, refresh parameters, and rerun RC endpoint capture.`
    })
  }

  function handleStartRcCalibrationCapture(): void {
    if (!canCaptureRcCalibration) {
      return
    }

    setRcCalibrationSession({
      ...createIdleRcCalibrationSessionState(rcAxisObservations),
      status: 'capturing',
      startedAtMs: Date.now(),
      completedAtMs: undefined,
      failureReason: undefined
    })
    clearSetupSectionConfirmation('radio')
  }

  function handleResetRcCalibrationCapture(): void {
    setRcCalibrationSession(createIdleRcCalibrationSessionState(rcAxisObservations))
  }

  function handleStageRcCalibrationDrafts(): void {
    if (rcCalibrationSession.status !== 'ready') {
      return
    }

    const nextDrafts: Record<string, string> = {}
    RC_CALIBRATION_AXIS_ORDER.forEach((axisId) => {
      const capture = rcCalibrationSession.captures[axisId]
      if (capture.observedMin !== undefined) {
        nextDrafts[`RC${capture.channelNumber}_MIN`] = String(Math.round(capture.observedMin))
      }
      if (capture.observedMax !== undefined) {
        nextDrafts[`RC${capture.channelNumber}_MAX`] = String(Math.round(capture.observedMax))
      }
      if (axisId !== 'throttle' && capture.trimPwm !== undefined) {
        nextDrafts[`RC${capture.channelNumber}_TRIM`] = String(Math.round(capture.trimPwm))
      }
    })

    mergeDrafts(nextDrafts)
    clearSetupSectionConfirmation('radio')
    setSelectedParameterId(Object.keys(nextDrafts)[0] ?? selectedParameterId)
    setParameterNotice({
      tone: 'warning',
      text: `Staged ${Object.keys(nextDrafts).length} RC calibration value(s). Review and apply them from the Receiver view before confirming radio setup.`
    })
  }

  function handleOpenMotorReorderDialog(): void {
    if (effectiveMotorOutputs.length === 0) {
      return
    }

    setMotorReorderSelections(
      Object.fromEntries(
        effectiveMotorOutputs
          .filter((output) => output.motorNumber !== undefined)
          .map((output) => [String(output.motorNumber), String(output.channelNumber)])
      )
    )
    setMotorDialogTab('reorder')
    setMotorDialogSpinError(undefined)
    setMotorReorderDialogOpen(true)
  }

  // Spin a single motor for the dialog's Direction tab. Same error
  // surfacing pattern as spinGuidedReorderStep so the operator sees why
  // a motor failed to spin instead of getting a silent no-op.
  function handleDialogSpinSingleMotor(channelNumber: number): void {
    const request = buildMotorTestRequest(channelNumber, 6, 2.5)
    setMotorDialogSpinError(undefined)
    setBusyAction('motor-test')
    void (async () => {
      try {
        await runtime.runMotorTest(request as MotorTestRequest)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Motor test failed.'
        setMotorDialogSpinError(`OUT${channelNumber}: ${message}`)
      } finally {
        setBusyAction(undefined)
      }
    })()
  }

  function handleCloseMotorReorderDialog(): void {
    setMotorReorderDialogOpen(false)
    // Cancel any in-flight guided identify state.
    setGuidedReorderActive(false)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderAwaitingSpin(false)
    setGuidedReorderCompleted(false)
  }

  // Spin the guided-identify sequence's CURRENT output. Operator-paced
  // (field feedback): the old flow auto-spun the next motor 400 ms after
  // each pick, which raced the FC's previous motor-test window (ArduPilot
  // stays armed through the test, so the rushed follow-up was rejected
  // with "the vehicle reports armed=true") and forced the operator's
  // tempo. Now every spin is an explicit click — including the first —
  // and can be repeated ("Spin again") before picking a position.
  function spinGuidedReorderStep(index: number): void {
    const output = effectiveMotorOutputs[index]
    if (!output) {
      return
    }
    // Conservative cap — 2.5s window with low throttle so the operator
    // has time to see which motor moved without spinning long enough to
    // overheat anything bench-mounted with props off.
    const request = buildMotorTestRequest(output.channelNumber, 6, 2.5)
    setMotorDialogSpinError(undefined)
    setBusyAction('motor-test')
    void (async () => {
      try {
        await runtime.runMotorTest(request as MotorTestRequest)
        setGuidedReorderAwaitingSpin(false)
      } catch (error) {
        // Surface the failure in the dialog so the operator sees WHY no
        // motor moved. MotorTestService also records failure in the
        // snapshot, but that's invisible from the dialog context.
        const message = error instanceof Error ? error.message : 'Motor test failed.'
        setMotorDialogSpinError(`OUT${output.channelNumber}: ${message}`)
      } finally {
        setBusyAction(undefined)
      }
    })()
  }

  function handleSpinGuidedReorderCurrent(): void {
    if (!guidedReorderActive) {
      return
    }
    spinGuidedReorderStep(guidedReorderStep)
  }

  function handleStartGuidedReorder(): void {
    if (effectiveMotorOutputs.length === 0) {
      return
    }
    if (!propsRemovedAcknowledged || !testAreaAcknowledged) {
      return
    }
    setGuidedReorderActive(true)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderCompleted(false)
    // Operator-paced: wait for the explicit Spin click, even for OUT1.
    setGuidedReorderAwaitingSpin(true)
  }

  function handleCancelGuidedReorder(): void {
    setGuidedReorderActive(false)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderAwaitingSpin(false)
    void runtime.stopMotorTest().catch(() => {})
  }

  function handlePickGuidedReorderPosition(clickedMotorNumber: number): void {
    if (!guidedReorderActive) {
      return
    }
    const currentOutput = effectiveMotorOutputs[guidedReorderStep]
    if (!currentOutput) {
      return
    }
    // Backstop the UI's already-picked lock: a position claimed by an
    // earlier output must never be reassigned (it would drop a motor and
    // silently mis-map the reorder). Ignore the stray click rather than
    // corrupt the mapping.
    if (pickedReorderPositions(guidedReorderMapping).has(clickedMotorNumber)) {
      return
    }
    // Record: this output should drive the motor at the physical position
    // the operator just clicked. mapping[OUTn] = clickedMotorNumber.
    const nextMapping = {
      ...guidedReorderMapping,
      [String(currentOutput.channelNumber)]: clickedMotorNumber
    }
    setGuidedReorderMapping(nextMapping)
    const nextStep = guidedReorderStep + 1
    if (nextStep >= effectiveMotorOutputs.length) {
      // All outputs identified. Invert the output→position identify map
      // into the reorder table's motor→output selections (pure + tested
      // in motor-reorder-mapping.ts), so Stage Reorder writes the
      // SERVOn_FUNCTION drafts that make every physical position drive
      // its expected motor number.
      setMotorReorderSelections(invertGuidedReorderMapping(nextMapping))
      setGuidedReorderActive(false)
      setGuidedReorderStep(0)
      setGuidedReorderAwaitingSpin(false)
      // Unlocks the Stage button's primary emphasis and the
      // "no changes needed" note when the order already matches.
      setGuidedReorderCompleted(true)
    } else {
      // No auto-spin: advance and wait for the operator's explicit Spin
      // click at their own pace.
      setGuidedReorderStep(nextStep)
      setGuidedReorderAwaitingSpin(true)
    }
  }

  function handleStageMotorReorderDrafts(): void {
    if (!motorReorderCanStage) {
      return
    }

    const nextAssignmentValues = new Map<string, string>()
    motorReorderRows.forEach((row) => {
      nextAssignmentValues.set(`SERVO${row.selectedChannelNumber}_FUNCTION`, String(row.functionValue))
    })

    const nextEditedValues = { ...editedValues }
    const changedParamIds: string[] = []
    effectiveMotorOutputs.forEach((output) => {
      const parameter = outputAssignmentParameterById.get(output.paramId)
      if (!parameter) {
        return
      }

      const nextValue = nextAssignmentValues.get(output.paramId)
      delete nextEditedValues[output.paramId]

      if (nextValue !== undefined && Number(nextValue) !== Math.round(parameter.value)) {
        nextEditedValues[output.paramId] = nextValue
        changedParamIds.push(output.paramId)
      }
    })

    replaceDrafts(nextEditedValues)
    clearSetupSectionConfirmation('outputs')
    setMotorReorderDialogOpen(false)

    if (changedParamIds.length === 0) {
      setParameterNotice({
        tone: 'neutral',
        text: 'Motor output order already matches the selected layout.'
      })
      return
    }

    setSelectedParameterId(changedParamIds[0] ?? selectedParameterId)
    setParameterNotice({
      tone: 'warning',
      text: `Staged ${changedParamIds.length} motor output remap change(s). Apply them from Outputs, then rerun the guarded motor direction check before flight.`
    })
  }

  function handleStartMotorVerification(preferredOutputChannel?: number): void {
    if (!canRunMotorVerification) {
      return
    }

    const prioritizedOutputs = outputMapping.motorOutputs.slice()
    if (preferredOutputChannel !== undefined) {
      const preferredIndex = prioritizedOutputs.findIndex((output) => output.channelNumber === preferredOutputChannel)
      if (preferredIndex > 0) {
        const [preferredOutput] = prioritizedOutputs.splice(preferredIndex, 1)
        prioritizedOutputs.unshift(preferredOutput)
      }
    }

    const targetOutputs = prioritizedOutputs.map((output) => output.channelNumber)
    const firstOutput = prioritizedOutputs[0]
    setMotorVerification({
      status: 'running',
      targetOutputs,
      verifiedOutputs: [],
      currentOutputChannel: firstOutput?.channelNumber,
      currentMotorNumber: firstOutput?.motorNumber,
      startedAtMs: Date.now()
    })
    setMotorTestOutput(firstOutput?.channelNumber)
    clearSetupSectionConfirmation('outputs')
    if (activeViewId === 'motors') {
      // Motor verification is part of the Motors tab. Servos tab has
      // no motor-test bench, so no focus-target hop from there.
      focusOutputsTarget(OUTPUTS_MOTOR_TEST_BUTTON_ID)
    }
  }

  function handleResetMotorVerification(): void {
    setMotorVerification(createIdleMotorVerificationState())
  }

  function handleConfirmMotorVerification(): void {
    setMotorVerification((current) => {
      if (current.status !== 'running' || current.currentOutputChannel === undefined) {
        return current
      }

      const verifiedOutputs = current.verifiedOutputs.includes(current.currentOutputChannel)
        ? current.verifiedOutputs
        : [...current.verifiedOutputs, current.currentOutputChannel]
      const nextOutputChannel = current.targetOutputs.find((channelNumber) => !verifiedOutputs.includes(channelNumber))
      const nextOutput =
        nextOutputChannel !== undefined
          ? outputMapping.motorOutputs.find((output) => output.channelNumber === nextOutputChannel)
          : undefined

      setMotorTestOutput(nextOutput?.channelNumber)

      if (!nextOutput) {
        return {
          ...current,
          status: 'passed',
          verifiedOutputs,
          currentOutputChannel: undefined,
          currentMotorNumber: undefined,
          completedAtMs: Date.now(),
          failureReason: undefined
        }
      }

      return {
        ...current,
        verifiedOutputs,
        currentOutputChannel: nextOutput.channelNumber,
        currentMotorNumber: nextOutput.motorNumber
      }
    })
  }

  function handleFailMotorVerification(): void {
    setMotorVerification((current) =>
      current.status === 'running'
        ? {
            ...current,
            status: 'failed',
            failureReason: `Motor verification failed on OUT${current.currentOutputChannel ?? '?'}. Check motor order, direction, and output mapping before flight.`,
            completedAtMs: Date.now()
          }
        : current
    )
  }

  const { orientationExerciseSummary, orientationExerciseInstructions } = useOrientationDerivations({
    snapshot,
    orientationExercise
  })

  const rcCalibrationDerivations = useRcCalibrationDerivations({ snapshot, rcCalibrationSession })
  const { rcCalibrationSummary } = rcCalibrationDerivations

  const receiverWorkflowDraftCount = receiverStagedDrafts.length
  const receiverWorkflowInvalidCount = receiverInvalidDrafts.length
  const receiverAdvancedDraftCount = receiverAdditionalStagedDrafts.length
  const receiverAdvancedInvalidCount = receiverAdditionalInvalidDrafts.length
  const receiverHasPendingReview =
    receiverWorkflowDraftCount + receiverWorkflowInvalidCount + receiverAdvancedDraftCount + receiverAdvancedInvalidCount > 0
  const receiverTasks = useReceiverTasks({
    snapshot,
    rcRangeExercise,
    rcCalibrationSession,
    modeSwitchExercise,
    modeSwitchEstimate,
    modeExerciseAssignments,
    rcMappingSession,
    rcRangeExerciseCompletedCount,
    rcRangeExerciseSummary,
    rcCalibrationSummary,
    modeSwitchExerciseSummary,
    rcMappingSummary,
    rcMappingCapturedCount,
    receiverWorkflowDraftCount,
    receiverWorkflowInvalidCount,
    receiverAdvancedDraftCount,
    receiverAdvancedInvalidCount,
    receiverLinkPorts,
    receiverTaskOverride
  })

  // The active Tuning task is driven solely by the operator's selection,
  // defaulting to 'rates'. It deliberately does NOT auto-switch to 'review' when
  // changes are staged: like every other parameter tab, edits stage in place and
  // the operator moves to the Review task themselves when they are ready to write
  // (staging a change used to yank the view straight to 'review' mid-edit).
  const activeTuningTaskId = tuningTaskOverride ?? 'rates'
  const tuningTaskCards = useMemo<TuningTaskCard[]>(
    () =>
      buildTuningTaskCards({
        rateInvalidCount: tuningRateInvalidDrafts.length,
        rateStagedCount: tuningRateStagedDrafts.length,
        rateControlCount:
          flightFeelParameters.length + tuningAccelerationParameters.length + acroTuningParameters.length,
        pidInvalidCount: tuningPidInvalidDrafts.length,
        pidStagedCount: tuningPidStagedDrafts.length,
        pidGainCount: TUNING_ALL_PID_PARAM_IDS.length,
        filterInvalidCount: tuningFilterInvalidDrafts.length,
        filterStagedCount: tuningFilterStagedDrafts.length,
        filterCount: TUNING_FILTER_PARAM_IDS.length,
        profileInvalidCount: selectedTuningProfileInvalidEntries.length,
        profileChangedCount: selectedTuningProfileChangedEntries.length,
        savedProfileCount: savedTuningProfiles.length,
        reviewInvalidCount: tuningInvalidDrafts.length,
        reviewStagedCount: tuningStagedDrafts.length
      }),
    [
      tuningFilterInvalidDrafts.length,
      tuningFilterStagedDrafts.length,
      tuningInvalidDrafts.length,
      tuningPidInvalidDrafts.length,
      tuningPidStagedDrafts.length,
      tuningRateInvalidDrafts.length,
      tuningRateStagedDrafts.length,
      tuningStagedDrafts.length,
      savedTuningProfiles.length,
      selectedTuningProfileChangedEntries.length,
      selectedTuningProfileInvalidEntries.length
    ]
  )
  const activeTuningTask = tuningTaskCards.find((task) => task.id === activeTuningTaskId) ?? tuningTaskCards[0]

  const renderTuningControl = (parameter: ParameterState): ReactElement => {
    const draft = parameterDraftById.get(parameter.id)
    const { min, max, step } = tuningControlBounds(parameter)
    const inputValue = tuningInputValue(parameter, editedValues)
    const numericValue = tuningNumericValue(parameter, editedValues)
    const currentValue = formatTuningDisplayValue(parameter, parameter.value)
    const stagedValue = formatTuningDisplayValue(parameter, draft?.nextValue ?? parameter.value)

    return (
      <TuningControl
        key={parameter.id}
        parameter={parameter}
        draftStatus={draft?.status}
        draftReason={draft?.reason}
        min={min}
        max={max}
        step={step}
        inputValue={inputValue}
        numericValue={numericValue}
        currentValue={currentValue}
        stagedValue={stagedValue}
        label={parameter.definition?.label ?? parameter.id}
        onStage={handleStageTuningParameterValue}
      />
    )
  }

  const { motorVerificationSummary } = useMotorVerificationDerivations({ motorVerification })

  const currentMotorVerificationOutput =
    motorVerification.currentOutputChannel !== undefined
      ? outputMapping.motorOutputs.find((output) => output.channelNumber === motorVerification.currentOutputChannel)
      : undefined
  const currentMotorVerificationLabel = currentMotorVerificationOutput
    ? `OUT${currentMotorVerificationOutput.channelNumber}${
        currentMotorVerificationOutput.motorNumber !== undefined ? ` / M${currentMotorVerificationOutput.motorNumber}` : ''
      }`
    : undefined
  const selectedMotorTestOutput = motorTestOutput !== undefined && motorTestOutput !== ALL_MOTOR_TEST_OUTPUT
    ? outputMapping.motorOutputs.find((output) => output.channelNumber === motorTestOutput)
    : undefined
  const selectedMotorTestOutputMotorNumber = selectedMotorTestOutput?.motorNumber
  const motorTestSliderTargets = outputMapping.motorOutputs.map((output) => ({
    value: output.channelNumber,
    label: output.motorNumber !== undefined ? `M${output.motorNumber}` : `OUT${output.channelNumber}`
  }))
  const outputAssignmentReviewLabel =
    outputAssignmentInvalidDrafts.length > 0
      ? `${outputAssignmentInvalidDrafts.length} invalid`
      : outputAssignmentStagedDrafts.length > 0
        ? `${outputAssignmentStagedDrafts.length} staged`
        : 'in sync'
  const motorMixerSummary = (() => {
    if (effectiveMotorOutputs.length === 0) {
      return 'No motor outputs are currently mapped in the editable SERVO function range.'
    }
    if (outputAssignmentInvalidDrafts.length > 0) {
      return 'Resolve invalid output drafts before applying any motor remap.'
    }
    if (outputAssignmentStagedDrafts.length > 0) {
      return 'Motor-output draft changes are staged locally. Apply them, then rerun the guarded direction check.'
    }
    return 'Schematic motor map based on the current SERVOx_FUNCTION assignments. Reorder outputs here, then verify direction with guarded motor tests.'
  })()
  const motorDirectionSummary = (() => {
    if (motorVerification.status === 'running') {
      return currentMotorVerificationLabel
        ? `Spin ${currentMotorVerificationLabel}, then confirm the correct motor and spin direction.`
        : 'Motor verification is waiting for the next mapped output.'
    }
    if (motorVerification.status === 'passed') {
      return 'Every mapped motor was stepped through and operator-confirmed.'
    }
    if (motorVerification.status === 'failed') {
      return motorVerification.failureReason ?? 'Motor direction check failed.'
    }
    return 'Use the guarded single-motor bench test to confirm order and spin direction before the first props-on flight.'
  })()
  const guidedMotorTestRequest = buildMotorTestRequest(
    motorVerification.currentOutputChannel,
    motorTestThrottlePercent,
    motorTestDurationSeconds
  )
  const guidedMotorTestCoreGuardReasons = computeMotorTestGuardReasons(snapshot, guidedMotorTestRequest, {
    propsRemoved: propsRemovedAcknowledged,
    testAreaClear: testAreaAcknowledged
  })
  const guidedMotorTestGuardReasons =
    motorTestOverUsb && !usbBenchAcknowledged
      ? [...guidedMotorTestCoreGuardReasons, 'Confirm the craft is on the bench with props off (USB connection detected).']
      : guidedMotorTestCoreGuardReasons
  const canRunGuidedMotorTest =
    motorVerification.status === 'running' &&
    motorVerification.currentOutputChannel !== undefined &&
    guidedMotorTestGuardReasons.length === 0 &&
    busyAction === undefined &&
    snapshot.motorTest.status !== 'requested' &&
    snapshot.motorTest.status !== 'running'
  const currentMotorTestSucceeded =
    motorVerification.status === 'running' &&
    snapshot.motorTest.status === 'succeeded' &&
    snapshot.motorTest.selectedOutputChannel === motorVerification.currentOutputChannel

  const escReviewSummary = (() => {
    if (escSetup.calibrationPath === 'analog-calibration') {
      return 'This output protocol still needs the offline ESC calibration review before first flight.'
    }
    if (escSetup.calibrationPath === 'digital-protocol') {
      return 'Digital motor outputs do not use PWM endpoint calibration, but the motor range still needs review.'
    }
    return 'ESC protocol and motor-range settings need a manual review before first flight.'
  })()

  const setupConfirmationSignatures = useMemo<Record<string, string>>(
    () =>
      buildSetupConfirmationSignatures({
        airframe,
        outputMapping,
        escSetup,
        compassSetupAvailability,
        currentRcAxisChannelMap,
        rcAxisObservations,
        rcMappingSession,
        snapshot,
        batteryCapacity,
        batteryFailsafe,
        batteryMonitor,
        throttleFailsafe
      }),
    [
      airframe.expectedMotorCount,
      airframe.frameClassValue,
      airframe.frameTypeIgnored,
      airframe.frameTypeValue,
      batteryCapacity,
      batteryFailsafe,
      batteryMonitor,
      compassSetupAvailability.canSkipCalibration,
      compassSetupAvailability.enabledCompassCount,
      compassSetupAvailability.gpsConfigured,
      currentRcAxisChannelMap,
      escSetup.calibrationPath,
      escSetup.notes,
      escSetup.pwmTypeValue,
      escSetup.relevantParameters,
      outputMapping.configuredAuxOutputs,
      outputMapping.motorOutputs,
      outputMapping.notes,
      rcAxisObservations,
      rcMappingSession.captures,
      rcMappingSession.status,
      // Calibration signatures read the stored cal params (offsets/trims),
      // so they follow the parameter array, not the transient guided-action
      // state — see buildSetupConfirmationSignatures. Live verification
      // flags and pre-arm issues are deliberately NOT inputs: signatures
      // pin reviewed configuration only.
      snapshot.parameters,
      throttleFailsafe
    ]
  )

  function getSetupConfirmationRecord(sectionId: string): SetupConfirmationRecord | undefined {
    const record = setupConfirmations[sectionId]
    const signature = setupConfirmationSignatures[sectionId]
    if (!record || signature === undefined || record.signature !== signature) {
      return undefined
    }

    return record
  }

  const escReviewConfirmation = getSetupConfirmationRecord('esc-range')

  const recommendedOutputTaskId = useMemo<OutputTaskId>(
    () =>
      recommendOutputTaskId({
        outputAssignmentInvalidCount: outputAssignmentInvalidDrafts.length,
        orientationExerciseStatus: orientationExercise.status,
        motorVerificationStatus: motorVerification.status,
        outputReviewInvalidCount: outputReviewInvalidDrafts.length,
        outputPeripheralInvalidDraftCount,
        motorOutputCount: outputMapping.motorOutputs.length,
        expectedMotorCount: airframe.expectedMotorCount,
        escReviewConfirmed: Boolean(escReviewConfirmation)
      }),
    [
      airframe.expectedMotorCount,
      escReviewConfirmation,
      motorVerification.status,
      orientationExercise.status,
      outputAssignmentInvalidDrafts.length,
      outputMapping.motorOutputs.length,
      outputPeripheralInvalidDraftCount,
      outputReviewInvalidDrafts.length
    ]
  )
  // On the Servos nav tab the only surfaced task card is 'peripherals'.
  // The Servos nav tab has its own task subset (servo-mapping +
  // peripherals). If the operator has explicitly picked one of those
  // via the task deck we honor it; otherwise default to servo-mapping
  // since that's the headline workflow for Servos. Stale overrides
  // from a Motors-tab task ('direction-test', etc.) are ignored.
  const activeOutputTaskId: OutputTaskId = activeViewId === 'servos'
    ? (outputTaskOverride === 'servo-mapping' || outputTaskOverride === 'peripherals'
        ? outputTaskOverride
        : 'servo-mapping')
    : outputTaskOverride ?? recommendedOutputTaskId
  const outputTaskCards = useMemo<OutputTaskCard[]>(
    () =>
      buildOutputTaskCards({
        outputAssignmentInvalidCount: outputAssignmentInvalidDrafts.length,
        outputAssignmentStagedCount: outputAssignmentStagedDrafts.length,
        expectedMotorCount: airframe.expectedMotorCount,
        motorOutputCount: outputMapping.motorOutputs.length,
        configuredAuxOutputCount: outputMapping.configuredAuxOutputs.length,
        orientationExerciseStatus: orientationExercise.status,
        orientationExerciseSummary,
        motorMixerSummary,
        motorVerificationStatus: motorVerification.status,
        motorDirectionSummary,
        outputReviewInvalidCount: outputReviewInvalidDrafts.length,
        outputReviewStagedCount: outputReviewStagedDrafts.length,
        escReviewConfirmed: Boolean(escReviewConfirmation),
        escCalibrationPath: escSetup.calibrationPath,
        escReviewSummary,
        servoMappingRowCount: servoMappingRows.length,
        outputPeripheralInvalidDraftCount,
        outputPeripheralStagedDraftCount,
        hasNotificationLedTypes: Boolean(notificationLedTypesParameter),
        hasNotificationBuzzTypes: Boolean(notificationBuzzTypesParameter),
        outputAdditionalGroupCount: outputAdditionalGroups.length,
        totalOutputInvalidDrafts,
        totalOutputStagedDrafts
      }),
    [
      airframe.expectedMotorCount,
      escReviewConfirmation,
      escReviewSummary,
      escSetup.calibrationPath,
      motorDirectionSummary,
      motorMixerSummary,
      motorVerification.status,
      notificationBuzzTypesParameter,
      notificationLedTypesParameter,
      orientationExercise.status,
      orientationExerciseSummary,
      outputAdditionalGroups.length,
      outputAssignmentInvalidDrafts.length,
      outputAssignmentStagedDrafts.length,
      outputMapping.configuredAuxOutputs.length,
      outputMapping.motorOutputs.length,
      outputPeripheralInvalidDraftCount,
      outputPeripheralStagedDraftCount,
      outputReviewInvalidDrafts.length,
      outputReviewStagedDrafts.length,
      totalOutputInvalidDrafts,
      totalOutputStagedDrafts
    ]
  )
  const activeOutputTask = outputTaskCards.find((task) => task.id === activeOutputTaskId) ?? outputTaskCards[0]

  function confirmSetupSection(sectionId: string, outcome: SetupSectionOutcome = 'complete'): void {
    const signature = setupConfirmationSignatures[sectionId]
    if (signature === undefined) {
      return
    }

    setSetupConfirmations((current) => ({
      ...current,
      [sectionId]: {
        signature,
        confirmedAtMs: Date.now(),
        outcome
      }
    }))
  }

  function clearSetupSectionConfirmation(sectionId: string): void {
    setSetupConfirmations((current) => {
      if (!(sectionId in current)) {
        return current
      }

      const next = { ...current }
      delete next[sectionId]
      return next
    })
  }

  const setupFlowFollowUp = useMemo<SetupFlowFollowUpDescriptor | undefined>(() => {
    if (!parameterFollowUp) {
      return undefined
    }

    return {
      title: parameterFollowUp.requiresReboot
        ? 'Pending sidebar reboot before later setup steps unlock'
        : 'Pending sidebar refresh before later setup steps unlock',
      tone: parameterFollowUp.requiresReboot ? 'warning' : 'neutral',
      text: `${parameterFollowUp.text} Use the header session strip to continue this setup session.`,
      actions: []
    }
  }, [parameterFollowUp])

  const setupFlowSections = useMemo<SetupFlowSectionDescriptor[]>(
    () =>
      buildSetupFlowSections({
        snapshot,
        airframe,
        outputMapping,
        configuredOutputs,
        escSetup,
        compassSetupAvailability,
        isCopterVehicle,
        modeSwitchExercise,
        modeSwitchEstimate,
        modeExerciseAssignments,
        motorVerification,
        orientationExercise,
        rcCalibrationSession,
        rcMappingSession,
        rcRangeExercise,
        parameterFollowUp,
        setupFlowFollowUp,
        setupConfirmations,
        setupConfirmationSignatures,
        batteryFailsafe,
        batteryMonitor,
        boardOrientation,
        busyAction,
        throttleFailsafe,
        canRunGuidedMotorTest,
        canRunModeSwitchExercise,
        canRunMotorVerification,
        canRunOrientationExercise,
        canRunRcMappingExercise,
        canRunRcRangeExercise,
        currentMotorTestSucceeded,
        currentMotorVerificationLabel,
        modeSwitchExerciseSummary,
        rcCalibrationSummary,
        rcMappingSummary,
        rcRangeExerciseSummary
      }),
    [
    airframe.frameClassValue,
    airframe.frameClassLabel,
    airframe.expectedMotorCount,
    airframe.frameTypeIgnored,
    airframe.frameTypeLabel,
    airframe.frameTypeValue,
    batteryCapacity,
    batteryFailsafe,
    batteryMonitor,
    boardOrientation,
    busyAction,
    canRunModeSwitchExercise,
    canRunRcMappingExercise,
    canRunRcRangeExercise,
    currentRcAxisChannelMap,
    escSetup,
    modeExerciseAssignments.length,
    modeSwitchEstimate.channelNumber,
    modeSwitchEstimate.estimatedSlot,
    modeSwitchExercise.failureReason,
    modeSwitchExercise.status,
    modeSwitchExerciseSummary,
    motorVerification.status,
    outputMapping.configuredAuxOutputs.length,
    outputMapping.motorOutputs.length,
    outputMapping.notes,
    parameterFollowUp,
    orientationExercise.status,
    rcCalibrationSession.failureReason,
    rcCalibrationSession.status,
    rcMappingSession.currentTargetAxis,
    rcMappingSession.failureReason,
    rcMappingSession.status,
    rcMappingSummary,
    rcRangeExercise.failureReason,
    rcRangeExercise.status,
    rcRangeExerciseSummary,
    rcAxisObservations,
    setupConfirmations,
    setupFlowFollowUp,
    snapshot,
    snapshot.preArmStatus,
    snapshot.liveVerification.attitudeTelemetry.verified,
    snapshot.motorTest.status,
    throttleFailsafe
  ])
  const guidedSetupTestingShortcutActive = guidedSetupShortcutSectionId !== undefined
  const {
    recommendedSetupSection,
    selectedSetupSectionCandidate,
    selectedSetupSection,
    selectedSetupSectionIndex,
    previousSetupSection,
    nextSetupSection,
    completedSetupSectionCount,
    setupFlowProgress,
    guidedSetupComplete,
    guidedSetupHasExceptions,
    guidedSetupOutcomeSummary,
    guidedSetupTaskAction,
    continueButtonTargeted,
    guidedSetupPrimaryAction,
    guidedSetupContextAction,
    guidedSetupSupportActions,
    guidedSetupContextHint
  } = buildGuidedSetupOverview({
    setupFlowSections,
    selectedSetupSectionId,
    guidedSetupTestingShortcutActive,
    orientationExerciseStatus: orientationExercise.status,
    motorVerificationStatus: motorVerification.status
  })
  const isExpertMode = productMode === 'expert'
  const appViews = useMemo<AppViewDescriptor[]>(
    () =>
      buildAppViews({
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
      }),
    [
      completedSetupSectionCount,
      guidedSetupComplete,
      metadataCatalog.appViews,
      outputAssignmentInvalidDrafts.length,
      outputAssignmentStagedDrafts.length,
      osdInvalidDrafts.length,
      osdLinkPorts.length,
      osdStagedDrafts.length,
      outputMapping.motorOutputs.length,
      configuredOutputs.length,
      isCopterVehicle,
      portsAdditionalInvalidDrafts.length,
      portsAdditionalStagedDrafts.length,
      portsInvalidDrafts.length,
      portsStagedDrafts.length,
      powerAdditionalInvalidDrafts.length,
      powerAdditionalStagedDrafts.length,
      powerInvalidDrafts.length,
      powerStagedDrafts.length,
      receiverAdditionalInvalidDrafts.length,
      receiverAdditionalStagedDrafts.length,
      receiverInvalidDrafts.length,
      receiverStagedDrafts.length,
      serialPortViewModels.length,
      setupFlowSections.length,
      savedSnapshots.length,
      snapshot.liveVerification.rcInput.verified,
      snapshot.parameters.length,
      snapshot.preArmStatus,
      presetDefinitions.length,
      selectedPresetApplicability.status,
      selectedPresetChangedEntries.length,
      selectedPresetInvalidEntries.length,
      selectedSnapshotChangedEntries.length,
      selectedSnapshotInvalidEntries.length,
      totalOutputInvalidDrafts,
      totalOutputStagedDrafts,
      tuningInvalidDrafts.length,
      tuningParameters.length,
      tuningStagedDrafts.length,
      isPlaneVehicle,
      isRoverVehicle,
      isSubVehicle,
      planeTuningControlCount,
      planeTuningInvalidDrafts.length,
      planeTuningStagedDrafts.length,
      roverTuningControlCount,
      roverTuningInvalidDrafts.length,
      roverTuningStagedDrafts.length,
      subTuningControlCount,
      subTuningInvalidDrafts.length,
      subTuningStagedDrafts.length,
      vtxInvalidDrafts.length,
      vtxLinkPorts.length,
      vtxStagedDrafts.length,
      stagedParameterDrafts.length
    ]
  )
  const {
    rcMixerChannels,
    rcMixerFunctionLookup,
    rcMixerLivePwmByChannel,
    handleRcMixerAddAssignment,
    handleRcMixerRemoveAssignment,
    handleRcMixerUpdateAssignment
  } = useRcMixer(snapshot)
  const visibleAppViews = useMemo(
    () =>
      buildVisibleAppViews({
        appViews,
        isExpertMode,
        canBusStatus: snapshot.canBus.status,
        canBusBus: snapshot.canBus.bus,
        connectionKind: snapshot.connection.kind
      }),
    [appViews, isExpertMode, snapshot.canBus.status, snapshot.canBus.bus, snapshot.connection.kind]
  )
  const activeViewDescriptor = visibleAppViews.find((view) => view.id === activeViewId) ?? visibleAppViews[0]
  function formatCategoryLabel(categoryId: string | undefined): string {
    if (!categoryId) {
      return 'Uncategorized'
    }

    return metadataCatalog.categoryById[categoryId]?.label ?? categoryId
  }

  // ESC & DShot section footer: one-click "enable bidirectional DShot"
  // choreography + the hardware-capability warnings the generic field grid
  // can't express. Enabling bdshot stages it on the first 4 outputs
  // (BLH_BDMASK=0b1111) AND turns on BLHeli auto (BLH_AUTO=1), since AP needs
  // both; gated on a DShot protocol with a note that most boards only do
  // bdshot on the first 4 outputs (some do 8).
  function renderEscDshotFooter(): ReactNode {
    const motPwmType = Math.round(
      Number(editedValues.MOT_PWM_TYPE ?? readRoundedParameter(snapshot, 'MOT_PWM_TYPE') ?? 0)
    )
    const isDShot = motPwmType >= 4 && motPwmType <= 7 // DShot150/300/600/1200
    return (
      <div className="esc-dshot-footer" data-testid="esc-dshot-footer">
        <button
          type="button"
          style={buttonStyle()}
          data-testid="esc-enable-bdshot"
          disabled={!isDShot}
          title={isDShot ? undefined : 'Select a DShot ESC protocol first — bidirectional DShot requires DShot.'}
          onClick={() => {
            setDraft('SERVO_BLH_BDMASK', '15')
            setDraft('SERVO_BLH_AUTO', '1')
          }}
        >
          Enable bidirectional DShot (first 4 outputs)
        </button>
        <small>
          {isDShot
            ? 'Stages bdshot on outputs 1-4 and turns on BLHeli auto. Most boards support bdshot on the first 4 outputs only — a few do 8; check your FC before enabling more.'
            : 'Pick a DShot protocol above to enable bidirectional DShot (RPM telemetry).'}
        </small>
      </div>
    )
  }

  function renderMetadataParameterField(parameter: ParameterState) {
    // Shared metadata-driven editor used across Power additional
    // settings, Output additional settings, Tuning, and other generic
    // surfaces. The ScopedField dispatcher picks: bitmask -> per-bit
    // checkbox grid, enum options -> select, otherwise number with
    // smart step inference. Staged-red + "was X" + float-noise
    // formatting still come from the underlying widgets unchanged.
    return (
      <ScopedField
        key={parameter.id}
        parameter={parameter}
        liveValue={parameter.value}
        editedValues={editedValues}
        onChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        stepFallback={parameter.definition?.step ?? 1}
      />
    )
  }

  function handleStageTuningParameterValue(parameter: ParameterState, nextValue: string): void {
    updateDrafts((existing) => {
      let nextEditedValues = applyTuningEditedValue(existing, parameter, nextValue)

      if (tuningRollPitchLinked) {
        const counterpartId = linkedTuningCounterpartId(parameter.id)
        const counterpartParameter = counterpartId ? tuningParameterById.get(counterpartId) : undefined
        if (counterpartParameter) {
          nextEditedValues = applyTuningEditedValue(nextEditedValues, counterpartParameter, nextValue)
        }
      }

      return nextEditedValues
    })
  }

  function handleResetTuningMasterSliders(): void {
    setTuningMasterPiGain(1)
    setTuningMasterDGain(1)
    setTuningMasterFeedforwardGain(1)
    setTuningMasterPitchRatio(1)
    setTuningMasterFilterStrength(1)
  }

  function handleStageTuningMasterAdjustments(): void {
    if (tuningMasterDefaultsActive || tuningMasterPreviewEntries.length === 0) {
      setParameterNotice({
        tone: 'warning',
        text: 'Move at least one master slider before staging grouped tuning changes.'
      })
      return
    }

    mergeDrafts(tuningMasterPreviewDraftValues)
    // Stage in place — do not yank to the Review task. The success notice + the
    // Review task's staged count confirm the batch; the operator opens Review
    // when they are ready.
    setParameterNotice({
      tone: 'success',
      text: `Staged ${tuningMasterPreviewEntries.length} grouped tuning change(s) from the master sliders.`
    })
  }

  function handleStageSelectedTuningProfile(): void {
    if (!selectedTuningProfile || !selectedTuningProfileRestore) {
      return
    }

    if (selectedTuningProfileChangedEntries.length === 0) {
      setTuningProfileNotice({
        tone: 'neutral',
        text: `Tuning profile "${selectedTuningProfile.label}" already matches the current live tune.`
      })
      return
    }

    mergeDrafts(selectedTuningProfileRestore.draftValues)
    // Stage in place — do not yank to the Review task (the operator opens Review
    // themselves when ready). The success notice confirms the staged batch.
    setTuningProfileNotice({
      tone: 'success',
      text: `Staged ${selectedTuningProfileChangedEntries.length} tuning change(s) from "${selectedTuningProfile.label}".`
    })
  }

  // Thin adapter over the extracted AdditionalSettingsCard, preserving the
  // (title, …, discardScope) render-callback contract that several child
  // sections (Failsafe, Power) take as a prop. Binds the apply/discard intent
  // and the live draft state the card itself stays agnostic of.
  function renderAdditionalSettingsCard(
    title: string,
    description: string,
    groups: AdditionalSettingsGroup[],
    draftEntries: ParameterDraftEntry[],
    stagedDrafts: ParameterDraftEntry[],
    invalidDrafts: ParameterDraftEntry[],
    applyActionId: string,
    applyLabel: string,
    discardScope: string
  ): ReactNode {
    return (
      <AdditionalSettingsCard
        title={title}
        description={description}
        groups={groups}
        draftEntries={draftEntries}
        stagedDrafts={stagedDrafts}
        invalidDrafts={invalidDrafts}
        applyActionId={applyActionId}
        applyLabel={applyLabel}
        busyAction={busyAction}
        canApply={canApplyDraftParameters}
        onApply={() => void handleApplyScopedParameterDrafts(draftEntries, applyActionId, title)}
        onDiscard={() => handleDiscardScopedParameterDrafts(draftEntries.map((entry) => entry.id), discardScope)}
        renderField={renderMetadataParameterField}
      />
    )
  }

  useEffect(() => {
    if (!recommendedSetupSection) {
      return
    }

    if (
      !selectedSetupSectionCandidate ||
      (!guidedSetupTestingShortcutActive && selectedSetupSectionCandidate.sequenceState === 'locked')
    ) {
      setSelectedSetupSectionId(recommendedSetupSection.id)
    }
  }, [guidedSetupTestingShortcutActive, recommendedSetupSection, selectedSetupSectionCandidate])

  // Auto-return to guided setup wizard when an exercise completes while on another page
  const exerciseReturnRef = useRef<{
    rcRange: string
    rcMapping: string
    modeSwitchEx: string
    orientation: string
    motorVerification: string
  }>({
    rcRange: rcRangeExercise.status,
    rcMapping: rcMappingSession.status,
    modeSwitchEx: modeSwitchExercise.status,
    orientation: orientationExercise.status,
    motorVerification: motorVerification.status
  })
  useEffect(() => {
    const prev = exerciseReturnRef.current
    const shouldReturnFromRc =
      (prev.rcRange === 'running' && (rcRangeExercise.status === 'passed' || rcRangeExercise.status === 'failed')) ||
      (prev.rcMapping === 'running' && (rcMappingSession.status === 'ready' || rcMappingSession.status === 'failed')) ||
      (prev.modeSwitchEx === 'running' && (modeSwitchExercise.status === 'passed' || modeSwitchExercise.status === 'failed'))
    const shouldReturnFromOrientation =
      prev.orientation === 'running' && (orientationExercise.status === 'passed' || orientationExercise.status === 'failed')
    const shouldReturnFromMotorVerification =
      prev.motorVerification === 'running' && (motorVerification.status === 'passed' || motorVerification.status === 'failed')

    exerciseReturnRef.current = {
      rcRange: rcRangeExercise.status,
      rcMapping: rcMappingSession.status,
      modeSwitchEx: modeSwitchExercise.status,
      orientation: orientationExercise.status,
      motorVerification: motorVerification.status
    }

    if (setupMode !== 'wizard' || activeViewId === 'setup') {
      return
    }

    if (shouldReturnFromOrientation) {
      openSetupWizard(
        'airframe',
        orientationExercise.status === 'passed' ? SETUP_WIZARD_PRIMARY_ACTION_ID : 'wizard-orientation-primary'
      )
      return
    }

    if (shouldReturnFromMotorVerification) {
      openSetupWizard(
        'outputs',
        motorVerification.status === 'passed' ? SETUP_WIZARD_PRIMARY_ACTION_ID : 'wizard-motor-primary'
      )
      return
    }

    if (shouldReturnFromRc) {
      openSetupWizard(undefined, SETUP_WIZARD_PRIMARY_ACTION_ID)
    }
  }, [
    rcRangeExercise.status,
    rcMappingSession.status,
    modeSwitchExercise.status,
    orientationExercise.status,
    motorVerification.status,
    setupMode,
    activeViewId
  ])

  function moveSetupWizard(offset: -1 | 1): void {
    if (!selectedSetupSection) {
      return
    }

    const nextIndex = selectedSetupSectionIndex + offset
    if (nextIndex < 0 || nextIndex >= setupFlowSections.length) {
      return
    }

    const targetSection = setupFlowSections[nextIndex]
    if (!guidedSetupTestingShortcutActive && targetSection.sequenceState === 'locked') {
      return
    }

    setSelectedSetupSectionId(targetSection.id)
  }


  // Escape closes the motor reorder dialog — same affordance the
  // board-media lightbox already has.
  useEffect(() => {
    if (!motorReorderDialogOpen || typeof window === 'undefined') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (motorReorderDialogOpen) {
        setMotorReorderDialogOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [motorReorderDialogOpen])

  useEffect(() => {
    if (savedSnapshots.length === 0) {
      if (selectedSnapshotId !== undefined) {
        setSelectedSnapshotId(undefined)
      }
      return
    }

    if (!selectedSnapshotId || !savedSnapshots.some((savedSnapshot) => savedSnapshot.id === selectedSnapshotId)) {
      setSelectedSnapshotId(savedSnapshots[0]?.id)
    }
  }, [savedSnapshots, selectedSnapshotId])

  useEffect(() => {
    if (savedProvisioningProfiles.length === 0) {
      if (selectedProvisioningProfileId !== undefined) {
        setSelectedProvisioningProfileId(undefined)
      }
      return
    }

    if (
      !selectedProvisioningProfileId ||
      !savedProvisioningProfiles.some((savedProfile) => savedProfile.id === selectedProvisioningProfileId)
    ) {
      setSelectedProvisioningProfileId(savedProvisioningProfiles[0]?.id)
    }
  }, [savedProvisioningProfiles, selectedProvisioningProfileId])

  useEffect(() => {
    if (savedTuningProfiles.length === 0) {
      if (selectedTuningProfileId !== undefined) {
        setSelectedTuningProfileId(undefined)
      }
      return
    }

    if (!selectedTuningProfileId || !savedTuningProfiles.some((savedProfile) => savedProfile.id === selectedTuningProfileId)) {
      setSelectedTuningProfileId(savedTuningProfiles[0]?.id)
    }
  }, [savedTuningProfiles, selectedTuningProfileId])

  useEffect(() => {
    if (presetDefinitions.length === 0) {
      if (selectedPresetId !== undefined) {
        setSelectedPresetId(undefined)
      }
      return
    }

    if (!selectedPresetId || !presetDefinitions.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(presetDefinitions[0]?.id)
    }
  }, [presetDefinitions, selectedPresetId])

  useEffect(() => {
    if (
      motorVerification.status === 'running' &&
      motorVerification.currentOutputChannel !== undefined &&
      motorTestOutput !== motorVerification.currentOutputChannel
    ) {
      setMotorTestOutput(motorVerification.currentOutputChannel)
    }
  }, [motorVerification.status, motorVerification.currentOutputChannel, motorTestOutput])

  useEffect(() => {
    if (
      activeViewId !== 'motors' ||
      !currentMotorTestSucceeded ||
      setupMode !== 'wizard' ||
      selectedSetupSectionId !== 'outputs'
    ) {
      return
    }

    focusOutputsTarget(OUTPUTS_MOTOR_CONFIRM_BUTTON_ID)
  }, [activeViewId, currentMotorTestSucceeded, selectedSetupSectionId, setupMode])

  useEffect(() => {
    setSnapshotRestoreAcknowledged(false)
  }, [selectedSnapshotDiffSignature])

  useEffect(() => {
    setProvisioningRestoreAcknowledged(false)
  }, [selectedProvisioningProfileDiffSignature])

  useEffect(() => {
    setPresetApplyAcknowledged(false)
    setPresetNotice(undefined)
  }, [selectedPresetDiffSignature])

  useEffect(() => {
    if (isExpertMode || !isExpertOnlyView(activeViewId)) {
      return
    }

    setActiveViewId('setup')
  }, [activeViewId, isExpertMode])

  function handleSetupFlowAction(action: SetupFlowActionDescriptor): void {
    if (action.disabled) {
      return
    }

    switch (action.kind) {
      case 'guided':
        if (action.actionId) {
          void handleGuidedAction(action.actionId)
        }
        return
      case 'cancel-guided':
        if (action.actionId) {
          handleCancelGuidedAction(action.actionId)
        }
        return
      case 'orientation-exercise':
        if (orientationExercise.status === 'failed' || orientationExercise.status === 'passed') {
          handleResetOrientationExercise()
        }
        handleStartOrientationExercise()
        return
      case 'motor-verification-start':
        if (motorVerification.status === 'failed' || motorVerification.status === 'passed') {
          handleResetMotorVerification()
        }
        handleStartMotorVerification()
        return
      case 'motor-test-current':
        void handleRunCurrentMotorVerificationTest()
        return
      case 'motor-verification-confirm':
        handleConfirmMotorVerification()
        return
      case 'motor-verification-reset':
        handleResetMotorVerification()
        return
      case 'mode-switch-exercise':
        handleStartModeSwitchExercise()
        setActiveViewId('receiver')
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById('setup-panel-rc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        })
        return
      case 'rc-range-exercise':
        handleStartRcRangeExercise()
        setActiveViewId('receiver')
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById('setup-panel-rc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        })
        return
      case 'rc-mapping-exercise':
        handleStartRcMappingExercise()
        setActiveViewId('receiver')
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById('setup-panel-rc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        })
        return
      case 'confirm-step':
        if (action.sectionId) {
          confirmSetupSection(action.sectionId, action.confirmationOutcome ?? 'complete')
        }
        return
      case 'clear-confirmation':
        if (action.sectionId) {
          clearSetupSectionConfirmation(action.sectionId)
        }
        return
      case 'scroll': {
        if (!action.panelId) return

        scrollToPanel(action.panelId, action.targetElementId)
        return
      }
      default:
        return
    }
  }

  // Calibration (accelerometer / level / compass) lives in the dedicated
  // Calibration tab now — it's intentionally NOT on the Status page bench.
  const setupBenchActions = [
    {
      actionId: 'request-parameters',
      title: 'Pull Parameters',
      copy: parameterFollowUp?.text ?? 'Refresh the parameter snapshot after reboots, board changes, or any setup work that needs a fresh sync.'
    },
    {
      actionId: 'reboot-autopilot',
      title: 'Reboot',
      copy: 'Use a controlled reboot after serial-role, board-orientation, or other reboot-sensitive changes before continuing setup.'
    }
  ] as const
  const setupStatusEntries = snapshot.statusTexts
  const setupHasGpsCard = gpsPeripheralViewModels.length > 0 || snapshot.liveVerification.globalPosition.verified
  // "Configured" means "the GPS chain is set up and working." Two routes:
  //   - A non-zero GPS_TYPE / GPS_TYPE2 parameter in the parameter table
  //     (covers the canonical UART / DroneCAN explicit driver selection).
  //   - A verified live global position (covers the case where the GPS
  //     just IS reporting — irrespective of which parameter name our
  //     metadata happens to know about). Bench evidence on a CubeRed +
  //     Here3 with ArduPlane 4.6.3: STATUSTEXT confirmed "GPS 1:
  //     specified as DroneCAN1-125" yet the configurator reported
  //     "Not configured" because the local GPS_TYPE read landed at 0
  //     while the FC was running its own autoselect. The verified
  //     globalPosition is the load-bearing truth — if a fix is alive,
  //     by definition the driver is working.
  const setupGpsConfigured =
    // EKF-independent SYS_STATUS GPS bit is the load-bearing truth: a
    // DroneCAN GPS (Here4 etc.) with GPS_TYPE=0 autoselect reports
    // present+enabled here even with no satellite fix indoors, where
    // both the live fix and GPS_TYPE routes read as "not configured".
    snapshot.liveVerification.gpsSensor.present ||
    snapshot.liveVerification.globalPosition.verified ||
    gpsPeripheralViewModels.some((peripheral) => peripheral.value !== 0)
  const setupTransportLabel =
    transportMode === 'demo'
      ? 'Demo transport (Copter)'
      : transportMode === 'demo-plane'
        ? 'Demo transport (Plane)'
      : transportMode === 'web-serial'
        ? rememberedSerialPortLabel
          ? `Serial · ${rememberedSerialPortLabel}`
          : 'Serial transport'
        : `WebSocket · ${websocketUrl}`
  const portVisibilitySummary = showAllSerialPorts
    ? `Showing all ${serialPortViewModels.length} detected serial ports.`
    : `Showing ${visibleSerialPortViewModels.length} active or edited port${visibleSerialPortViewModels.length === 1 ? '' : 's'} first${
        hiddenSerialPortCount > 0
          ? `, with ${hiddenSerialPortCount} unused slot${hiddenSerialPortCount === 1 ? '' : 's'} hidden.`
          : '.'
      }`
  const headerBatteryPercent = snapshot.liveVerification.batteryTelemetry.verified
    ? Math.max(8, Math.min(100, snapshot.liveVerification.batteryTelemetry.remainingPercent ?? 62))
    : 6
  const headerParameterPercent =
    snapshot.parameterStats.status === 'complete'
      ? 100
      : snapshot.parameterStats.progress !== null
        ? Math.max(4, Math.min(99, Math.round(snapshot.parameterStats.progress * 100)))
        : snapshot.parameterStats.status === 'requesting'
          ? 20
          : snapshot.parameterStats.status === 'awaiting-vehicle'
            ? 6
            : 0
  // Baro presence/health from the authoritative, EKF-independent
  // SYS_STATUS sensor bitmask, with BARO1_DEVID (a bound baro driver) as
  // a param fallback — mirroring the rangefinder derivation just below.
  // The old check keyed on GLOBAL_POSITION_INT altitude, which ArduPilot
  // only streams once the EKF has a position solution, so a healthy baro
  // on a no-GPS bench (a typical FPV quad on USB) read as "absent".
  const baroParamDetected =
    (selectParameterById(snapshot, 'BARO1_DEVID')?.value ?? 0) !== 0
  const headerBaroActive =
    snapshot.connection.kind === 'connected' &&
    (snapshot.liveVerification.baroSensor.verified || baroParamDetected)
  // audit-19: gyro/accel from the authoritative, EKF-independent
  // SYS_STATUS bits, OR the existing attitude/AHRS signal — a strict
  // superset of the old `attitudeTelemetry.verified`-only check, so the
  // chip is only ever turned ON in more (correct) cases, never off when
  // it would have been on. "Accel" is now a real signal distinct from
  // "Gyro" instead of an alias of the same expression.
  const headerGyroActive =
    snapshot.connection.kind === 'connected' &&
    (snapshot.liveVerification.gyroSensor.verified || snapshot.liveVerification.attitudeTelemetry.verified)
  const headerAccelActive =
    snapshot.connection.kind === 'connected' &&
    (snapshot.liveVerification.accelSensor.verified || snapshot.liveVerification.attitudeTelemetry.verified)
  // audit-21: Mag chip = param-enabled (today's behaviour, preserved —
  // and still the sole input to the compass-cal / Setup gating) OR a
  // healthy mag reported by SYS_STATUS 3D_MAG. Strict superset: only
  // ever more correct, never worse. Chip display only.
  const headerMagActive =
    snapshot.connection.kind === 'connected' &&
    (compassSetupAvailability.enabledCompassCount > 0 || snapshot.liveVerification.magSensor.verified)
  const headerRangefinderActive =
    snapshot.connection.kind === 'connected' &&
    ((selectParameterById(snapshot, 'RNGFND1_TYPE') ?? selectParameterById(snapshot, 'RNGFND_TYPE'))?.value ?? 0) !== 0
  // Flow chip: lit if OPTICAL_FLOW (msgid 100) is heartbeating. ArduCopter
  // streams it at 10 Hz when an optical-flow sensor is wired, so a 2s
  // freshness window comfortably covers ~20 expected messages — a single
  // missed update doesn't drop the chip, but a real outage does. We deliberately
  // do not look at the flow quality value: "pulse on the sensor" is exactly
  // what the user asked for, and a low-quality but live sensor still proves
  // the wiring works.
  const headerFlowActive =
    snapshot.connection.kind === 'connected' &&
    snapshot.liveVerification.opticalFlow.verified &&
    snapshot.liveVerification.opticalFlow.lastSeenAtMs !== undefined &&
    Date.now() - snapshot.liveVerification.opticalFlow.lastSeenAtMs < 2000
  // Inactive-chip diagnosis. ArduCopter only emits OPTICAL_FLOW when
  // FLOW_TYPE != 0 and the configured driver enumerates a sensor. A grey
  // chip therefore has three meaningfully different causes; surfacing
  // FLOW_TYPE in the tooltip is what lets operators tell them apart on
  // the bench without diving into the parameter editor.
  const flowTypeValue = readRoundedParameter(snapshot, 'FLOW_TYPE')
  const flowTypeConfigured = flowTypeValue !== undefined && flowTypeValue !== 0
  const headerFlowInactiveTitle = (() => {
    if (snapshot.connection.kind !== 'connected') {
      return 'Connect to the vehicle to see optical flow status.'
    }
    if (!flowTypeConfigured) {
      return flowTypeValue === undefined
        ? 'FLOW_TYPE is not in the parameter table yet — finish parameter sync, then set FLOW_TYPE to your sensor (e.g. 10 HereFlow, 8 PMW3901) to enable the optical flow stream.'
        : 'FLOW_TYPE is 0 (disabled). Set FLOW_TYPE to your sensor (e.g. 10 HereFlow, 8 PMW3901) and reboot to enable the optical flow stream.'
    }
    if (snapshot.liveVerification.opticalFlow.lastSeenAtMs !== undefined) {
      return `FLOW_TYPE=${flowTypeValue} is configured and the sensor was reporting, but the OPTICAL_FLOW stream has gone silent. Check the sensor wiring or the driver-specific bus.`
    }
    return `FLOW_TYPE=${flowTypeValue} is configured but no OPTICAL_FLOW messages have arrived yet. Verify the sensor wiring; some drivers need a reboot after FLOW_TYPE changes.`
  })()
  const headerWarningActive =
    !snapshot.preArmStatus.healthy || snapshot.statusTexts.some((entry) => entry.severity === 'warning' || entry.severity === 'error')
  const headerBatteryLabel = snapshot.liveVerification.batteryTelemetry.verified
    ? `${formatVoltage(snapshot.liveVerification.batteryTelemetry.voltageV)}${
        snapshot.liveVerification.batteryTelemetry.remainingPercent !== undefined
          ? ` · ${formatRemaining(snapshot.liveVerification.batteryTelemetry.remainingPercent)}`
          : ''
      }`
    : 'No live battery telemetry'
  const headerParameterLabel =
    snapshot.parameterStats.status === 'complete'
      ? `Params ${snapshot.parameterStats.downloaded}`
      : `Params ${formatParameterSync(snapshot)}`
  const headerSensorItems = [
    {
      id: 'gyro',
      label: 'Gyro',
      stateClass: headerGyroActive ? 'is-active' : '',
      title: headerGyroActive
        ? 'Gyro present and healthy (SYS_STATUS) or attitude telemetry is live.'
        : 'No healthy gyro reported by SYS_STATUS and no attitude telemetry yet.'
    },
    {
      id: 'accel',
      label: 'Accel',
      stateClass: headerAccelActive ? 'is-active' : '',
      title: headerAccelActive
        ? 'Accelerometer present and healthy (SYS_STATUS) or attitude telemetry is live.'
        : 'No healthy accelerometer reported by SYS_STATUS and no attitude telemetry yet.'
    },
    {
      id: 'mag',
      label: 'Mag',
      stateClass: headerMagActive ? 'is-active' : '',
      title: headerMagActive
        ? compassSetupAvailability.enabledCompassCount > 0
          ? `${compassSetupAvailability.enabledCompassCount} enabled compass${compassSetupAvailability.enabledCompassCount === 1 ? '' : 'es'}${snapshot.liveVerification.magSensor.verified ? ', SYS_STATUS healthy' : ''}.`
          : 'Compass present and healthy (SYS_STATUS 3D_MAG).'
        : 'No enabled compass in parameters and none reported healthy by SYS_STATUS.'
    },
    {
      id: 'baro',
      label: 'Baro',
      stateClass: headerBaroActive ? 'is-active' : '',
      title: headerBaroActive
        ? 'Barometer present and healthy (SYS_STATUS / BARO1_DEVID).'
        : 'No barometer reported by SYS_STATUS and BARO1_DEVID is 0 — check the FC firmware/board target.'
    },
    {
      id: 'gps',
      label: 'GPS',
      stateClass: snapshot.liveVerification.globalPosition.verified ? 'is-fix' : setupGpsConfigured ? 'is-active' : '',
      title: snapshot.liveVerification.globalPosition.verified
        ? 'GPS fix is verified.'
        : setupGpsConfigured
          ? 'GPS is configured but no live fix is verified.'
          : 'GPS is not configured or no live GPS is present.'
    },
    {
      id: 'rc',
      label: 'RC',
      stateClass: snapshot.liveVerification.rcInput.verified ? 'is-active' : '',
      title: snapshot.liveVerification.rcInput.verified
        ? `${snapshot.liveVerification.rcInput.channelCount} RC channels are live.`
        : 'RC waiting.'
    },
    {
      id: 'rng',
      label: 'Rng',
      stateClass: headerRangefinderActive ? 'is-active' : '',
      title: headerRangefinderActive
        ? 'Rangefinder is configured (RNGFND1_TYPE non-zero).'
        : 'No rangefinder configured.'
    },
    {
      id: 'flow',
      label: 'Flow',
      stateClass: headerFlowActive ? 'is-active' : '',
      title: headerFlowActive
        ? `Optical flow sensor is reporting (OPTICAL_FLOW msgid 100${
            flowTypeValue !== undefined && flowTypeValue !== 0 ? `, FLOW_TYPE=${flowTypeValue}` : ''
          }${
            snapshot.liveVerification.opticalFlow.quality !== undefined
              ? `, quality ${snapshot.liveVerification.opticalFlow.quality}/255`
              : ''
          }).`
        : headerFlowInactiveTitle
    }
  ] as const

  const showLanding = activeViewId === 'setup' && snapshot.connection.kind !== 'connected'

  return (
    <>
      {swUpdate.kind === 'available' ? (
        <div className="sw-update-banner" role="status" data-testid="sw-update-banner">
          <span className="sw-update-banner__message">A new version of ArduConfigurator is ready.</span>
          <button
            type="button"
            className="sw-update-banner__action"
            data-testid="sw-update-refresh"
            onClick={swUpdate.apply}
          >
            Refresh
          </button>
        </div>
      ) : null}
	    <main className="app-shell">
      <AppHeader
        snapshot={snapshot}
        transportMode={transportMode}
        busyAction={busyAction}
        websocketUrl={websocketUrl}
        webSerialSupported={webSerialSupported}
        udpSupported={udpSupported}
        tcpSupported={tcpSupported}
        udpTarget={udpTarget}
        tcpTarget={tcpTarget}
        onUdpTargetChange={setUdpTarget}
        onTcpTargetChange={setTcpTarget}
        headerBatteryPercent={headerBatteryPercent}
        headerBatteryLabel={headerBatteryLabel}
        headerWarningActive={headerWarningActive}
        headerSensorItems={headerSensorItems}
        headerParameterLabel={headerParameterLabel}
        headerParameterPercent={headerParameterPercent}
        productMode={productMode}
        parameterFollowUp={parameterFollowUp}
        onGoToSetup={() => {
          // Keep the operator's wizard step. The wizard routes RC work to
          // the Receiver view and the brand button is the natural way
          // back; forcing overview here was the "kicked back to the
          // overview menu" dead-end after the mapping exercise. The
          // wizard's own Close button still exits to overview.
          setActiveViewId('setup')
        }}
        onTransportModeChange={setTransportMode}
        onWebsocketUrlChange={setWebsocketUrl}
        onProductModeChange={setProductMode}
        onConnect={() => void handleConnect()}
        onDisconnect={() => void handleDisconnect()}
      />

      {/* Persistent staged-changes bar. Editing any param tab stages a draft;
          this bar follows you across every tab while edits are pending and
          offers one place to review (Show changes -> Parameters) and write the
          whole set (Write all), or discard. Hidden when nothing is staged. */}
      {snapshot.connection.kind === 'connected' &&
      (parameterDraftSummary.stagedCount > 0 || parameterDraftSummary.invalidCount > 0) ? (
        <ParameterDraftBar
          summary={parameterDraftSummary}
          busyAction={busyAction}
          canApplyAllDraftParameters={canApplyAllDraftParameters}
          applyAllBusyLabel={applyAllBusyLabel}
          onShowChanges={() => setActiveViewId('parameters')}
          onWriteAll={() => void handleApplyAllParameterDrafts()}
          onDiscard={clearAllDrafts}
        />
      ) : null}

      <div className="workspace-layout">
        <WorkspaceSidebar
          snapshot={snapshot}
          transportMode={transportMode}
          rememberedSerialPortLabel={rememberedSerialPortLabel}
          websocketUrl={websocketUrl}
          webSerialSupported={webSerialSupported}
          selectedSnapshot={selectedSnapshot}
          selectedSnapshotInvalidCount={selectedSnapshotInvalidEntries.length}
          selectedSnapshotChangedCount={selectedSnapshotChangedEntries.length}
          selectedSnapshotRebootSensitiveCount={selectedSnapshotRebootSensitiveCount}
          savedSnapshotCount={savedSnapshots.length}
          visibleAppViews={visibleAppViews}
          activeViewId={activeViewId}
          onSelectView={setActiveViewId}
        />

        <div className="workspace-main">
          <WorkspaceNotes
            snapshot={snapshot}
            sessionNotice={sessionNotice}
            parameterFollowUp={parameterFollowUp}
            isExpertMode={isExpertMode}
            stagedParameterDraftCount={stagedParameterDrafts.length}
            busyAction={busyAction}
            onRebootAutopilot={() => void handleGuidedAction('reboot-autopilot')}
            onPullParameters={() => void handleGuidedAction('request-parameters')}
          />

          {activeViewDescriptor && !showLanding ? (
            <header className="workspace-main__header workspace-main__header--betaflight" aria-hidden="true">
              <div className="workspace-main__tab-copy">
                <h2 data-testid="workspace-view-title">{activeViewDescriptor.label}</h2>
                <p>{activeViewDescriptor.description}</p>
              </div>
              <div className="workspace-main__tab-meta">
                <StatusBadge tone={activeViewDescriptor.tone}>{activeViewDescriptor.badge}</StatusBadge>
              </div>
            </header>
          ) : null}
	      {showLanding ? (
            <DisconnectedLanding
              transportMode={transportMode}
              onTransportModeChange={setTransportMode}
              webSerialSupported={webSerialSupported}
              websocketUrl={websocketUrl}
              onWebsocketUrlChange={setWebsocketUrl}
              websocketUrlPlaceholder={DEFAULT_WEBSOCKET_URL}
              udpSupported={udpSupported}
              tcpSupported={tcpSupported}
              udpTarget={udpTarget}
              onUdpTargetChange={setUdpTarget}
              udpTargetPlaceholder={DEFAULT_UDP_TARGET}
              tcpTarget={tcpTarget}
              onTcpTargetChange={setTcpTarget}
              tcpTargetPlaceholder={DEFAULT_TCP_TARGET}
              connectLabel={connectButtonLabel(snapshot, parameterFollowUp, busyAction)}
              onConnect={() => void handleConnect()}
              connectDisabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
            />
          ) : activeViewId === 'setup' ? (
            <SetupView
              mode={setupMode}
              actionsSlot={
                setupMode === 'wizard' ? (
                  <div className="button-row">
                    {selectedSetupSection ? (
                      <StatusBadge tone={toneForSetup(selectedSetupSection.status)}>
                        Step {selectedSetupSectionIndex + 1}/{setupFlowSections.length}
                      </StatusBadge>
                    ) : null}
                    <button style={buttonStyle()} onClick={closeSetupWizard}>
                      Back to Setup
                    </button>
                  </div>
                ) : undefined
              }
              overviewSlot={
                <>
  	              <div id="setup-panel-link" className="setup-bench">
                    <SetupBenchActions
                      actions={setupBenchActions}
                      snapshot={snapshot}
                      busyAction={busyAction}
                      onAction={(actionId) => void handleGuidedAction(actionId)}
                    />

                    <StatusDfuCard
                      connected={snapshot.connection.kind === 'connected'}
                      vehicleArmed={snapshot.vehicle?.armed === true}
                      armed={statusDfuArmed}
                      onArm={() => setStatusDfuArmed(true)}
                      onConfirm={() => {
                        setStatusDfuArmed(false)
                        void runtime.rebootToBootloader()
                      }}
                      onCancel={() => setStatusDfuArmed(false)}
                    />

                    <div className="setup-bench__workspace">
                      <div className="setup-bench__viewer">
                        <div className="setup-bench__viewer-header">
                          <div className="setup-bench__viewer-titlebar">
                            <strong>Craft View</strong>
                          </div>
                          <div className="config-pills">
                            <span>{snapshot.vehicle?.flightMode ?? 'No mode'}</span>
                            <span>{airframe.frameClassLabel}</span>
                            <span>{snapshot.vehicle?.armed ? 'Armed' : 'Disarmed'}</span>
                          </div>
                        </div>
                        <p className="setup-bench__viewer-note">
                          Level the aircraft on the desk, verify the model response, then continue into the deeper ArduPilot workflow.
                        </p>

                        <AttitudePreview
                          snapshot={snapshot}
                          showReadouts={false}
                          frameClassLabel={airframe.frameClassLabel}
                          frameTypeLabel={airframe.frameTypeLabel}
                        />

                        {/* System Info / Statistics / Recent Notices live UNDER
                         *  the 3D craft model in the main column (not in the
                         *  sidebar) so the operator can read them at-glance
                         *  alongside the model without having their eye dragged
                         *  to the right column. The sidebar keeps action-oriented
                         *  cards (Instruments / Guided Setup / GPS). */}
                        <div className="setup-bench__status-trio">
                        <article className="setup-gui-box">
                          <div className="setup-gui-box__titlebar">
                            <strong>System Info</strong>
                            <StatusBadge tone={toneForConnection(snapshot.connection.kind)}>{snapshot.connection.kind}</StatusBadge>
                          </div>
                          <div className="setup-gui-box__body">
                            <div className="setup-gui-box__kv-list">
                              <div className="setup-gui-box__kv-row"><span>Transport</span><strong>{setupTransportLabel}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Vehicle</span><strong>{snapshot.vehicle?.vehicle ?? '—'}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Firmware</span><strong>{snapshot.vehicle?.firmware ?? '—'}</strong></div>
                              {snapshot.hardware.board?.firmwareVersion ? (
                                <div className="setup-gui-box__kv-row"><span>FW version</span><strong>{snapshot.hardware.board.firmwareVersion}</strong></div>
                              ) : null}
                              {snapshot.hardware.board?.firmwareGitHash ? (
                                <div className="setup-gui-box__kv-row">
                                  <span>FW git hash</span>
                                  <strong><code>{snapshot.hardware.board.firmwareGitHash}</code></strong>
                                </div>
                              ) : null}
                              <div className="setup-gui-box__kv-row">
                                <span>Configurator build</span>
                                <strong><code>{GIT_BRANCH}@{GIT_HASH}</code></strong>
                              </div>
                              <div className="setup-gui-box__kv-row">
                                <span>Parameters</span>
                                <strong>{snapshot.parameterStats.status === 'complete' ? `${snapshot.parameterStats.downloaded}` : formatParameterSync(snapshot)}</strong>
                              </div>
                              <div className="setup-gui-box__kv-row"><span>Battery</span><strong>{formatBatteryTelemetry(snapshot)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>RC link</span><strong>{formatRcLink(snapshot)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Pre-arm</span><strong>{snapshot.preArmStatus.healthy ? 'Clear' : `${snapshot.preArmStatus.issues.length} issues`}</strong></div>
                            </div>
                          </div>
                        </article>

                        <article className="setup-gui-box" data-testid="setup-statistics">
                          <div className="setup-gui-box__titlebar">
                            <strong>Statistics</strong>
                            <StatusBadge tone="neutral">lifetime</StatusBadge>
                          </div>
                          <div className="setup-gui-box__body">
                            <div className="setup-gui-box__kv-list">
                              <div className="setup-gui-box__kv-row"><span>Total runtime</span><strong>{formatStatHours(readRoundedParameter(snapshot, 'STAT_RUNTIME'))}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Flight time</span><strong>{formatStatHours(readRoundedParameter(snapshot, 'STAT_FLTTIME'))}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Boot count</span><strong>{readRoundedParameter(snapshot, 'STAT_BOOTCNT') ?? '—'}</strong></div>
                            </div>
                          </div>
                        </article>

                        <article className="setup-gui-box">
                          <div className="setup-gui-box__titlebar">
                            <strong>Recent Notices</strong>
                            {(() => {
                              const severities = new Set(snapshot.statusTexts.map((entry) => entry.severity))
                              const tone: 'danger' | 'warning' | 'neutral' =
                                severities.has('error')
                                  ? 'danger'
                                  : severities.has('warning')
                                    ? 'warning'
                                    : 'neutral'
                              return (
                                <StatusBadge tone={tone}>
                                  {snapshot.statusTexts.length > 0 ? `${snapshot.statusTexts.length} entries` : 'quiet'}
                                </StatusBadge>
                              )
                            })()}
                            <button
                              type="button"
                              className="setup-gui-box__icon-button"
                              data-testid="setup-notices-copy-all"
                              onClick={() => {
                                if (setupStatusEntries.length === 0) {
                                  return
                                }
                                const payload = setupStatusEntries
                                  .map((entry) => `[${entry.severity.toUpperCase()}] ${entry.text}`)
                                  .join('\n')
                                const finish = () => {
                                  setNoticesCopied(true)
                                  window.setTimeout(() => setNoticesCopied(false), 1500)
                                }
                                if (navigator.clipboard?.writeText) {
                                  navigator.clipboard.writeText(payload).then(finish).catch(() => {
                                    const textarea = document.createElement('textarea')
                                    textarea.value = payload
                                    textarea.setAttribute('readonly', '')
                                    textarea.style.position = 'fixed'
                                    textarea.style.opacity = '0'
                                    document.body.appendChild(textarea)
                                    textarea.select()
                                    try { document.execCommand('copy') } catch {}
                                    document.body.removeChild(textarea)
                                    finish()
                                  })
                                } else {
                                  const textarea = document.createElement('textarea')
                                  textarea.value = payload
                                  textarea.setAttribute('readonly', '')
                                  textarea.style.position = 'fixed'
                                  textarea.style.opacity = '0'
                                  document.body.appendChild(textarea)
                                  textarea.select()
                                  try { document.execCommand('copy') } catch {}
                                  document.body.removeChild(textarea)
                                  finish()
                                }
                              }}
                              disabled={setupStatusEntries.length === 0}
                              title="Copy all notices to clipboard"
                              aria-label="Copy all notices to clipboard"
                            >
                              {noticesCopied ? 'Copied' : 'Copy all'}
                            </button>
                          </div>
                          <div className="setup-gui-box__body">
                            <div className="setup-gui-box__status-list setup-gui-box__status-list--scroll" data-testid="setup-notices-list">
                              {setupStatusEntries.length === 0 ? <span className="setup-gui-box__empty">No status text yet</span> : null}
                              {(['error', 'warning', 'info'] as const).map((severity) => {
                                const groupEntries = setupStatusEntries.filter((entry) => entry.severity === severity)
                                if (groupEntries.length === 0) return null
                                const groupLabel =
                                  severity === 'error' ? 'Errors' : severity === 'warning' ? 'Warnings' : 'Info'
                                return (
                                  <div
                                    key={severity}
                                    className={`setup-gui-box__status-group setup-gui-box__status-group--${severity}`}
                                    data-testid={`setup-notices-group-${severity}`}
                                  >
                                    <header className="setup-gui-box__status-group-header">
                                      <strong>{groupLabel}</strong>
                                      <span>{groupEntries.length}</span>
                                    </header>
                                    {groupEntries.map((entry, index) => (
                                      <div
                                        key={`${severity}-${index}-${entry.text}`}
                                        className={`setup-gui-box__status-entry is-${entry.severity}`}
                                      >
                                        <strong>{entry.severity}</strong>
                                        <span>{entry.text}</span>
                                      </div>
                                    ))}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </article>
                        </div>
                      </div>

                      <div className="setup-bench__sidebar">
                        <article className="setup-gui-box">
                          <div className="setup-gui-box__titlebar">
                            <strong>Instruments</strong>
                            <StatusBadge tone={snapshot.liveVerification.attitudeTelemetry.verified ? 'success' : 'warning'}>
                              {snapshot.liveVerification.attitudeTelemetry.verified ? 'live' : 'waiting'}
                            </StatusBadge>
                          </div>
                          <div className="setup-gui-box__body">
                            <div className="setup-gui-box__kv-list">
                              <div className="setup-gui-box__kv-row"><span>Flight mode</span><strong>{snapshot.vehicle?.flightMode ?? 'Waiting'}</strong></div>
                              <div className="setup-gui-box__kv-row" data-testid="setup-vehicle-system-status"><span>System state</span><strong>{formatVehicleSystemStatus(snapshot.vehicle?.systemStatus)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Roll</span><strong>{formatDegreeTelemetry(snapshot.liveVerification.attitudeTelemetry.rollDeg)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Pitch</span><strong>{formatDegreeTelemetry(snapshot.liveVerification.attitudeTelemetry.pitchDeg)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Heading</span><strong>{formatHeadingTelemetry(snapshot.liveVerification.attitudeTelemetry.yawDeg)}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Link state</span><strong>{snapshot.liveVerification.attitudeTelemetry.verified ? 'Synced' : 'Waiting'}</strong></div>
                            </div>
                          </div>
                        </article>

                        {/* Guided setup pulled up next to Instruments so the
                         *  primary action ("Start / Resume Setup") lives right
                         *  under the 3D craft model — the operator's eye
                         *  flows from "is the model responding?" → "what's
                         *  the next step?" without scrolling past GPS /
                         *  System Info / Statistics first. */}
                        <article className={`setup-gui-box setup-gui-box--guided${guidedSetupComplete ? ' is-complete' : ''}`}>
                          <div className="setup-gui-box__titlebar">
                            <strong>{guidedSetupComplete ? 'Guided setup complete' : 'Guided setup'}</strong>
                            <StatusBadge tone={guidedSetupComplete ? 'success' : 'warning'}>
                              {completedSetupSectionCount}/{setupFlowSections.length}
                            </StatusBadge>
                          </div>
                          <div className="setup-gui-box__body">
                            <p className="setup-gui-box__note">
                              {guidedSetupComplete
                                ? guidedSetupHasExceptions
                                  ? 'All steps were resolved, but there are deferred or skipped decisions to review before flight.'
                                  : 'All setup steps were verified. Use the task rail for refinement.'
                                : selectedSetupSection
                                  ? `Next recommended step: ${selectedSetupSection.title}.`
                                  : 'Start guided setup to move through the ArduPilot-specific checklist one step at a time.'}
                            </p>
                            {guidedSetupComplete && guidedSetupOutcomeSummary ? (
                              <p className="setup-gui-box__note">{guidedSetupOutcomeSummary}</p>
                            ) : null}
                            <div className="setup-gui-box__button-row">
                              <button
                                className="setup-launch-button"
                                style={buttonStyle('hero')}
                                onClick={() => openSetupWizard()}
                                disabled={!recommendedSetupSection}
                                data-testid="setup-start-guided-button"
                              >
                                {guidedSetupComplete ? 'Review Setup' : completedSetupSectionCount > 0 ? 'Resume Setup' : 'Start Guided Setup'}
                              </button>
                            </div>
                          </div>
                        </article>

                        <article className="setup-gui-box">
                          <div className="setup-gui-box__titlebar">
                            <strong>GPS</strong>
                            <StatusBadge tone={snapshot.preArmStatus.healthy ? 'success' : 'warning'}>
                              {snapshot.preArmStatus.healthy ? 'ready' : 'attention'}
                            </StatusBadge>
                          </div>
                          <div className="setup-gui-box__body">
                            <div className="setup-gui-box__kv-list">
                              <div className="setup-gui-box__kv-row"><span>Driver</span><strong>{setupGpsConfigured ? 'Configured' : 'Not configured'}</strong></div>
                              <div className="setup-gui-box__kv-row"><span>Fix</span><strong>{setupHasGpsCard && snapshot.liveVerification.globalPosition.verified ? 'Verified' : 'Waiting'}</strong></div>
                              <div className="setup-gui-box__kv-row setup-gui-box__kv-row--control">
                                <span>Format</span>
                                <select
                                  className="setup-gui-box__inline-select"
                                  value={gpsCoordFormat}
                                  onChange={(event) => setGpsCoordFormat(event.target.value as GpsCoordFormat)}
                                  data-testid="setup-gps-format-select"
                                  aria-label="GPS coordinate display format"
                                  title="Display format only — does not affect OSD or vehicle."
                                >
                                  {GPS_COORD_FORMAT_VALUES.map((value) => (
                                    <option key={value} value={value}>{GPS_COORD_FORMAT_LABELS[value]}</option>
                                  ))}
                                </select>
                              </div>
                              {gpsCoordFormat === 'mgrs' ? (
                                <div className="setup-gui-box__kv-row"><span>Grid (MGRS)</span><strong data-testid="setup-gps-mgrs">{formatMgrs(snapshot.liveVerification.globalPosition.latitudeDeg, snapshot.liveVerification.globalPosition.longitudeDeg)}</strong></div>
                              ) : gpsCoordFormat === 'dms' ? (
                                <>
                                  <div className="setup-gui-box__kv-row"><span>Latitude</span><strong>{formatLatitudeDms(snapshot.liveVerification.globalPosition.latitudeDeg)}</strong></div>
                                  <div className="setup-gui-box__kv-row"><span>Longitude</span><strong>{formatLongitudeDms(snapshot.liveVerification.globalPosition.longitudeDeg)}</strong></div>
                                </>
                              ) : (
                                <>
                                  <div className="setup-gui-box__kv-row"><span>Latitude</span><strong>{formatLatitudeDecimal(snapshot.liveVerification.globalPosition.latitudeDeg)}</strong></div>
                                  <div className="setup-gui-box__kv-row"><span>Longitude</span><strong>{formatLongitudeDecimal(snapshot.liveVerification.globalPosition.longitudeDeg)}</strong></div>
                                </>
                              )}
                            </div>
                            <p className="setup-gui-box__note">
                              {setupHasGpsCard
                                ? snapshot.liveVerification.globalPosition.verified
                                  ? 'Live GPS is arriving. Treat the map as a side check while the craft preview stays primary.'
                                  : 'A GPS driver is configured, but live position is not verified yet. Finish the port and GPS workflow, then return here.'
                                : 'No verified GPS source yet. That is acceptable for bench work, but guided modes should wait until GPS is configured.'}
                            </p>
                            {setupHasGpsCard ? (
                              <div className="setup-gui-box__map">
                                <LiveGpsMapCard
                                  snapshot={snapshot}
                                  title="GPS map"
                                  subtitle="Side check"
                                  compact
                                  testId="setup-gps-map-widget"
                                />
                              </div>
                            ) : null}
                          </div>
                        </article>

                      </div>
                    </div>
  	              </div>

                  {setupFlowFollowUp ? (
                    <div className={`setup-flow__banner setup-flow__banner--${setupFlowFollowUp.tone}`}>
                      <div>
                        <strong>{setupFlowFollowUp.title}</strong>
                        <p>{setupFlowFollowUp.text}</p>
                      </div>
                    </div>
                  ) : null}
                </>
              }
              wizardSlot={
                selectedSetupSection ? (
                <div id="setup-panel-guided" className="setup-wizard" data-testid="setup-wizard">
                  <SetupWizardHeader
                    selectedSetupSection={selectedSetupSection}
                    selectedSetupSectionIndex={selectedSetupSectionIndex}
                    setupFlowSections={setupFlowSections}
                    setupFlowProgress={setupFlowProgress}
                    setupFlowFollowUp={setupFlowFollowUp}
                    guidedSetupTestingShortcutActive={guidedSetupTestingShortcutActive}
                    onSelectStep={(sectionId) => {
                      setSelectedSetupSectionId(sectionId)
                      setSetupMode('wizard')
                    }}
                  />

                  <div className="setup-wizard__body">
                    <div className="setup-wizard__main">
                      {selectedSetupSection.id === 'airframe' && !isCopterVehicle && qEnableParameter ? (
                        <div className="setup-wizard__task-card" data-testid="plane-frame-config">
                          <div className="setup-wizard__task-header">
                            <div>
                              <strong>Plane Frame Configuration</strong>
                              <p>
                                Set the QuadPlane / tailsitter geometry. Pure fixed-wing builds
                                leave Q_ENABLE at 0; enable it for VTOL hybrids, then pick the lift-motor
                                frame class and type.
                              </p>
                            </div>
                          </div>
                          <div className="scoped-editor-grid">
                            <ScopedSelectField
                              parameter={qEnableParameter}
                              liveValue={qEnableParameter.value}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                              compact={false}
                            />
                            {qFrameClassParameter ? (
                              <ScopedSelectField
                                parameter={qFrameClassParameter}
                                liveValue={qFrameClassParameter.value}
                                editedValues={editedValues}
                                onChange={(paramId, value) => setDraft(paramId, value)}
                                draftStatusById={parameterDraftById}
                                compact={false}
                              />
                            ) : null}
                            {qFrameTypeParameter ? (
                              <ScopedSelectField
                                parameter={qFrameTypeParameter}
                                liveValue={qFrameTypeParameter.value}
                                editedValues={editedValues}
                                onChange={(paramId, value) => setDraft(paramId, value)}
                                draftStatusById={parameterDraftById}
                                compact={false}
                              />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {selectedSetupSection.id === 'airframe' ? (
                        <div
                          className={`setup-wizard__task-card setup-wizard__task-card--orientation setup-wizard__task-card--${
                            orientationExercise.status === 'passed'
                              ? 'success'
                              : orientationExercise.status === 'failed'
                                ? 'danger'
                                : orientationExercise.status === 'running'
                                  ? 'warning'
                                  : 'neutral'
                          }`}
                          data-testid="wizard-orientation-task"
                        >
                          <div className="setup-wizard__task-header">
                            <div>
                              <strong>Orientation Check</strong>
                              <p>{orientationExerciseSummary}</p>
                            </div>
                            <StatusBadge tone={toneForModeSwitchExercise(orientationExercise.status)}>
                              {orientationExercise.status}
                            </StatusBadge>
                          </div>

                          <div className="setup-wizard__task-visual">
                            <AttitudePreview
                              snapshot={snapshot}
                              compact
                              frameClassLabel={airframe.frameClassLabel}
                              frameTypeLabel={airframe.frameTypeLabel}
                            />
                          </div>

                          <div className="setup-wizard__task-copy">
                            <div className="config-pills">
                              {ORIENTATION_EXERCISE_ORDER.map((step) => (
                                <span
                                  key={step}
                                  className={
                                    orientationExercise.completedSteps.includes(step)
                                      ? 'is-complete'
                                      : orientationExercise.currentTargetStep === step
                                        ? 'is-target'
                                        : undefined
                                  }
                                >
                                  {orientationStepLabel(step)}
                                </span>
                              ))}
                            </div>

                            <ol className="switch-exercise-instructions">
                              {orientationExerciseInstructions.map((instruction) => (
                                <li key={instruction}>{instruction}</li>
                              ))}
                            </ol>
                          </div>

                          <div className="switch-exercise-progress" aria-hidden="true">
                            <div
                              className="switch-exercise-progress__fill"
                              style={{
                                width: `${
                                  orientationExercise.targetSteps.length > 0
                                    ? (orientationExercise.completedSteps.length / orientationExercise.targetSteps.length) * 100
                                    : 0
                                }%`
                              }}
                            />
                          </div>

                          <div className="setup-wizard__task-actions">
                            <button
                              className="setup-wizard__primary-button"
                              data-testid="wizard-orientation-primary"
                              style={buttonStyle(
                                orientationExercise.status === 'running' ||
                                  (!canRunOrientationExercise &&
                                    orientationExercise.status !== 'failed' &&
                                    orientationExercise.status !== 'passed')
                                  ? 'secondary'
                                  : 'hero'
                              )}
                              onClick={() =>
                                handleSetupFlowAction(
                                  guidedSetupTaskAction?.kind === 'orientation-exercise'
                                    ? guidedSetupTaskAction
                                    : { kind: 'orientation-exercise', label: 'Run Orientation Check' }
                                )
                              }
                              disabled={
                                orientationExercise.status === 'running' ||
                                (!canRunOrientationExercise &&
                                  orientationExercise.status !== 'failed' &&
                                  orientationExercise.status !== 'passed')
                              }
                            >
                              {orientationExercise.status === 'passed'
                                ? 'Run Orientation Check Again'
                                : orientationExercise.status === 'failed'
                                  ? 'Retry Orientation Check'
                                  : orientationExercise.status === 'running'
                                    ? 'Orientation Check Running'
                                    : 'Run Orientation Check'}
                            </button>
                            <div className="setup-wizard__secondary-actions">
                              <button
                                style={buttonStyle()}
                                onClick={handleResetOrientationExercise}
                                disabled={orientationExercise.status === 'idle'}
                              >
                                Reset Check
                              </button>
                              <button
                                style={buttonStyle('secondary')}
                                onClick={handleFailOrientationExercise}
                                disabled={orientationExercise.status !== 'running'}
                              >
                                Mark Failed
                              </button>
                              {/* "Open Orientation Check" button removed —
                               * the orientation card no longer lives in
                               * the Motors tab (moved fully to Setup),
                               * and the wizard's primary action button
                               * above is the same button. */}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {selectedSetupSection.id === 'outputs' ? (
                        <div
                          className={`setup-wizard__task-card setup-wizard__task-card--motor setup-wizard__task-card--${
                            motorVerification.status === 'passed'
                              ? 'success'
                              : motorVerification.status === 'failed'
                                ? 'danger'
                                : motorVerification.status === 'running'
                                  ? 'warning'
                                  : 'neutral'
                          }`}
                          data-testid="wizard-motor-task"
                        >
                          <div className="setup-wizard__task-header">
                            <div>
                              <strong>Motor Verification</strong>
                              <p>{motorVerificationSummary}</p>
                            </div>
                            <StatusBadge tone={toneForModeSwitchExercise(motorVerification.status)}>
                              {motorVerification.status}
                            </StatusBadge>
                          </div>

                          <div className="setup-wizard__task-copy">
                            <div className="config-pills">
                              {outputMapping.motorOutputs.map((output) => {
                                const verified = motorVerification.verifiedOutputs.includes(output.channelNumber)
                                const targeted = motorVerification.currentOutputChannel === output.channelNumber
                                return (
                                  <span
                                    key={output.paramId}
                                    className={verified ? 'is-complete' : targeted ? 'is-target' : undefined}
                                  >
                                    OUT{output.channelNumber}
                                    {output.motorNumber !== undefined ? ` / M${output.motorNumber}` : ''}
                                  </span>
                                )
                              })}
                            </div>

                            {motorVerification.status === 'running' ? (
                              <>
                                <div className="setup-wizard__task-focus">
                                  <span>Current target</span>
                                  <strong>{currentMotorVerificationLabel ?? 'Select an output'}</strong>
                                  <small>
                                    {currentMotorTestSucceeded
                                      ? 'Motor spin confirmed. If the correct motor spun in the correct direction, confirm it below.'
                                      : 'Run the guarded motor test for the current target, then confirm the correct motor and direction.'}
                                  </small>
                                </div>

                                <div className="setup-wizard__task-fields">
                                  <label className="scoped-editor-field scoped-editor-field--compact">
                                    <span>Throttle %</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={MAX_MOTOR_TEST_THROTTLE_PERCENT}
                                      step={1}
                                      value={motorTestThrottlePercent}
                                      onChange={(event) => setMotorTestThrottlePercent(Number(event.target.value))}
                                      disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                                    />
                                  </label>
                                  <label className="scoped-editor-field scoped-editor-field--compact">
                                    <span>Duration (s)</span>
                                    <input
                                      type="number"
                                      min={0.1}
                                      max={MAX_MOTOR_TEST_DURATION_SECONDS}
                                      step={0.1}
                                      value={motorTestDurationSeconds}
                                      onChange={(event) => setMotorTestDurationSeconds(Number(event.target.value))}
                                      disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                                    />
                                  </label>
                                </div>

                                <div className="motor-test-acknowledgments setup-wizard__task-acknowledgments">
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={propsRemovedAcknowledged}
                                      onChange={(event) => setPropsRemovedAcknowledged(event.target.checked)}
                                      disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                                    />
                                    <span>All propellers are removed.</span>
                                  </label>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={testAreaAcknowledged}
                                      onChange={(event) => setTestAreaAcknowledged(event.target.checked)}
                                      disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                                    />
                                    <span>The vehicle is restrained and the area is clear.</span>
                                  </label>
                                  {motorTestOverUsb ? (
                                    <label className="motor-test-acknowledgments__usb" data-testid="guided-motor-test-usb-ack">
                                      <input
                                        type="checkbox"
                                        checked={usbBenchAcknowledged}
                                        onChange={(event) => setUsbBenchAcknowledged(event.target.checked)}
                                        disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                                      />
                                      <span>USB connection detected — craft is on the bench, props off.</span>
                                    </label>
                                  ) : null}
                                </div>

                                <ul className="output-note-list">
                                  {guidedMotorTestGuardReasons.length > 0
                                    ? guidedMotorTestGuardReasons.map((reason) => <li key={reason}>{reason}</li>)
                                    : snapshot.motorTest.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                                </ul>
                              </>
                            ) : (
                              <p className="setup-wizard__task-note">
                                Start the guided motor verification and the wizard will walk output-by-output through controlled bench testing.
                              </p>
                            )}
                          </div>

                          <div className="switch-exercise-progress" aria-hidden="true">
                            <div
                              className="switch-exercise-progress__fill"
                              style={{
                                width: `${
                                  motorVerification.targetOutputs.length > 0
                                    ? (motorVerification.verifiedOutputs.length / motorVerification.targetOutputs.length) * 100
                                    : 0
                                }%`
                              }}
                            />
                          </div>

                          <div className="setup-wizard__task-actions">
                            <button
                              data-testid="wizard-motor-primary"
                              className={`setup-wizard__primary-button${currentMotorTestSucceeded ? ' guided-action-pulse' : ''}`}
                              style={buttonStyle(
                                motorVerification.status === 'running'
                                  ? currentMotorTestSucceeded
                                    ? 'hero'
                                    : canRunGuidedMotorTest
                                      ? 'hero'
                                      : 'secondary'
                                  : canRunMotorVerification
                                    ? 'hero'
                                    : 'secondary'
                              )}
                              onClick={() => {
                                if (motorVerification.status === 'running') {
                                  if (currentMotorTestSucceeded) {
                                    handleConfirmMotorVerification()
                                    return
                                  }
                                  void handleRunCurrentMotorVerificationTest()
                                  return
                                }
                                handleStartMotorVerification()
                              }}
                              disabled={
                                motorVerification.status === 'running'
                                  ? currentMotorTestSucceeded
                                    ? false
                                    : !canRunGuidedMotorTest
                                  : !canRunMotorVerification
                              }
                            >
                              {motorVerification.status === 'running'
                                ? currentMotorTestSucceeded
                                  ? `Confirm ${currentMotorVerificationLabel ?? 'Current Motor'}`
                                  : busyAction === 'motor-test'
                                    ? 'Running Targeted Motor Test…'
                                    : `Run Motor Test for ${currentMotorVerificationLabel ?? 'Current Output'}`
                                : motorVerification.status === 'passed'
                                  ? 'Run Motor Verification Again'
                                  : motorVerification.status === 'failed'
                                    ? 'Retry Motor Verification'
                                    : 'Start Motor Verification'}
                            </button>
                            <div className="setup-wizard__secondary-actions">
                              <button
                                style={buttonStyle()}
                                onClick={handleResetMotorVerification}
                                disabled={motorVerification.status === 'idle'}
                              >
                                Reset Verification
                              </button>
                              <button
                                style={buttonStyle('secondary')}
                                onClick={handleFailMotorVerification}
                                disabled={motorVerification.status !== 'running'}
                              >
                                Mark Failed
                              </button>
                              <button
                                style={buttonStyle()}
                                onClick={() =>
                                  scrollToPanel(
                                    selectedSetupSection.panelId,
                                    currentMotorTestSucceeded
                                      ? OUTPUTS_MOTOR_CONFIRM_BUTTON_ID
                                      : OUTPUTS_MOTOR_TEST_BUTTON_ID
                                  )
                                }
                              >
                                {currentMotorTestSucceeded
                                  ? 'Open Confirm Motor Direction'
                                  : 'Open Run Motor Test'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <SetupWizardDetail selectedSetupSection={selectedSetupSection} snapshot={snapshot} />

                      {['airframe', 'accelerometer', 'compass'].includes(selectedSetupSection.id)
                        ? renderAdditionalSettingsCard(
                            'Advanced setup settings',
                            'Board orientation, sensor, and related setup parameters stay attached to the guided flow when this step needs them.',
                            setupAdditionalGroups,
                            setupAdditionalDraftEntries,
                            setupAdditionalStagedDrafts,
                            setupAdditionalInvalidDrafts,
                            'setup:additional',
                            'Apply Setup Changes',
                            'advanced setup settings'
                          )
                        : null}
                    </div>

                    <SetupWizardAside
                      selectedSetupSection={selectedSetupSection}
                      previousSetupSection={previousSetupSection}
                      nextSetupSection={nextSetupSection}
                      continueButtonTargeted={continueButtonTargeted}
                      guidedSetupPrimaryAction={guidedSetupPrimaryAction}
                      guidedSetupContextAction={guidedSetupContextAction}
                      guidedSetupContextHint={guidedSetupContextHint}
                      guidedSetupSupportActions={guidedSetupSupportActions}
                      onAction={handleSetupFlowAction}
                      onMove={moveSetupWizard}
                    />
                  </div>
                </div>
                ) : null
              }
            />
	      ) : null}

	      {activeViewId === 'ports' ? (
        <PortsSection
          snapshot={snapshot}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          parameterNotice={parameterNotice}
          boardCatalogEntry={boardCatalogEntry}
          boardMediaAssets={boardMediaAssets}
          boardReferenceLinks={boardReferenceLinks}
          boardVariants={boardVariants}
          serialPortViewModels={serialPortViewModels}
          visibleSerialPortViewModels={visibleSerialPortViewModels}
          gpsPeripheralViewModels={gpsPeripheralViewModels}
          canNodePeripheralViewModels={canNodePeripheralViewModels}
          uartsMappedPortCount={uartsMappedPortCount}
          uartsStatusTone={uartsStatusTone}
          portVisibilitySummary={portVisibilitySummary}
          portsDraftEntries={portsDraftEntries}
          portsStagedDrafts={portsStagedDrafts}
          portsInvalidDrafts={portsInvalidDrafts}
          portsAdditionalGroups={portsAdditionalGroups}
          portsAdditionalDraftEntries={portsAdditionalDraftEntries}
          portsAdditionalStagedDrafts={portsAdditionalStagedDrafts}
          portsAdditionalInvalidDrafts={portsAdditionalInvalidDrafts}
          vtxLinkPorts={vtxLinkPorts}
          osdLinkPorts={osdLinkPorts}
          vtxEnabled={vtxEnabled}
          vtxFrequency={vtxFrequency}
          vtxPower={vtxPower}
          vtxMaxPower={vtxMaxPower}
          vtxEnableParameter={vtxEnableParameter}
          vtxFrequencyParameter={vtxFrequencyParameter}
          vtxPowerParameter={vtxPowerParameter}
          vtxMaxPowerParameter={vtxMaxPowerParameter}
          vtxOptionsParameter={vtxOptionsParameter}
          osdType={osdType}
          osdChannel={osdChannel}
          osdSwitchMethod={osdSwitchMethod}
          mspOptions={mspOptions}
          mspOsdCellCount={mspOsdCellCount}
          osdTypeParameter={osdTypeParameter}
          osdChannelParameter={osdChannelParameter}
          osdSwitchMethodParameter={osdSwitchMethodParameter}
          mspOptionsParameter={mspOptionsParameter}
          mspOsdCellCountParameter={mspOsdCellCountParameter}
          gpsAutoConfig={gpsAutoConfig}
          gpsAutoSwitch={gpsAutoSwitch}
          gpsPrimary={gpsPrimary}
          gpsRateMs={gpsRateMs}
          gpsAutoConfigParameter={gpsAutoConfigParameter}
          gpsAutoSwitchParameter={gpsAutoSwitchParameter}
          gpsPrimaryParameter={gpsPrimaryParameter}
          gpsRateParameter={gpsRateParameter}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          setDraft={setDraft}
          updateDrafts={updateDrafts}
          portsView={portsView}
          boardMediaPicker={boardMediaPicker}
          onApplyScopedDrafts={handleApplyScopedParameterDrafts}
          onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          setActiveViewId={setActiveViewId}
          renderAdditionalSettingsCard={renderAdditionalSettingsCard}
          runtime={runtime}
        />
	      ) : null}

        {activeViewId === 'vtx' ? (
          <VtxSection
            snapshot={snapshot}
            serialPortViewModels={serialPortViewModels}
            editedValues={editedValues}
            setDraft={setDraft}
            parameterDraftEntries={parameterDraftEntries}
            parameterDraftById={parameterDraftById}
            canApplyDraftParameters={canApplyDraftParameters}
            busyAction={busyAction}
            onApplyScopedDrafts={handleApplyScopedParameterDrafts}
            onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          />
        ) : null}

        {activeViewId === 'osd' ? (
          <OsdSection
            snapshot={snapshot}
            osdParameterById={osdParameterById}
            serialPortViewModels={serialPortViewModels}
            editedValues={editedValues}
            setDraft={setDraft}
            updateDrafts={updateDrafts}
            parameterDraftEntries={parameterDraftEntries}
            parameterDraftById={parameterDraftById}
            canApplyDraftParameters={canApplyDraftParameters}
            busyAction={busyAction}
            osdEditor={osdEditor}
            onApplyScopedDrafts={handleApplyScopedParameterDrafts}
            onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          />
        ) : null}

	      {(activeViewId === 'receiver' || activeViewId === 'modes' || activeViewId === 'power') ? (
      <section className={`grid ${activeViewId === 'receiver' || activeViewId === 'modes' || activeViewId === 'power' ? 'one-up' : 'two-up'}`}>
        {activeViewId === 'receiver' ? (
        <ReceiverSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          rcExercises={rcExercises}
          receiverChannelDisplays={receiverChannelDisplays}
          rcMappingDerivations={rcMappingDerivations}
          rcRangeDerivations={rcRangeDerivations}
          modeSwitchDerivations={modeSwitchDerivations}
          rcCalibrationDerivations={rcCalibrationDerivations}
          receiverTasks={receiverTasks}
          receiverSupportCatalog={receiverSupportCatalog}
          receiverAdditional={receiverAdditional}
          receiverDetailToggles={receiverDetailToggles}
          derived={{
            airframe,
            rcAxisObservations,
            currentRcAxisChannelMap,
            modeSwitchEstimate,
            modeExerciseAssignments,
            modeAssignments,
            modeSwitchExercise,
            modeSwitchActivity,
            recentModeSwitchChange,
            configuredModeChannel,
            rssiType,
            rssiChannel,
            rssiChannelLow,
            rssiChannelHigh,
            modeAssignmentParameters,
            receiverLinkPorts,
            receiverDraftEntries,
            receiverStagedDrafts,
            receiverInvalidDrafts,
            canRunRcMappingExercise,
            canRunRcRangeExercise,
            canCaptureRcCalibration,
            canRunModeSwitchExercise,
            receiverWorkflowDraftCount,
            receiverWorkflowInvalidCount,
            receiverAdvancedDraftCount,
            receiverAdvancedInvalidCount,
            receiverHasPendingReview
          }}
          handlers={{
            handleStartRcMappingExercise,
            handleConfirmRcMappingCandidate,
            handleStageRcMappingDrafts,
            handleResetRcMappingExercise,
            handleFailRcMappingExercise,
            handleStartRcRangeExercise,
            handleResetRcRangeExercise,
            handleFailRcRangeExercise,
            handleStartRcCalibrationCapture,
            handleResetRcCalibrationCapture,
            handleStageRcCalibrationDrafts,
            handleStartModeSwitchExercise,
            handleCompleteModeSwitchExercise,
            handleResetModeSwitchExercise,
            handleApplyScopedParameterDrafts,
            handleDiscardScopedParameterDrafts,
            renderAdditionalSettingsCard,
            setDraft,
            setReceiverTaskOverride
          }}
        />
        ) : null}

        {activeViewId === 'modes' ? (
        <ModesView
          modeChannelLabel={configuredModeChannel !== undefined ? `CH${configuredModeChannel}` : 'Not configured'}
          modeChannelParamName={snapshot.vehicle?.vehicle === 'ArduRover' ? 'MODE_CH' : 'FLTMODE_CH'}
          joystickModeNote={
            snapshot.vehicle?.vehicle === 'ArduSub'
              ? 'ArduSub selects modes via joystick button assignments (BTNn_FUNCTION), not an RC mode-switch channel — configure them in the Parameters view.'
              : undefined
          }
          currentSlotLabel={modeSwitchEstimate.estimatedSlot !== undefined ? `Slot ${modeSwitchEstimate.estimatedSlot}` : 'Waiting'}
          currentSlotSubtext={modeSwitchEstimate.pwm !== undefined ? `${modeSwitchEstimate.pwm} us live` : 'No live RC input.'}
          activeModeLabel={snapshot.vehicle?.flightMode ?? 'Unknown'}
          slots={MODES_SLOT_DEFINITIONS.map((slot) => {
            const paramId = modeSlotParamId(snapshot.vehicle?.vehicle, slot.position)
            const paramValue = readRoundedParameter(snapshot, paramId)
            const parameter = selectParameterById(snapshot, paramId)
            return {
              position: slot.position,
              pwmLabel: slot.pwmLabel,
              modeLabel: formatModeAssignment(paramValue, snapshot.vehicle?.vehicle),
              paramSynced: paramValue !== undefined,
              isActive: modeSwitchEstimate.estimatedSlot === slot.position,
              parameter
            }
          })}
          editedValues={editedValues}
          draftStatusById={parameterDraftById}
          onChangeSlot={(paramId, value) => setDraft(paramId, value)}
          onOpenFlightModeTask={() => {
            setActiveViewId('receiver')
            setReceiverTaskOverride('flight-modes')
          }}
        />
        ) : null}

        {activeViewId === 'power' ? (
        <PowerView
          isBatteryVerified={snapshot.liveVerification.batteryTelemetry.verified}
          batteryHealthLabel={batteryHealthLabel(snapshot)}
          batteryHealthTone={batteryHealthTone(snapshot)}
          parameterNotice={parameterNotice ? { tone: parameterNotice.tone, toneLabel: parameterNotice.tone, text: parameterNotice.text } : null}
          liveMetrics={{
            voltageText: formatVoltage(snapshot.liveVerification.batteryTelemetry.voltageV),
            currentText: formatCurrent(snapshot.liveVerification.batteryTelemetry.currentA),
            remainingText: formatRemaining(snapshot.liveVerification.batteryTelemetry.remainingPercent),
            capacityText: batteryCapacity !== undefined ? `${batteryCapacity} mAh` : 'Unknown'
          }}
          configPills={{
            monitor: describeBatteryMonitor(batteryMonitor)
          }}
          fields={([
            batteryMonitorParameter ? { parameter: batteryMonitorParameter, liveValue: batteryMonitor, kind: 'select' } : null,
            batteryCapacityParameter ? { parameter: batteryCapacityParameter, liveValue: batteryCapacity, kind: 'number' } : null,
            batteryArmVoltageParameter ? { parameter: batteryArmVoltageParameter, liveValue: batteryArmVoltage, kind: 'number', stepFallback: 0.1 } : null,
            batteryArmMahParameter ? { parameter: batteryArmMahParameter, liveValue: batteryArmMah, kind: 'number' } : null
            // Every failsafe-shaped knob (BATT_FS_*, FS_THR_*, BATT_LOW_*,
            // BATT_CRT_*) now lives exclusively on the Failsafe tab so the
            // operator has ONE place to think about loss-of-link behavior.
            // Power is just the battery-monitor / capacity / arming setup.
          ] as Array<PowerFieldSpec | null>).filter((field): field is PowerFieldSpec => field !== null)}
          editedValues={editedValues}
          onEditChange={(paramId, value) =>
            setDraft(paramId, value)
          }
          draftStatusById={parameterDraftById}
          scopedReviewStatusLabel={
            powerInvalidDrafts.length > 0
              ? `${powerInvalidDrafts.length} invalid`
              : powerStagedDrafts.length > 0
                ? `${powerStagedDrafts.length} staged`
                : 'in sync'
          }
          scopedReviewTone={toneForScopedDraftReview(powerStagedDrafts.length, powerInvalidDrafts.length)}
          draftItems={powerDraftEntries.map((draft): PowerDraftItem => ({
            id: draft.id,
            label: draft.label,
            status: draft.status,
            badgeTone: toneForParameterDraftStatus(draft.status),
            summary: draft.status === 'staged'
              ? `Current ${formatParameterDraftValue(draft.definition, draft.currentValue)} → New ${formatParameterDraftValue(draft.definition, draft.nextValue)}`
              : draft.reason ?? 'Draft matches the live controller value.'
          }))}
          stagedCount={powerStagedDrafts.length}
          draftCount={powerDraftEntries.length}
          invalidCount={powerInvalidDrafts.length}
          canApply={canApplyDraftParameters}
          isApplying={busyAction === 'power:apply'}
          isBusy={busyAction !== undefined}
          onApply={() => void handleApplyScopedParameterDrafts(powerDraftEntries, 'power:apply', 'Power & failsafe')}
          onDiscard={() => handleDiscardScopedParameterDrafts(powerDraftEntries.map((entry) => entry.id), 'power')}
          additionalSettingsSlot={renderAdditionalSettingsCard(
            'Additional battery settings',
            'Metadata-backed battery-monitor knobs that extend this view. Failsafe-shaped knobs live exclusively on the Failsafe tab.',
            powerAdditionalGroups,
            powerAdditionalDraftEntries,
            powerAdditionalStagedDrafts,
            powerAdditionalInvalidDrafts,
            'power:additional',
            'Apply Additional Battery Changes',
            'additional battery settings'
          )}
          preArmIssues={activePreArmIssues.map((issue) => issue.text)}
        />
        ) : null}
      </section>
      ) : null}

      {activeViewId === 'failsafe' ? (
        <FailsafeSection
          snapshot={snapshot}
          throttleFailsafe={throttleFailsafe}
          throttleFailsafeValue={throttleFailsafeValue}
          batteryFailsafe={batteryFailsafe}
          batteryCriticalFailsafe={batteryCriticalFailsafe}
          batteryLowVoltage={batteryLowVoltage}
          batteryCriticalVoltage={batteryCriticalVoltage}
          editedValues={editedValues}
          setDraft={setDraft}
          parameterDraftEntries={parameterDraftEntries}
          parameterDraftById={parameterDraftById}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          onApplyScopedDrafts={handleApplyScopedParameterDrafts}
          onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          onOpenPower={() => setActiveViewId('power')}
          failsafeAdditionalGroups={failsafeAdditionalGroups}
          failsafeAdditionalDraftEntries={failsafeAdditionalDraftEntries}
          failsafeAdditionalStagedDrafts={failsafeAdditionalStagedDrafts}
          failsafeAdditionalInvalidDrafts={failsafeAdditionalInvalidDrafts}
          renderAdditionalSettingsCard={renderAdditionalSettingsCard}
        />
      ) : null}

      {activeViewId === 'logs' ? (
        <LogsSection
          snapshot={snapshot}
          editedValues={editedValues}
          setDraft={setDraft}
          updateDrafts={updateDrafts}
          parameterDraftEntries={parameterDraftEntries}
          parameterDraftById={parameterDraftById}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          onApplyScopedDrafts={handleApplyScopedParameterDrafts}
          onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          onboardLogs={onboardLogs}
        />
      ) : null}

      {(activeViewId === 'motors' || activeViewId === 'servos') ? (
      <OutputsSection
        activeViewId={activeViewId}
        snapshot={snapshot}
        canApplyDraftParameters={canApplyDraftParameters}
        busyAction={busyAction}
        motorTestMaxDurationSeconds={
          productMode === 'expert'
            ? EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS
            : MAX_MOTOR_TEST_DURATION_SECONDS
        }
        editedValues={editedValues}
        parameterDraftById={parameterDraftById}
        motorOutputAssignments={motorOutputAssignments}
        outputAssignmentVisibility={outputAssignmentVisibility}
        outputNotificationCatalog={outputNotificationCatalog}
        motorTestConfig={motorTestConfig}
        motorManagement={motorManagement}
        safetyAcks={safetyAcks}
        derived={{
          airframe,
          outputMapping,
          escSetup,
          vehicleOutputSummary,
          motorPreviewNodes,
          motorPreviewCount,
          motorPreviewGeometryMode,
          motorTestEligibility,
          isCopterVehicle,
          configuredOutputs,
          visibleDisabledOutputs,
          notificationLedOutputs,
          frameConfigEditable,
          frameClassParameter,
          frameTypeParameter,
          frameDraftEntries,
          frameStagedDrafts,
          frameInvalidDrafts,
          escReviewConfirmation,
          escReviewSummary,
          motorMixerSummary,
          motorDirectionSummary,
          currentMotorTestSucceeded,
          currentMotorVerificationLabel,
          selectedMotorTestOutputLabel,
          selectedMotorTestOutputMotorNumber,
          motorTestSliderTargets,
          motorTestGuardReasons,
          motorTestOverUsb,
          canRunMotorTest,
          canRunMotorVerification,
          outputReviewParameters,
          outputAssignmentParameters,
          showAllOutputAssignments,
          outputAssignmentReviewLabel,
          servoMappingRows,
          notificationLedTypes,
          notificationLedBrightness,
          notificationLedLength,
          notificationLedOverride,
          notificationBuzzTypes,
          notificationBuzzVolume,
          editedNotificationLedTypes,
          editedNotificationBuzzTypes,
          outputAssignmentDraftEntries,
          outputAssignmentStagedDrafts,
          outputAssignmentInvalidDrafts,
          outputReviewDraftEntries,
          outputReviewStagedDrafts,
          outputReviewInvalidDrafts,
          outputNotificationDraftEntries,
          outputNotificationStagedDrafts,
          outputNotificationInvalidDrafts,
          outputAdditionalGroups,
          outputAdditionalDraftEntries,
          outputAdditionalStagedDrafts,
          outputAdditionalInvalidDrafts,
          outputReviewDraftSummaries,
          outputPeripheralStagedDraftCount,
          outputPeripheralInvalidDraftCount,
          totalOutputStagedDrafts,
          totalOutputInvalidDrafts,
          outputHasPendingReview,
          outputTaskCards,
          activeOutputTaskId,
          activeOutputTask
        }}
        handlers={{
          handleApplyScopedParameterDrafts,
          handleDiscardScopedParameterDrafts,
          handleOpenMotorReorderDialog,
          handleRunMotorTest,
          handleStopMotorTest,
          handleStartMotorVerification,
          handleConfirmMotorVerification,
          handleFailMotorVerification,
          handleResetMotorVerification,
          confirmSetupSection,
          clearSetupSectionConfirmation,
          renderMetadataParameterField,
          renderAdditionalSettingsCard,
          setDraft,
          updateDrafts,
          setShowAllOutputAssignments,
          setOutputTaskOverride
        }}
      />
      ) : null}

      {activeViewId === 'snapshots' ? (
        <SnapshotsSection
          snapshot={snapshot}
          desktopBridge={desktopBridge}
          desktopSnapshotLibraryPath={desktopSnapshotLibraryPath}
          desktopSnapshotLibraryName={desktopSnapshotLibraryName}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          parameterFollowUp={parameterFollowUp}
          isExpertMode={isExpertMode}
          snapshotNotice={snapshotNotice}
          provisioningNotice={provisioningNotice}
          formatCategoryLabel={formatCategoryLabel}
          libraries={libraries}
          forms={libraryForms}
          safetyAcks={safetyAcks}
          refs={{ snapshotImportInputRef, provisioningImportInputRef }}
          derived={{
            selectedSnapshot,
            selectedSnapshotRestore,
            selectedSnapshotDiffEntries,
            selectedSnapshotDiffGroups,
            selectedSnapshotChangedEntries,
            selectedSnapshotInvalidEntries,
            selectedSnapshotRebootSensitiveCount,
            stagedProvisioningOverlayParameters,
            selectedProvisioningProfile,
            selectedProvisioningProfileRestore,
            selectedProvisioningProfileDiffEntries,
            selectedProvisioningProfileDiffGroups,
            selectedProvisioningProfileChangedEntries,
            selectedProvisioningProfileInvalidEntries
          }}
          handlers={{
            handleApplySelectedProvisioningProfile,
            handleApplySelectedSnapshotRestore,
            handleApplySnapshotEntry: (entry) =>
              handleApplyScopedParameterDrafts(
                [entry],
                'snapshots:apply',
                `Snapshot restore (single): ${entry.id}`
              ),
            handleCaptureLiveSnapshot,
            handleCreateProvisioningProfile,
            handleDeleteSelectedProvisioningProfile,
            handleDeleteSelectedSnapshot,
            handleExportProvisioningLibrary,
            handleExportSelectedProvisioningProfile,
            handleExportSelectedSnapshot,
            handleExportSelectedSnapshotToDesktop,
            handleExportSnapshotLibrary,
            handleImportProvisioningLibrary,
            handleImportSnapshotFile,
            handleOpenDesktopSnapshotFile,
            handleOpenProvisioningImport,
            handleOpenSnapshotImport,
            handleSaveDesktopSnapshotLibrary,
            handleStageSelectedProvisioningProfileDiff,
            handleStageSelectedSnapshotDiff,
            handleToggleSelectedProvisioningProfileProtection,
            handleToggleSelectedSnapshotProtection
          }}
          snapshotCompareBaselineId={snapshotCompareBaselineId}
          onSnapshotCompareBaselineIdChange={setSnapshotCompareBaselineId}
        />
      ) : null}

      {activeViewId === 'tuning' && isPlaneVehicle ? (
        <TuningPlaneSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          planeTuningDraftEntries={planeTuningDraftEntries}
          planeTuningStagedDrafts={planeTuningStagedDrafts}
          planeTuningInvalidDrafts={planeTuningInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {/* ArduPlane soaring + ADS-B curated surface. Placed in the Tuning view
          right after the plane tuning surface (lowest-risk: reuses the existing
          per-vehicle Tuning slot and the same scoped-draft plumbing, no
          view-system change). Each group self-gates on its enable param, so a
          non-soaring / no-transponder plane just shows the two toggles. */}
      {activeViewId === 'tuning' && isPlaneVehicle ? (
        <PlaneSoaringAdsbSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          planeSoaringAdsbDraftEntries={planeSoaringAdsbDraftEntries}
          planeSoaringAdsbStagedDrafts={planeSoaringAdsbStagedDrafts}
          planeSoaringAdsbInvalidDrafts={planeSoaringAdsbInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {/* ArduPlane AUTOTUNE curated surface (fixed-wing + QuadPlane). Placed in
          the Tuning view after the plane tuning + soaring/ADS-B surfaces, reusing
          the same per-vehicle Tuning slot and scoped-draft plumbing. The VTOL
          group self-gates on Q_ENABLE, so a pure fixed-wing plane shows only the
          fixed-wing AUTOTUNE_LEVEL / AUTOTUNE_OPTIONS controls + procedure. */}
      {activeViewId === 'tuning' && isPlaneVehicle ? (
        <AutotunePlaneSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          planeAutotuneDraftEntries={planeAutotuneDraftEntries}
          planeAutotuneStagedDrafts={planeAutotuneStagedDrafts}
          planeAutotuneInvalidDrafts={planeAutotuneInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {activeViewId === 'tuning' && isRoverVehicle ? (
        <TuningRoverSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          roverTuningDraftEntries={roverTuningDraftEntries}
          roverTuningStagedDrafts={roverTuningStagedDrafts}
          roverTuningInvalidDrafts={roverTuningInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {activeViewId === 'tuning' && isSubVehicle ? (
        <TuningSubSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          subTuningDraftEntries={subTuningDraftEntries}
          subTuningStagedDrafts={subTuningStagedDrafts}
          subTuningInvalidDrafts={subTuningInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {/* ArduCopter / Plane / Rover / Sub each have a curated Tuning surface
          above. This note only renders for the residual 'Unknown'/undetected
          vehicle case — there is no known vehicle that reaches it. */}
      {activeViewId === 'tuning' && !isCopterVehicle && !isPlaneVehicle && !isRoverVehicle && !isSubVehicle ? (
      <section className="bf-gui-box" data-testid="tuning-noncopter-note">
        <div className="bf-gui-box__titlebar">
          <strong>Tuning</strong>
        </div>
        <div className="bf-gui-box__body">
          <p className="bf-note">
            The master-slider / PID-scaling tuning workspace is a multirotor-specific
            procedure. {airframe.frameClassLabel} tuning gains are exposed in the
            {' '}{airframe.frameClassLabel} parameter catalog under their Tuning
            categories — edit them from the Parameters view until a
            {' '}{airframe.frameClassLabel}-specific tuning surface lands.
          </p>
        </div>
      </section>
      ) : null}

      {activeViewId === 'tuning' && isCopterVehicle ? (
        <TuningCopterSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          parameterNotice={parameterNotice}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          tuningWorkbench={tuningWorkbench}
          forms={libraryForms}
          derived={{
            airframe,
            activeTuningTaskId,
            activeTuningTask,
            tuningTaskCards,
            flightFeelParameters,
            acroTuningParameters,
            tuningAccelerationParameters,
            tuningPidAxisGroups,
            tuningAdvancedPidParameters,
            tuningAdvancedPidAxisGroups,
            tuningFilterParameters,
            tuningFilterAxisGroups,
            tuningMasterPreviewEntries,
            tuningMasterDefaultsActive,
            tuningProfileSourceUsesStaged,
            canCreateTuningProfile,
            savedTuningProfiles,
            selectedTuningProfileId,
            selectedTuningProfile,
            selectedTuningProfileRestore,
            selectedTuningProfileDiffEntries,
            selectedTuningProfileDiffGroups,
            selectedTuningProfileChangedEntries,
            selectedTuningProfileInvalidEntries,
            tuningDraftEntries,
            tuningStagedDrafts,
            tuningInvalidDrafts,
            tuningRateStagedDrafts,
            tuningRateInvalidDrafts,
            tuningPidStagedDrafts,
            tuningPidInvalidDrafts,
            tuningFilterStagedDrafts,
            tuningFilterInvalidDrafts,
            tuningProfileNotice,
            tuningProfileStorageNotice
          }}
          handlers={{
            handleApplyScopedParameterDrafts,
            handleDiscardScopedParameterDrafts,
            handleStageTuningMasterAdjustments,
            handleResetTuningMasterSliders,
            handleStageSelectedTuningProfile,
            handleCreateTuningProfile,
            handleDeleteSelectedTuningProfile,
            handleToggleSelectedTuningProfileProtection,
            setSelectedTuningProfileId,
            renderTuningControl,
            formatCategoryLabel
          }}
        />
      ) : null}

      {/* ArduCopter AUTOTUNE curated surface. Rendered as a SIBLING right after
          TuningCopterSection (NOT inside it) — lowest risk: the large Copter
          tuning workbench is untouched, and this section uses its own disjoint
          AUTOTUNE_* scoped-draft scope so applying here never affects the ATC_*
          tuning batch. Returns null if the FC streams no AUTOTUNE_ params. */}
      {activeViewId === 'tuning' && isCopterVehicle ? (
        <AutotuneCopterSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          editedValues={editedValues}
          parameterDraftById={parameterDraftById}
          copterAutotuneDraftEntries={copterAutotuneDraftEntries}
          copterAutotuneStagedDrafts={copterAutotuneStagedDrafts}
          copterAutotuneInvalidDrafts={copterAutotuneInvalidDrafts}
          setDraft={setDraft}
          handleApplyScopedParameterDrafts={handleApplyScopedParameterDrafts}
          handleDiscardScopedParameterDrafts={handleDiscardScopedParameterDrafts}
        />
      ) : null}

      {activeViewId === 'presets' ? (
        <PresetsSection
          snapshot={snapshot}
          metadataCatalog={metadataCatalog}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          parameterFollowUp={parameterFollowUp}
          presetNotice={presetNotice}
          presetDefinitions={presetDefinitions}
          presetGroups={presetGroups}
          presetPreviewById={presetPreviewById}
          selectedPreset={selectedPreset}
          selectedPresetDiff={selectedPresetDiff}
          selectedPresetApplicability={selectedPresetApplicability}
          selectedPresetDiffGroups={selectedPresetDiffGroups}
          selectedPresetChangedEntries={selectedPresetChangedEntries}
          selectedPresetInvalidEntries={selectedPresetInvalidEntries}
          savedSnapshots={savedSnapshots}
          presetApplyAcknowledged={presetApplyAcknowledged}
          setPresetApplyAcknowledged={setPresetApplyAcknowledged}
          setSelectedPresetId={setSelectedPresetId}
          runtime={runtime}
          formatCategoryLabel={formatCategoryLabel}
          onApplySelectedPreset={handleApplySelectedPreset}
          onStageSelectedPresetDiff={handleStageSelectedPresetDiff}
          onEraseSettings={handleEraseSettings}
        />
      ) : null}

      {activeViewId === 'rc-mixer' ? (
      <RcMixerView
        channels={rcMixerChannels}
        functionCatalog={RC_MIXER_FUNCTION_CATALOG}
        functionLookup={rcMixerFunctionLookup}
        livePwmByChannel={rcMixerLivePwmByChannel}
        rcLinkLive={snapshot.liveVerification.rcInput.verified}
        onAddAssignment={handleRcMixerAddAssignment}
        onRemoveAssignment={handleRcMixerRemoveAssignment}
        onUpdateAssignment={handleRcMixerUpdateAssignment}
      />
      ) : null}

      {activeViewId === 'can' ? (
      <CanBusView
        state={snapshot.canBus}
        vehicleConnected={snapshot.connection.kind === 'connected'}
        onStartForward={(bus) => { void runtime?.startCanBusForward(bus) }}
        onStopForward={() => { void runtime?.stopCanBusForward() }}
        onRefreshNode={(nodeId) => { runtime?.refreshCanBusNode(nodeId) }}
        onFetchAllParameters={(nodeId) => { runtime?.fetchAllCanBusParameters(nodeId) }}
        onApplyAndSave={(nodeId, writes) => { void runtime?.applyAndSaveCanBusParameters(nodeId, writes) }}
      />
      ) : null}

      {activeViewId === 'flash' ? (
        <FirmwareFlasher
          onEnterDfu={
            // Reboot to bootloader / DFU. Only wire when we have a live
            // MAVLink link — otherwise the flasher's wizard works fine
            // without it.
            runtime && snapshot.connection.kind === 'connected'
              ? async () => { await runtime.rebootToBootloader() }
              : undefined
          }
          enterDfuDisabledReason={
            snapshot.connection.kind !== 'connected'
              ? 'Connect to a vehicle first to send a DFU reboot command.'
              : snapshot.vehicle?.armed
                ? 'Disarm the vehicle before requesting a DFU reboot.'
                : undefined
          }
          onReboot={
            runtime && snapshot.connection.kind === 'connected'
              ? async () => { await runtime.reboot() }
              : undefined
          }
          rebootDisabledReason={
            snapshot.connection.kind !== 'connected'
              ? 'Connect to a vehicle first to request a reboot.'
              : snapshot.vehicle?.armed
                ? 'Disarm the vehicle before requesting a reboot.'
                : undefined
          }
          connectedVehicle={snapshot.vehicle?.vehicle}
        />
      ) : null}

      {activeViewId === 'files' ? (
        <FilesView
          path={filesBrowser.path}
          entries={filesBrowser.entries}
          loading={filesBrowser.loading}
          error={filesBrowser.error}
          busyAction={busyAction}
          vehicleConnected={snapshot.connection.kind === 'connected'}
          onNavigate={filesBrowser.navigate}
          onRefresh={filesBrowser.refresh}
          onDownload={filesBrowser.download}
          onUpload={filesBrowser.upload}
          onDelete={filesBrowser.remove}
        />
      ) : null}

      {activeViewId === 'calibration' ? (
        <CalibrationSection
          snapshot={snapshot}
          runtime={runtime}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          airframe={airframe}
          isCopterVehicle={isCopterVehicle}
          uiParameterWriteOptions={UI_PARAMETER_WRITE_OPTIONS}
          editedValues={editedValues}
          calibrationNotices={calibrationNotices}
          safetyAcks={safetyAcks}
          setDraft={setDraft}
          clearDraft={clearDraft}
          setParameterNotice={setParameterNotice}
          handleGuidedAction={handleGuidedAction}
          handleCancelGuidedAction={handleCancelGuidedAction}
        />
      ) : null}

      {activeViewId === 'config' ? (
        <ConfigView
          sections={configSections.map((section) =>
            section.id === 'esc-dshot' ? { ...section, footer: renderEscDshotFooter() } : section
          )}
          parametersById={configParametersById}
          editedValues={editedValues}
          onEditChange={(paramId, value) => setDraft(paramId, value)}
          draftStatusById={parameterDraftById}
          stagedCount={configStagedDrafts.length}
          invalidCount={configInvalidDrafts.length}
          draftCount={configDraftEntries.length}
          canApply={canApplyDraftParameters}
          isApplying={busyAction === 'config:apply'}
          isBusy={busyAction !== undefined}
          onApply={() => void handleApplyScopedParameterDrafts(configDraftEntries, 'config:apply', 'Configuration')}
          onRevert={() => handleDiscardScopedParameterDrafts(configDraftEntries.map((entry) => entry.id), 'configuration')}
        />
      ) : null}

      {activeViewId === 'parameters' ? (
        <ParametersSection
          snapshot={snapshot}
          metadataCatalog={metadataCatalog}
          canApplyDraftParameters={canApplyDraftParameters}
          canApplyAllDraftParameters={canApplyAllDraftParameters}
          busyAction={busyAction}
          applyAllBusyLabel={applyAllBusyLabel}
          editedValues={editedValues}
          parameterNotice={parameterNotice}
          parameterFollowUp={parameterFollowUp}
          formatCategoryLabel={formatCategoryLabel}
          parameterSearch={parameterSearch}
          setParameterSearch={setParameterSearch}
          selectedParameterId={selectedParameterId}
          setSelectedParameterId={setSelectedParameterId}
          filteredParameters={filteredParameters}
          parameterDraftSummary={parameterDraftSummary}
          parameterDraftById={parameterDraftById}
          stagedParameterGroups={stagedParameterGroups}
          invalidParameterGroups={invalidParameterGroups}
          rebootRequiredDrafts={rebootRequiredDrafts}
          stagedParameterDrafts={stagedParameterDrafts}
          parameterBackupInputRef={parameterBackupInputRef}
          setDraft={setDraft}
          onApplyAllParameterDrafts={handleApplyAllParameterDrafts}
          onDiscardAllParameterDrafts={handleDiscardAllParameterDrafts}
          onApplyParameterDraft={handleApplyParameterDraft}
          onDiscardParameterDraft={handleDiscardParameterDraft}
          onOpenParameterBackup={handleOpenParameterBackup}
          parameterImportExclusions={parameterImportExclusions}
          onToggleParameterImportExclusion={(category) =>
            setParameterImportExclusions((current) => ({
              ...current,
              [category]: !current[category]
            }))
          }
          onExportParameterBackup={handleExportParameterBackup}
          onExportParameterBackupAsParm={handleExportParameterBackupAsParm}
          onExportParameterBackupAsParams={handleExportParameterBackupAsParams}
          onImportParameterBackup={handleImportParameterBackup}
          onRefreshParameters={() => handleGuidedAction('request-parameters')}
          refreshDisabled={busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')}
          parameterEnumOverrides={parameterEnumOverrides}
          onToggleParameterEnumOverride={handleToggleParameterEnumOverride}
        />
      ) : null}
        </div>
      </div>

      {motorReorderDialogOpen ? (
        <MotorReorderDialog
          snapshot={snapshot}
          airframe={airframe}
          busyAction={busyAction}
          editedValues={editedValues}
          motorDialogTab={motorDialogTab}
          motorDialogSpinError={motorDialogSpinError}
          propsRemovedAcknowledged={propsRemovedAcknowledged}
          testAreaAcknowledged={testAreaAcknowledged}
          motorPreviewNodes={motorPreviewNodes}
          motorPreviewGeometryMode={motorPreviewGeometryMode}
          effectiveMotorOutputs={effectiveMotorOutputs}
          motorReorderRows={motorReorderRows}
          motorReorderSelections={motorReorderSelections}
          motorReorderDuplicateChannels={motorReorderDuplicateChannels}
          motorReorderCanStage={motorReorderCanStage}
          motorReorderChangedCount={motorReorderChangedCount}
          guidedReorderActive={guidedReorderActive}
          guidedReorderStep={guidedReorderStep}
          guidedReorderMapping={guidedReorderMapping}
          guidedReorderAwaitingSpin={guidedReorderAwaitingSpin}
          guidedReorderCompleted={guidedReorderCompleted}
          onClose={handleCloseMotorReorderDialog}
          onTabChange={setMotorDialogTab}
          onPropsRemovedChange={setPropsRemovedAcknowledged}
          onTestAreaChange={setTestAreaAcknowledged}
          onSelectionChange={(motorNumber, value) =>
            setMotorReorderSelections((current) => ({ ...current, [String(motorNumber)]: value }))
          }
          onStartGuidedReorder={handleStartGuidedReorder}
          onCancelGuidedReorder={handleCancelGuidedReorder}
          onSpinGuidedReorderCurrent={handleSpinGuidedReorderCurrent}
          onPickGuidedReorderPosition={handlePickGuidedReorderPosition}
          onStageReorderDrafts={handleStageMotorReorderDrafts}
          onSpinSingleMotor={handleDialogSpinSingleMotor}
          setDraft={setDraft}
          motorReorderStagedCount={motorReorderDialogStagedDrafts.length}
          canApplyMotorDrafts={canApplyDraftParameters}
          rebootRecommended={parameterFollowUp?.requiresReboot ?? false}
          onApplyMotorDrafts={() =>
            void handleApplyScopedParameterDrafts(motorReorderDialogStagedDrafts, 'motor-reorder:apply', 'Motor setup')
          }
          onRebootAutopilot={() => void handleGuidedAction('reboot-autopilot')}
        />
      ) : null}

      {selectedBoardMedia ? (
        <div className="board-media-lightbox" role="dialog" aria-modal="true" onClick={() => setSelectedBoardMedia(undefined)}>
          <div className="board-media-lightbox__frame" onClick={(event) => event.stopPropagation()}>
            <div className="board-media-lightbox__header">
              <div>
                <strong>{selectedBoardMedia.label}</strong>
                <p>{selectedBoardMedia.description}</p>
              </div>
              <button type="button" style={buttonStyle()} onClick={() => setSelectedBoardMedia(undefined)}>
                Close
              </button>
            </div>
            <img src={assetUrl(selectedBoardMedia.assetPath)} alt={selectedBoardMedia.alt} />
          </div>
        </div>
      ) : null}

      <footer className="app-status-bar">
        <span className={`app-status-bar__item ${snapshot.connection.kind === 'connected' ? 'is-ok' : ''}`}>
          <span className="dot" />
          {snapshot.connection.kind}
        </span>
        <span className="app-status-bar__item">
          {snapshot.vehicle?.vehicle ?? '—'}
        </span>
        <span className="app-status-bar__item">
          {snapshot.parameterStats.status === 'complete'
            ? `${snapshot.parameterStats.downloaded} params synced`
            : formatParameterSync(snapshot)}
        </span>
        {snapshot.preArmStatus.healthy
          ? <span className="app-status-bar__item is-ok"><span className="dot" />Pre-arm clear</span>
          : <span className="app-status-bar__item is-warn"><span className="dot" />{snapshot.preArmStatus.issues.length} pre-arm issues</span>}
        <span className="app-status-bar__spacer" />
        <span className="app-status-bar__item">
          {missionTitleForView(activeViewId)}
        </span>
      </footer>
    </main>
    </>
  )
}
