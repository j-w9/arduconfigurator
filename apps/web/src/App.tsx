import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  applyArducopter47CatalogOverrides,
  applySfdValtCatalogOverrides,
  detectSfdValtMode,
  type ParameterBackupFile,
  type ParameterBackupImportOptions,
  type ParameterBatchWriteProgress,
  type ParameterBatchWriteResult,
  type ParameterDraftEntry,
  type ParameterImportCategory,
  type ParameterState,
  type ParameterUnconfirmedWrite,
  type ParameterWriteRequest,
  type RcAxisId,
  type RcMappingCandidate,
  LEGACY_PARAM_ALIASES,
} from '@arduconfig/ardupilot-core'
import {
  arducopterMetadata,
  arduplaneMetadata,
  arduroverMetadata,
  ardusubMetadata,
  findBoardCatalogEntry,
  normalizeFirmwareMetadata,
  mergeUpstreamParameters,
  AHRS_ORIENTATION_OPTIONS,
  type AppViewId,
  type UpstreamParameterMap,
} from '@arduconfig/param-metadata'
import { loadUpstreamParameters } from './generated/param-upstream'
import {
  WebSerialTransport,
  getAvailableWebSerialPorts,
  getWebSerialNavigator,
  getWebSerialPortInfo,
  type WebSerialPortLike,
} from '@arduconfig/transport'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { describeConnectionError } from './connection-error-help'
import { getDesktopBridge } from './desktop-bridge'
import { createRuntime } from './runtime-factory'
import { attemptSerialPortReconnect } from './serial-reconnect'
import { useOsdEditor } from './hooks/use-osd-editor'
import { useRcMixer } from './hooks/use-rc-mixer'
import { useVtxTable } from './hooks/use-vtx-table'
import { useOsdShorthand } from './hooks/use-osd-shorthand'
import { useCalibrationNotices } from './hooks/use-calibration-notices'
import { useLibraryNotices } from './hooks/use-library-notices'
import { useSafetyAcks } from './hooks/use-safety-acks'
import { useTheme } from './hooks/use-theme'
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
import { buildRcChannelDisplays, derivePrimaryStickChannels } from './rc-channel-helpers'
import {
  connectButtonLabel,
  describeConnectFailure,
  isStaleSerialHandleError,
  describeRememberedSerialPort
} from './connection-helpers'
import { detectMavlinkPort } from './serial-autodetect'
import { canApplyParameterChanges, parameterApplyBlockedReason } from './apply-gate'
import { ALL_MOTOR_TEST_OUTPUT, ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS, buildMotorTestRequest } from './motor-test-helpers'
import { canUseGuidedSetupTestingShortcut, isExpertOnlyView, readGuidedSetupShortcutSectionId } from './guided-setup-shortcut'
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
  RC_CALIBRATION_SWITCH_CHANNELS,
  RC_SWITCH_LOW_PWM,
  RC_SWITCH_HIGH_PWM,
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
import { selectEntityDiff } from './selectors/entity-diff'
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
  clearStoredSetupProgress,
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
import { AP_PERIPH_PARAM_METADATA } from './view-models/ap-periph-param-metadata'
import { parseParamPck } from './view-models/param-pck'
import { stageableDraftValues } from './view-models/parameter-diff-actions'
import { createMotorPreviewNodes } from './view-models/motor-preview'
import { deriveCanEnablement } from './view-models/can-enablement'
import { deriveBoardOrientationVisual } from './view-models/board-orientation-visual'
import { BoardOrientationDiagram } from './views/BoardOrientationDiagram'
import { buildRecentNotices } from './view-models/recent-notices'
import { deriveExternalChannelClaims, deriveRcLogicChannelClaims } from './view-models/channel-usage'
import { orderDraftsByEnableGate } from './view-models/enable-gate-write-order'
import { decidePostWriteResync } from './view-models/post-write-resync'
import { deriveVtxPowerLevels } from './view-models/vtx-power-levels'
import { invertGuidedReorderMapping } from './view-models/motor-reorder-mapping'
import { planGuidedIdentifyAdvance } from './view-models/guided-identify-advance'
import { LiveGpsMapCard } from './live-gps-map'
import { DisconnectedLanding } from './disconnected-landing'
import { FirmwareFlasher } from './firmware/FirmwareFlasher'
import { ElrsFlasher, type ElrsFlasherNotice } from './firmware/ElrsFlasher'
import { flashElrsReceiver, type ElrsFlashProgress } from './firmware/web-serial-esptool'
import { patchElrsFirmwareOptions } from './view-models/elrs-firmware-options'
import { MavlinkInspectorView } from './views/MavlinkInspector'
import { intervalUsForRate } from './view-models/mavlink-inspector'
import { MAX_MAVLINK_PLOTS, useMavlinkInspector } from './hooks/use-mavlink-inspector'
import { CanDeviceInspectorView, type DronecanFirmwareOnlineSource } from './views/CanDeviceInspector'
import { useDronecanBusStats } from './hooks/use-dronecan-bus-stats'
import { useCanDevicePopouts } from './hooks/use-can-device-popouts'
import { usePopoutWindows } from './hooks/use-popout-windows'
import { RecentNoticesFeed, recentNoticesBadge } from './views/RecentNoticesFeed'
import { filterEscTelemetryForNode } from './view-models/can-device-inspector'
import { dronecanNodeBoardId, parseApj, decodeApjImage } from '@arduconfig/firmware-flash'
import { inflateZlib } from './firmware/web-serial-bootloader'
import { ParamInfoBubble } from './views/ParamInfoBubble'
import { ScopedField, ScopedSelectField } from './views/ScopedField'
import { ModesView } from './views/Modes'
import { FailsafeSection } from './sections/FailsafeSection'
import { LogsSection } from './sections/LogsSection'
import { useLogUpload } from './hooks/use-log-upload'
import { CalibrationSection } from './sections/CalibrationSection'
import { OsdSection } from './sections/OsdSection'
import { OutputsSection } from './sections/OutputsSection'
import { ParametersSection } from './sections/ParametersSection'
import { PortsSection } from './sections/PortsSection'
import { PresetsSection } from './sections/PresetsSection'
import { ReceiverSection } from './sections/ReceiverSection'
import { SnapshotsSection } from './sections/SnapshotsSection'
import { TuningCopterSection } from './sections/TuningCopterSection'
import { InitialTuneView } from './views/InitialTune'
import { FilterNotchHelp } from './views/FilterNotchHelp'
import { FiltersFromGyro } from './views/FiltersFromGyro'
import { isInitialTuneParamId } from './view-models/initial-tune-parameters'
import { AutotuneCopterSection } from './sections/AutotuneCopterSection'
import { AutotunePlaneSection } from './sections/AutotunePlaneSection'
import { PlaneSoaringAdsbSection } from './sections/PlaneSoaringAdsbSection'
import { TuningPlaneSection } from './sections/TuningPlaneSection'
import { TuningRoverSection } from './sections/TuningRoverSection'
import { TuningSubSection } from './sections/TuningSubSection'
import { VtxSection } from './sections/VtxSection'
import { PowerView, type PowerDraftItem, type PowerFieldSpec } from './views/Power'
import { CanBusView } from './views/CanBus'
import { CanEnablePrompt } from './views/CanEnablePrompt'
import { NetworkingView, type NetworkingTab } from './views/NetworkingView'
import { LuaScriptsView } from './views/LuaScripts'
import { useLuaScripts } from './hooks/use-lua-scripts'
import {
  buildLuaScriptsViewModel,
  LUA_APPLET_CATALOG,
  LUA_SCRIPTS_DIR
} from './view-models/lua-scripts'
import { LUA_APPLET_CONTENTS } from './lua-applets'
import { AiAssistantView } from './views/AiAssistantView'
import { useAiAssistant } from './hooks/use-ai-assistant'
import { buildTranscript } from './view-models/ai-assistant'
import { resolveWriteBlockReason } from './view-models/ai-assistant-proposal'
import { IpAddressField } from './views/IpAddressField'
import { PassthroughEditor } from './views/PassthroughEditor'
import { availablePassthroughEndpoints, groupPassthroughBlocks } from './view-models/passthrough'
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
import { AdvancedSensorCard } from './views/AdvancedSensorCard'
import { buildAdvancedSensorCards } from './view-models/advanced-sensor-cards'
import { buildPreArmStatusViewModel } from './view-models/prearm-status'
import { useStatusClock } from './hooks/use-status-clock'
import {
  StatusDashboardProvider,
  StatusDashboardRegion,
  type StatusDashboardCardEntry
} from './views/StatusDashboard'
import { useStatusDashboardLayout } from './hooks/use-status-dashboard-layout'
import type { StatusDashboardCardSpec } from './view-models/status-dashboard-layout'
import { ResetToDefaultsButton } from './views/ResetToDefaultsButton'
import { CalibrationLocationButton } from './sections/CalibrationLocationCard'
import { resolveSetupConfirmationRecord } from './view-models/setup-confirmation-resolve'
import { buildSetupConfirmationSignatures } from './view-models/setup-confirmation-signatures'
import { buildTuningTaskCards } from './view-models/tuning-task-cards'
import { buildOutputTaskCards, recommendOutputTaskId, type OutputTaskCard } from './view-models/output-task-cards'
import { buildRelayGroups } from './view-models/relay-groups'
import { buildSetupFlowSections } from './view-models/setup-flow-sections'
import { buildGuidedSetupOverview } from './view-models/guided-setup-overview'
import { buildVehicleOutputSummary } from './view-models/vehicle-output-summary'
import { ConfigView } from './views/Config'
import { paramDefaultsIdentity } from './view-models/param-defaults-identity'
import { withFlightModeOptions } from './view-models/flight-mode-options'
import { isFiberModeAvailable } from './view-models/fiber-mode-detection'
import { FilesView } from './views/Files'
import { SetupView } from './views/Setup'
import { LogTuningView } from './views/LogTuning'
import type { TuningTaskCard } from './views/Tuning'
import { useRuntimeSnapshot } from './hooks/use-runtime-snapshot'
import { useMavftpBrowser } from './hooks/use-mavftp-browser'
import { useOnboardLogs } from './hooks/use-onboard-logs'
import { useProductMode } from './hooks/use-product-mode'
import { useBootloaderIdentity } from './hooks/use-bootloader-identity'
import { useRecentNoticesExpanded } from './hooks/use-recent-notices-expanded'
import { useGpsCoordFormat } from './hooks/use-gps-coord-format'
import {
  formatLatitudeDecimal,
  formatLongitudeDecimal,
  formatLatitudeDms,
  formatLongitudeDms,
  formatMgrs,
  formatUtm,
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
import {
  createUserPresetId,
  isUserPresetId,
  mergeImportedUserPresets,
  sortUserPresets,
  type UserPresetDraft,
  type UserPresetRecord,
  updateUserPreset,
  type UserPresetEdit
} from './user-preset-library'
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
import { useLatchedRcDirections } from './hooks/use-latched-rc-directions'
import {
  buildCanNodePeripheralViewModels,
  buildGpsPeripheralViewModels,
  type AdditionalSettingsGroup
} from './view-models/peripherals'
import {
  buildRcMixerFunctionLookup,
  orderRcMixerFunctionCatalog,
  groupAssignmentsByChannel,
  type RcMixerAssignment
} from './view-models/rc-mixer'
import {
  type RcLogicLogicTerm,
  readRcLogicModel,
  rcLogicAddDrafts,
  rcLogicAddLogicTermDrafts,
  rcLogicFunctionCatalog,
  rcLogicRemovePlan,
  rcLogicTermFromAssignmentId,
  rcLogicTermParamIds,
  rcLogicUpdateDrafts,
  rcLogicUpdateLogicTermDrafts
} from './view-models/rc-logic'
import { armSwitchAssignmentDrafts, deriveArmSwitchAssignment } from './view-models/arm-switch'
import { statusToneLabel, type StatusTone } from './status-tone'
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

// Appended to a batch-write success notice when some writes were sent but could
// not be verified (the FC owns/re-derives the value, e.g. BAROn_GND_PRESS, or
// silently clamped it). The batch keeps the verified writes and reports these
// rather than rolling everything back — so the operator is told, not surprised.
function describeUnconfirmedWrites(unconfirmed: ParameterUnconfirmedWrite[]): string {
  if (unconfirmed.length === 0) {
    return ''
  }
  const names = unconfirmed.map((entry) => entry.paramId).join(', ')
  return (
    ` ${unconfirmed.length} value(s) could not be confirmed and were left as written ` +
    `(firmware-managed or live values that never echo the set value): ${names}. Re-sync to confirm.`
  )
}

const PRESET_AUTO_BACKUP_TAGS = ['auto-backup', 'preset'] as const

// One notices window at a time — the feed is a single stream, so a second
// window would just be a duplicate of the first. Constant so the open/close/
// lookup calls can never drift apart.
const NOTICES_POPOUT_KEY = 'recent-notices'

/**
 * How many times a silent param-defaults pull may be retried per build.
 *
 * More than one because the first attempt lands in the busiest moments after a
 * connect and a MAVFTP timeout there is not evidence of anything; bounded
 * because a board that genuinely cannot serve defaults must not be re-asked
 * every time a row is expanded.
 */
const MAX_DEFAULTS_FETCH_ATTEMPTS = 3

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
/**
 * Categories the Servos tab does NOT own, even though they route to the Motors
 * view and would otherwise appear under "Additional output settings".
 *
 * `airframe` (frame class and type) is the Config tab's job, and `outputs`
 * (ESC protocol, BDShot mask, per-output reverse, DShot rate) belongs to the
 * Motors tab, which presents them with the motor context that makes them
 * meaningful. Surfacing them a second time here gave an operator two places to
 * change the same thing with no indication which was authoritative.
 *
 * Module-level constant so the scope hook's memo sees a stable reference.
 */
const SERVO_ADDITIONAL_EXCLUDED_CATEGORY_IDS: ReadonlySet<string> = new Set([
  'airframe',
  'outputs',
  // Tabs of their own now, so they must not ALSO appear as rows under
  // "Additional output settings" -- that duplication is what this is fixing.
  'gimbal',
  'rangefinder',
  'optical-flow'
])
/** The Gimbal tab owns exactly this category. */
const GIMBAL_CATEGORY_IDS: ReadonlySet<string> = new Set(['gimbal'])
/**
 * Flow & Lidar owns both, because they are a pair in practice: optical flow
 * needs a height reference and that is almost always the downward rangefinder.
 * Configuring one without the other is the usual reason flow will not hold.
 */
const FLOW_LIDAR_CATEGORY_IDS: ReadonlySet<string> = new Set(['rangefinder', 'optical-flow'])

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
  // Expert-mode text filter for the Recent Notices panel.
  const [noticeFilter, setNoticeFilter] = useState('')
  // Expand-in-place for the INLINE Recent Notices list. Collapsed for a fresh
  // profile — Status & Info is a long page and nobody who never touches this
  // control pays for it — but the choice is remembered once made, because
  // wanting to read the FC's message feed is a standing preference, not a
  // per-visit one. See hooks/use-recent-notices-expanded.ts.
  //
  // Scope note: this is the inline height ONLY. The popped-out window sizes
  // itself and is passed no `expanded` at all, so toggling here can never make
  // that window jump.
  const [noticesExpanded, toggleNoticesExpanded] = useRecentNoticesExpanded()
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
        // LEGACY_PARAM_ALIASES lets upstream metadata published under a
        // modern name (CAM1_SERVO_ON) also resolve for a controller streaming
        // the legacy one (CAM_SERVO_ON), which otherwise rendered with no
        // metadata at all.
        parameters: mergeUpstreamParameters(base.parameters, upstreamParameters.params, LEGACY_PARAM_ALIASES)
      }
    }
    return base
  }, [activeVehicle, upstreamParameters])
  // The Params view reads definitions from this catalog. Apply the version-gated
  // ArduCopter 4.7 overrides when a >= 4.7 build is detected; pre-connect /
  // Unknown / 4.6 / non-copter get the untouched base catalog.
  // VALT (mode 29) exists only on fork builds with MODE_VALT_ENABLED; detected
  // by the presence of VALT_POS_EXPO rather than by a version-string match.
  const valtModeAvailable = useMemo(
    () => detectSfdValtMode(snapshot.parameters.map((parameter) => parameter.id)),
    [snapshot.parameters]
  )
  const metadataCatalog = useMemo(
    () =>
      // Fork gate runs AFTER the version gate: it only ever appends VALT to the
      // flight-mode enums, and returns the catalog by identity on stock builds.
      applySfdValtCatalogOverrides(
        applyArducopter47CatalogOverrides(
          normalizeFirmwareMetadata(activeMetadataBundle),
          snapshot.hardware.board?.firmwareVersionParts,
          snapshot.vehicle?.vehicle === 'ArduCopter'
        ),
        valtModeAvailable
      ),
    [
      activeMetadataBundle,
      snapshot.hardware.board?.firmwareVersionParts,
      snapshot.vehicle?.vehicle,
      valtModeAvailable
    ]
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
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([])
  // Multi-select: clicking a preset card toggles it in/out of the selection so
  // presets from different categories can be combined and applied together.
  // (The apply-ack auto-resets when the merged diff signature changes — see the
  // effect on selectedPresetDiffSignature.)
  const togglePresetSelection = useCallback((presetId: string) => {
    setSelectedPresetIds((current) =>
      current.includes(presetId) ? current.filter((id) => id !== presetId) : [...current, presetId]
    )
  }, [])
  // Param ids the operator has dropped from the combined preset diff before
  // applying — excluded from the write. Reset when the selection/diff changes.
  const [droppedPresetParamIds, setDroppedPresetParamIds] = useState<string[]>([])
  const togglePresetParamDrop = useCallback((paramId: string) => {
    setDroppedPresetParamIds((current) =>
      current.includes(paramId) ? current.filter((id) => id !== paramId) : [...current, paramId]
    )
  }, [])
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
    parameterExactSearch,
    setParameterExactSearch,
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
  // Upload-to-your-own-server for onboard logs. Entirely self-contained: its
  // own client, its own stored session, and no relationship to any other
  // network surface in this app.
  const logUpload = useLogUpload(runtime)
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
  // Live write-progress for the SCOPED apply path (snapshot restore, receiver,
  // config, power, servo mapping, …). The Parameters "Apply All" button shows
  // its own inline "(N/M)" label; the scoped applies had no progress signal at
  // all — just a frozen "Applying…" — so this drives a global progress bar for
  // them (most visible on a many-parameter snapshot restore).
  const [scopedWriteProgress, setScopedWriteProgress] = useState<
    { completed: number; total: number; scopeLabel: string } | undefined
  >(undefined)
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
  // Armed by the one-click "Save changes" finish; consumed by the effect that
  // writes the reorder once the staged drafts have actually landed in state.
  const [pendingMotorReorderSave, setPendingMotorReorderSave] = useState(false)
  // Guided motor-identify auto-spin: after the operator spins the FIRST motor,
  // automatically spin each subsequent motor. Once the operator has clicked the
  // position that moved, the spin has served its purpose, so the answer itself
  // ends it — an explicit zero-throttle DO_MOTOR_TEST abort — and the next motor
  // starts behind that stop's ACK rather than after the full test window. (The
  // status-gated fallback below still covers the case where a spin ends without
  // an answer, e.g. the operator re-spun and let the window lapse; a fixed timed
  // advance used to fire while the FC was still armed from the prior test and
  // got rejected with "the vehicle reports armed=true".)
  const [guidedReorderAutoSpin, setGuidedReorderAutoSpin] = useState(true)
  const autoSpunGuidedReorderStepRef = useRef<number | null>(null)
  // True from the moment a position is picked until the stop+start pair for
  // that pick has settled. A ref (not state) because the guard must be read and
  // set synchronously inside the click handler — a re-render round trip is
  // exactly the window a double-click slips through, and two overlapping starts
  // would spin a motor the operator is not looking at.
  const guidedReorderAdvanceInFlightRef = useRef(false)
  // Spin-error banner — when spinGuidedReorderStep or a manual dialog spin
  // fails (FC rejected DO_MOTOR_TEST, eligibility check failed, etc.) we
  // used to swallow the error; surface it inside the dialog so the
  // operator sees WHY no motor moved.
  const [motorDialogSpinError, setMotorDialogSpinError] = useState<string | undefined>(undefined)

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
  const { theme, toggleTheme } = useTheme()
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
    snapshotForceInvalid,
    setSnapshotForceInvalid,
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
  // Export defaults differ from import: only calibration (the per-airframe
  // offsets/scales/trims) is skipped by default, keeping stream rates + mission
  // unless the operator opts to drop them for a leaner backup.
  const [parameterExportExclusions, setParameterExportExclusions] = useState<
    Record<ParameterImportCategory, boolean>
  >({ calibration: true, 'stream-rates': false, mission: false })
  // Non-default params fetched from the FC's packed defaults (MAVFTP
  // param.pck?withdefaults, 4.5+). null until fetched. Drives the "Show only
  // changed" filter and the non-default export. Declared here (above the export
  // hook) so the export can honour the same set.
  const [nonDefaultParamIds, setNonDefaultParamIds] = useState<ReadonlySet<string> | null>(null)
  // Firmware default per parameter, from the same param.pck fetch. Known for
  // EVERY parameter, not just changed ones — an unflagged param sits at its
  // default, so its value doubles as one.
  const [parameterDefaults, setParameterDefaults] = useState<ReadonlyMap<string, number> | null>(null)
  const [showOnlyNonDefault, setShowOnlyNonDefault] = useState(false)
  // Params written successfully in the last few seconds. Purely a visual
  // confirmation: a staged row reads yellow, and on a verified write it turns
  // green briefly before settling back. Without this there was no visible
  // difference between "I typed a value" and "the controller took it" — the
  // draft just disappeared.
  const [recentlyWrittenParamIds, setRecentlyWrittenParamIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  )
  const recentlyWrittenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const markParametersWritten = useCallback((paramIds: string[]) => {
    if (paramIds.length === 0) {
      return
    }
    setRecentlyWrittenParamIds(new Set(paramIds))
    if (recentlyWrittenTimerRef.current) {
      clearTimeout(recentlyWrittenTimerRef.current)
    }
    recentlyWrittenTimerRef.current = setTimeout(() => {
      recentlyWrittenTimerRef.current = undefined
      setRecentlyWrittenParamIds(new Set<string>())
    }, 4000)
  }, [])
  useEffect(
    () => () => {
      if (recentlyWrittenTimerRef.current) {
        clearTimeout(recentlyWrittenTimerRef.current)
      }
    },
    []
  )
  const [fetchDefaultsBusy, setFetchDefaultsBusy] = useState(false)
  const {
    handleExportParameterBackup,
    handleUploadParameterBackup,
    parameterBackupUploadTarget,
    artifactUpload: backupArtifactUpload,
    handleExportParameterBackupAsParm,
    handleExportParameterBackupAsParams,
    handleImportParameterBackup,
    pendingParameterImport,
    stagePendingParameterImport,
    stagePendingParameterImportSubset,
    dropPendingParameterImportEntries,
    importedDraftOrigins,
    dismissPendingParameterImport
  } = useParameterBackupIo({
    snapshot,
    parameterImportExclusions,
    parameterExportExclusions,
    exportIncludeParamIds: showOnlyNonDefault && nonDefaultParamIds ? nonDefaultParamIds : undefined,
    replaceDrafts,
    mergeDrafts,
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
  // Owns the watchdog auto-resume loop (below): true while it is cycling
  // reconnects to finish a parameter download a resetting board keeps cutting
  // short. Separate from the reboot reconnect so the two can never both drive
  // the port.
  const watchdogResumingRef = useRef(false)
  // Set by the Disconnect button. Any auto-reconnect loop must stand down when
  // the operator closes the link on purpose — re-opening a port someone just
  // closed is the one thing an automatic retry must never do.
  const intentionalDisconnectRef = useRef(false)
  const previousConnectionKindRef = useRef(snapshot.connection.kind)
  const previousGuidedSectionRef = useRef<string | undefined>(undefined)
  const boardCatalogEntry = useMemo(() => findBoardCatalogEntry(snapshot.hardware.board?.boardType), [snapshot.hardware.board?.boardType])
  const rcChannelDisplays = buildRcChannelDisplays(snapshot)
  const airframe = deriveAirframe(snapshot, snapshot.vehicle?.vehicle)
  // "DroneCAN peripheral selected but CAN bus off" detector for the CAN tab.
  const canEnablement = useMemo(() => deriveCanEnablement(snapshot), [snapshot])
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
  // Auto-enable bidirectional DShot when the operator picks a DShot MOT_PWM_TYPE.
  // Fires only on an actual change of the MOT_PWM_TYPE draft (ref-guarded so
  // other drafts / telemetry ticks don't retrigger it). If the firmware lacks
  // BDShot (SERVO_BLH_BDMASK absent from the synced tree) we say so instead of
  // staging anything. Staging only — the operator still presses Apply.
  const lastMotPwmDraftRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const raw = editedValues.MOT_PWM_TYPE
    if (raw === undefined || raw === lastMotPwmDraftRef.current) {
      return
    }
    lastMotPwmDraftRef.current = raw
    const motPwmType = Math.round(Number(raw))
    if (!(motPwmType >= 4 && motPwmType <= 7)) {
      return // not a DShot protocol
    }
    if (!configParametersById.has('SERVO_BLH_BDMASK')) {
      setParameterNotice({
        tone: 'warning',
        text: 'Your firmware build does not support bidirectional DShot (no SERVO_BLH_BDMASK parameter). Flash a board/firmware built with BDShot to use RPM telemetry.'
      })
      return
    }
    const liveBdmask = readRoundedParameter(snapshot, 'SERVO_BLH_BDMASK') ?? 0
    const stagedBdmask = editedValues.SERVO_BLH_BDMASK
    if (liveBdmask > 0 || (stagedBdmask !== undefined && Number(stagedBdmask) > 0)) {
      return // already on (live or staged) — don't clobber the operator's mask
    }
    mergeDrafts({ SERVO_BLH_BDMASK: '15', SERVO_BLH_AUTO: '1' })
    setParameterNotice({
      tone: 'success',
      text: 'Bidirectional DShot auto-enabled on outputs 1-4 (SERVO_BLH_BDMASK=15, SERVO_BLH_AUTO=1). Widen the mask in ESC & DShot if your board supports more outputs.'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedValues.MOT_PWM_TYPE, configParametersById, mergeDrafts, setParameterNotice])
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
  // RC channel-direction verdicts live here (not in ReceiverSection) so both the
  // Endpoints direction card and the guided-setup radio gate read the same
  // latched per-axis result.
  const rcDirectionInputs = useMemo(
    () =>
      rcAxisObservations.map((observation) => ({
        axisId: observation.axisId,
        pwm: observation.pwm,
        trim: observation.calibratedTrim,
        min: observation.calibratedMin,
        max: observation.calibratedMax,
        reversed: (readParameterValue(snapshot, `RC${observation.channelNumber}_REVERSED`) ?? 0) !== 0
      })),
    [rcAxisObservations, snapshot]
  )
  const { results: rcDirectionResults, activeAxis: rcDirectionActiveAxis, reset: resetRcDirections } =
    useLatchedRcDirections(rcDirectionInputs)
  // Re-running the guided stick-range exercise starts a fresh direction check,
  // so clear the latched verdicts AND the captured throttle rest-baseline. The
  // baseline is grabbed from the first throttle sample and held for the whole
  // session; without this, a first sample taken with throttle not at rest (e.g.
  // raised at connect) permanently poisons the throttle correct/reversed verdict
  // with no in-app way to clear it. Fires only on the idle/passed/failed→running
  // transition (a deliberate re-check), never mid-run.
  const previousRcRangeStatusRef = useRef(rcRangeExercise.status)
  useEffect(() => {
    if (rcRangeExercise.status === 'running' && previousRcRangeStatusRef.current !== 'running') {
      resetRcDirections()
    }
    previousRcRangeStatusRef.current = rcRangeExercise.status
  }, [rcRangeExercise.status, resetRcDirections])
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
  // Arm switch: RC5_OPTION existing proves this firmware's RCn_OPTION metadata
  // is synced at all, so the control gates on that rather than assuming.
  const armSwitchAvailable = selectParameterById(snapshot, 'RC5_OPTION') !== undefined
  const armSwitchAssignment = deriveArmSwitchAssignment(snapshot, editedValues)
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
      const attempt = async (): Promise<boolean> =>
        attemptSerialPortReconnect({
          runtime,
          targetInfo,
          // Point the transport resolver at this handle synchronously; the
          // setSelectedSerialPort state update lags a render.
          setActivePort: (port) => {
            selectedSerialPortRef.current = port
          },
          rememberPort: rememberSelectedSerialPort,
          isCancelled: () => !rebootReconnectingRef.current,
          // fresh: the board just rebooted on purpose — re-read every value
          // rather than inheriting a partial table from before the reboot.
          fresh: true,
          // The reboot's pull is done — clear the "pull parameters again"
          // follow-up so it doesn't linger after the auto-refresh.
          onConnected: () =>
            setParameterFollowUp((current) => (current?.refreshRequired && !current.requiresReboot ? undefined : current))
        })
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

  // Auto-resume a parameter download that a resetting board keeps interrupting.
  // Field case: a watchdogging FC drops the USB link a few seconds into every
  // connect, delivering ~120 of 1320 parameters per window — finishing by hand
  // would take a dozen manual reconnects. Each cycle resumes where the last one
  // stopped (runtime keeps the partial table), so the count climbs across
  // attempts until the table is complete. Deliberately narrow: web-serial only,
  // only while a genuinely incomplete download is outstanding, never when the
  // operator disconnected on purpose or a reboot reconnect owns the link.
  useEffect(() => {
    if (transportMode !== 'web-serial' || !selectedSerialPort) {
      return
    }
    if (snapshot.connection.kind !== 'disconnected' && snapshot.connection.kind !== 'error') {
      return
    }
    if (
      expectRebootReconnectRef.current ||
      rebootReconnectingRef.current ||
      watchdogResumingRef.current ||
      intentionalDisconnectRef.current ||
      busyAction !== undefined
    ) {
      return
    }
    const stale = snapshot.staleLink
    if (!stale || stale.total <= 0 || stale.downloaded >= stale.total) {
      return
    }

    watchdogResumingRef.current = true
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
      const targetInfo = getWebSerialPortInfo(selectedSerialPortRef.current)
      // Bounded so a board that never comes back can't reconnect forever; the
      // operator can start another run with Connect.
      const deadlineMs = Date.now() + 5 * 60_000
      let cycles = 0
      try {
        while (watchdogResumingRef.current && !intentionalDisconnectRef.current && Date.now() < deadlineMs) {
          cycles += 1
          const before = runtime.getSnapshot().staleLink?.downloaded ?? 0
          setSessionNotice({
            tone: 'neutral',
            text: `Board reset with the parameter download incomplete (${before}/${stale.total}). Reconnecting to resume — attempt ${cycles}.`
          })
          // Let the board finish dropping off USB and re-enumerate.
          await wait(2000)
          if (!watchdogResumingRef.current || intentionalDisconnectRef.current) {
            return
          }
          await attemptSerialPortReconnect({
            runtime,
            targetInfo,
            setActivePort: (port) => {
              selectedSerialPortRef.current = port
            },
            rememberPort: rememberSelectedSerialPort,
            isCancelled: () => !watchdogResumingRef.current || intentionalDisconnectRef.current,
            // NOT fresh: resuming is the whole point.
            fresh: false
          })

          // Give the reconnected board a window to stream before judging it.
          const streamDeadline = Date.now() + 20_000
          while (Date.now() < streamDeadline && watchdogResumingRef.current) {
            const current = runtime.getSnapshot()
            if (current.parameterStats.status === 'complete') {
              setSessionNotice({
                tone: 'success',
                text: `Parameter download finished across ${cycles} reconnect${cycles === 1 ? '' : 's'} — ${current.parameterStats.downloaded}/${current.parameterStats.total} values.`
              })
              return
            }
            if (current.connection.kind === 'disconnected' || current.connection.kind === 'error') {
              break // reset again: go round for another window
            }
            await wait(500)
          }
          if (runtime.getSnapshot().connection.kind === 'connected') {
            return // link is up and streaming; leave it alone
          }
        }
        if (watchdogResumingRef.current && !intentionalDisconnectRef.current) {
          const current = runtime.getSnapshot()
          setSessionNotice({
            tone: 'warning',
            text: `Gave up auto-reconnecting after ${cycles} attempt${cycles === 1 ? '' : 's'} (${current.staleLink?.downloaded ?? 0}/${stale.total} parameters). The values on screen are from the last link — click Connect to keep trying.`
          })
        }
      } finally {
        watchdogResumingRef.current = false
      }
    })()
  }, [
    snapshot.connection.kind,
    snapshot.staleLink,
    transportMode,
    selectedSerialPort,
    busyAction,
    runtime,
    rememberSelectedSerialPort
  ])

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

  // OSD and VTX share one nav tab. Both keep their own panel (and their own
  // apply scope) — this only chooses which is on screen.
  const [osdVtxTab, setOsdVtxTab] = useState<'osd' | 'vtx'>('osd')
  const restoredSetupProgressKeyRef = useRef<string | undefined>(undefined)

  /**
   * Start guided setup over.
   *
   * Clears the durable copy as well as the in-memory state: the restore effect
   * refills confirmations the moment the board identifies itself, so wiping
   * only memory produces a reset that visibly undoes itself a second later.
   * The restore latch is reset too, otherwise the next identify is skipped and
   * the operator has to reconnect before the wizard behaves.
   *
   * Deliberately does NOT touch the vehicle: this forgets what the operator
   * confirmed, it does not un-write parameters. Anything already applied stays
   * applied, which is why the confirm below says so.
   */
  function handleResetGuidedSetup(): void {
    setSetupConfirmations({})
    setOrientationExercise(createIdleOrientationExerciseState())
    setModeSwitchExercise(createIdleModeSwitchExerciseState())
    setRcRangeExercise(createIdleRcRangeExerciseState())
    setRcMappingSession(createIdleRcMappingSessionState())
    if (setupProgressKey !== undefined) {
      clearStoredSetupProgress(setupProgressKey)
    }
    restoredSetupProgressKeyRef.current = setupProgressKey
    setSelectedSetupSectionId(undefined)
    setSessionNotice({
      tone: 'neutral',
      text: 'Guided setup reset — every step is unconfirmed again. Parameters already written to the vehicle are unchanged.'
    })
  }

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
      current.status === 'idle' && stored.exercises.rcCalibrationSession
        ? // Sessions persisted before switchCaptures existed lack the field at
          // runtime (the type says otherwise); backfill it so the CH5/CH6
          // add-on never reads undefined.
          {
            ...stored.exercises.rcCalibrationSession,
            switchCaptures:
              stored.exercises.rcCalibrationSession.switchCaptures ?? createIdleRcCalibrationSessionState().switchCaptures
          }
        : current
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

  // Drives the "last data / no data for N s" freshness readouts on the
  // Status & Info sensor cards. Only runs while that tab is open and a
  // vehicle is connected — nothing else in the app needs a wall clock.
  const statusClockMs = useStatusClock(activeViewId === 'setup' && snapshot.connection.kind === 'connected')

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
    if (activeViewId !== 'guided-setup' || setupMode !== 'wizard' || !selectedSetupSectionId) {
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

  // When a guided RC exercise finishes on the Receiver view, return to the Setup
  // wizard so the step's completion cue + Continue are visible — otherwise the
  // operator is stranded on Receiver with no next step. Only fires on the
  // edge into a passing state (ref starts true so a restored/already-passed
  // exercise on load doesn't yank the view).
  const returnedFromExerciseRef = useRef(true)
  useEffect(() => {
    const exercisePassed =
      rcRangeExercise.status === 'passed' ||
      modeSwitchExercise.status === 'passed' ||
      rcMappingSession.status === 'ready'
    if (exercisePassed && !returnedFromExerciseRef.current && activeViewId === 'receiver') {
      setActiveViewId('guided-setup')
      setSetupMode('wizard')
    }
    returnedFromExerciseRef.current = exercisePassed
  }, [rcRangeExercise.status, modeSwitchExercise.status, rcMappingSession.status, activeViewId])

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

  // A finished compass calibration writes new COMPASS_OFS_*/DEV_ID values on
  // the FC, and those only take full effect after a reboot + fresh parameter
  // pull. The action's own instruction line said so, but a line of text inside
  // a completed card is easy to walk past — surface the same reboot follow-up
  // banner (with its Request Reboot action) the reboot-sensitive parameter
  // writes already use, so the next step is offered rather than just described.
  const compassCalibrationStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const status = snapshot.guidedActions['calibrate-compass']?.status
    const previous = compassCalibrationStatusRef.current
    compassCalibrationStatusRef.current = status
    if (status !== 'succeeded' || previous === 'succeeded' || previous === undefined) {
      return
    }
    setParameterFollowUp({
      requiresReboot: true,
      refreshRequired: true,
      changedCount: 0,
      text: 'Compass calibration stored new offsets. Reboot the flight controller, then pull parameters again before flight.'
    })
  }, [snapshot.guidedActions, setParameterFollowUp])

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
    // CH5/CH6 keep capturing after the four control axes finish. The four axes
    // completing flips the session to 'ready', and switch capture used to stop
    // with it — but the on-screen instructions list "flick CH5/CH6" as step 3,
    // AFTER the stick sweeps that end the capture. So the UI asked for the
    // switches right after it had stopped listening, and they read
    // Min == Max == resting pwm no matter how far the operator threw them.
    if (rcCalibrationSession.status !== 'capturing' && rcCalibrationSession.status !== 'ready') {
      return
    }

    setRcCalibrationSession((current) => {
      if (current.status !== 'capturing' && current.status !== 'ready') {
        return current
      }
      const axesStillCapturing = current.status === 'capturing'

      let changed = false
      const nextCaptures = { ...current.captures }

      rcAxisObservations.forEach((observation) => {
        const existing = nextCaptures[observation.axisId]
        // Once the axes are ready their captured endpoints are what the
        // operator reviewed and is about to stage; only the switches keep
        // accumulating past that point.
        if (!existing || !axesStillCapturing) {
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

      // CH5/CH6 switch endpoints — captured opportunistically from the live
      // channels. These are OPTIONAL: they never gate completion (gated on the
      // four control axes only below), so a 4-channel radio still finishes.
      const liveChannels = snapshot.liveVerification.rcInput.channels
      const nextSwitchCaptures = { ...current.switchCaptures }
      for (const channelNumber of RC_CALIBRATION_SWITCH_CHANNELS) {
        const existing = nextSwitchCaptures[channelNumber]
        if (!existing) {
          continue
        }
        const pwm = liveChannels[channelNumber - 1]
        if (typeof pwm !== 'number' || pwm === 0xffff || pwm < 800) {
          continue
        }
        const nextSwitch = {
          ...existing,
          observedMin: Math.min(existing.observedMin ?? pwm, pwm),
          observedMax: Math.max(existing.observedMax ?? pwm, pwm),
          lowObserved: existing.lowObserved || pwm <= RC_SWITCH_LOW_PWM,
          highObserved: existing.highObserved || pwm >= RC_SWITCH_HIGH_PWM
        }
        if (
          nextSwitch.observedMin !== existing.observedMin ||
          nextSwitch.observedMax !== existing.observedMax ||
          nextSwitch.lowObserved !== existing.lowObserved ||
          nextSwitch.highObserved !== existing.highObserved
        ) {
          nextSwitchCaptures[channelNumber] = nextSwitch
          changed = true
        }
      }

      const completed =
        axesStillCapturing && RC_CALIBRATION_AXIS_ORDER.every((axisId) => rcCalibrationCaptureComplete(nextCaptures[axisId]))
      if (completed) {
        return {
          ...current,
          status: 'ready',
          captures: nextCaptures,
          switchCaptures: nextSwitchCaptures,
          completedAtMs: Date.now(),
          failureReason: undefined
        }
      }

      return changed ? { ...current, captures: nextCaptures, switchCaptures: nextSwitchCaptures } : current
    })
  }, [rcAxisObservations, rcCalibrationSession.status, snapshot])

  // Memoized: snapshot is a fresh object every telemetry tick, so an
  // unmemoized filter re-ran over the full (1000+ on real hardware)
  // parameter set on every render and made the effect below re-fire each
  // tick (its [filteredParameters] dep was a new array every render).
  const filteredParameters = useMemo<ParameterState[]>(
    () => buildFilteredParameters({ snapshot, parameterSearch, exactSearch: parameterExactSearch, metadataCatalog }),
    [snapshot.parameters, parameterSearch, parameterExactSearch, metadataCatalog]
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
  // Snapshot restore curation: off-by-default calibration exclusion (restoring
  // another unit's accel/gyro/compass calibration + AHRS trim onto different
  // hardware is wrong by default) plus a per-row Drop so the operator can
  // curate the diff before writing it — matching the Parameters tab's
  // stage-then-write feel instead of committing the entire diff in one shot.
  // Reuses the SAME opt-in 'calibration' exclusion category the Parameters
  // tab's own backup-import toggles already use (parameter-backups.ts) rather
  // than a second bespoke classifier.
  const [snapshotImportCalibration, setSnapshotImportCalibration] = useState(false)
  const [snapshotRestoreDroppedParamIds, setSnapshotRestoreDroppedParamIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const snapshotRestoreImportOptions = useMemo<ParameterBackupImportOptions>(
    () => ({ excludeCategories: snapshotImportCalibration ? [] : ['calibration'] }),
    [snapshotImportCalibration]
  )
  const {
    selectedProfile: selectedSnapshot,
    restore: selectedSnapshotRestore
  } = useSelectedProfileDiff({
    // Restore is ALWAYS computed against the live FC — never the compare
    // baseline. The "Compare to baseline" picker is a display-only lens for
    // seeing how two saved snapshots differ; wiring the restore write set to it
    // caused a silent PARTIAL restore (params equal between the two snapshots
    // but different on the live FC were skipped). The picker now only annotates.
    snapshotParameters: snapshot.parameters,
    savedProfiles: savedSnapshots,
    selectedProfileId: selectedSnapshotId,
    resolveBackup: resolveSnapshotBackup,
    importOptions: snapshotRestoreImportOptions
  })
  useEffect(() => {
    setSnapshotRestoreDroppedParamIds(new Set())
  }, [selectedSnapshot?.id])
  function handleDropSnapshotRestoreEntry(paramId: string): void {
    setSnapshotRestoreDroppedParamIds((current) => {
      const next = new Set(current)
      next.add(paramId)
      return next
    })
    // Snapshot "Apply" now stages a draft rather than writing, so dropping a row
    // must also discard any draft it staged — otherwise the entry lingers in the
    // global draft bar after being dropped from the restore diff.
    clearDraft(paramId)
  }
  function handleDropAllSnapshotRestoreEntries(): void {
    const ids = [
      ...selectedSnapshotChangedEntries.map((entry) => entry.id),
      ...selectedSnapshotInvalidEntries.map((entry) => entry.id)
    ]
    if (ids.length === 0) {
      return
    }
    setSnapshotRestoreDroppedParamIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => next.add(id))
      return next
    })
    clearDrafts(ids)
    setSnapshotNotice({
      tone: 'neutral',
      text: `Dropped ${ids.length} row(s) from this restore and un-staged any drafts. The live FC values are unchanged.`
    })
  }
  function handleClearSnapshotRestoreDrops(): void {
    setSnapshotRestoreDroppedParamIds(new Set())
  }
  const snapshotRestoreExcludedCalibrationCount = selectedSnapshotRestore?.excludedCount ?? 0
  const filteredSnapshotRestoreDraftValues = useMemo(() => {
    const draftValues = selectedSnapshotRestore?.draftValues ?? {}
    if (snapshotRestoreDroppedParamIds.size === 0) {
      return draftValues
    }
    const result: Record<string, string> = {}
    for (const [paramId, value] of Object.entries(draftValues)) {
      if (!snapshotRestoreDroppedParamIds.has(paramId)) {
        result[paramId] = value
      }
    }
    return result
  }, [selectedSnapshotRestore, snapshotRestoreDroppedParamIds])
  const {
    entries: selectedSnapshotDiffEntries,
    groups: selectedSnapshotDiffGroups,
    changed: selectedSnapshotChangedEntries,
    invalid: selectedSnapshotInvalidEntries,
    signature: selectedSnapshotDiffSignature
  } = useMemo(
    () => selectEntityDiff(snapshot.parameters, filteredSnapshotRestoreDraftValues, parameterEnumOverrides),
    [snapshot.parameters, filteredSnapshotRestoreDraftValues, parameterEnumOverrides]
  )
  const {
    handleCaptureLiveSnapshot,
    handleOverwriteSelectedSnapshot,
    handleImportSnapshotFile,
    handleExportSnapshotLibrary,
    handleUploadSnapshotLibrary,
    handleUploadSelectedSnapshot,
    snapshotLibraryUploadTarget,
    selectedSnapshotUploadTarget,
    artifactUpload: snapshotArtifactUpload,
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
  // Serial-port remap targets for saved presets, keyed by preset id. Session
  // state only — a remap is a decision about the aircraft in front of you, not
  // a property of the preset, so it must not persist into the next connection.
  const [presetSerialRemapTargets, setPresetSerialRemapTargets] = useState<Record<string, number>>({})
  const {
    presetDefinitions,
    presetsByGroup,
    presetGroups,
    selectedPresetSerialRemap,
    selectedPresetDependencyLabels,
    presetPreviewById,
    selectedPresets,
    selectedPresetDraftValues,
    selectedPresetConflicts,
    selectedPresetUnknownIds,
    selectedPresetTouchedCount,
    selectedPresetApplicability,
    selectedPresetDiffGroups,
    selectedPresetChangedEntries,
    selectedPresetInvalidEntries,
    selectedPresetDiffSignature
  } = usePresetCatalog({
    snapshot,
    metadataCatalog,
    selectedPresetIds,
    userPresets: libraries.savedUserPresets,
    serialRemapTargets: presetSerialRemapTargets
  })

  // Create / delete of operator-authored presets. Creating is read-only — it
  // captures values already synced from the aircraft — and applying one runs the
  // existing preset apply path (verified setParameters with rollback, pre-apply
  // auto-backup), so there is no new write path anywhere in this feature.
  const sourceFirmwareForPresets = snapshot.vehicle?.firmware
  const handleCreateUserPreset = useCallback(
    (draft: UserPresetDraft) => {
      const record: UserPresetRecord = {
        id: createUserPresetId(draft.label),
        label: draft.label,
        description: draft.description || `${draft.values.length} parameter(s) saved from the Parameter Editor.`,
        createdAt: new Date().toISOString(),
        sourceFirmware: sourceFirmwareForPresets,
        tags: ['user'],
        values: draft.values,
        dependencies: draft.dependencies
      }
      libraries.setSavedUserPresets((current) => sortUserPresets([...current, record]))
      setParameterNotice({
        tone: 'success',
        text: `Saved preset "${record.label}" (${record.values.length} parameters). Apply it from the Presets tab.`
      })
    },
    [libraries, setParameterNotice, sourceFirmwareForPresets]
  )

  const handleImportUserPresets = useCallback(
    (records: readonly UserPresetRecord[]) => {
      // Merge, never replace: mergeImportedUserPresets re-files an id clash
      // under a fresh id rather than overwriting the operator's own preset of
      // the same name, and drops a byte-identical re-import.
      libraries.setSavedUserPresets((current) => mergeImportedUserPresets(current, records).presets)
    },
    [libraries]
  )

  const handleUpdateUserPreset = useCallback(
    (presetId: string, edit: UserPresetEdit) => {
      libraries.setSavedUserPresets((current) => updateUserPreset(current, presetId, edit))
      setPresetNotice({ tone: 'success', text: 'Preset updated. Nothing was written to the aircraft.' })
    },
    [libraries, setPresetNotice]
  )
  const handleDeleteUserPreset = useCallback(
    (presetId: string) => {
      if (!isUserPresetId(presetId)) {
        return
      }
      libraries.setSavedUserPresets((current) => current.filter((record) => record.id !== presetId))
      setSelectedPresetIds((current) => current.filter((id) => id !== presetId))
    },
    [libraries]
  )
  // The preset changes that will actually be written — the combined diff minus
  // any params the operator dropped in the review list.
  const effectivePresetChangedEntries = selectedPresetChangedEntries.filter(
    (entry) => !droppedPresetParamIds.includes(entry.id)
  )
  // Invalid entries the operator has NOT dropped. The apply guard must use this
  // (not the full merged invalid set), so dropping the one metadata-invalid row
  // unblocks applying the rest — matching snapshot restore, which filters drops
  // before its diff.
  const effectivePresetInvalidEntries = selectedPresetInvalidEntries.filter(
    (entry) => !droppedPresetParamIds.includes(entry.id)
  )
  const effectivePresetDraftValues = Object.fromEntries(
    Object.entries(selectedPresetDraftValues).filter(([paramId]) => !droppedPresetParamIds.includes(paramId))
  )
  // Live MAVLink inspector stats — only subscribed while its tab is active.
  const {
    stats: mavlinkInspectorStats,
    sentStats: mavlinkInspectorSentStats,
    sourceHealth: mavlinkInspectorSourceHealth,
    clear: clearMavlinkInspector,
    paused: mavlinkInspectorPaused,
    setPaused: setMavlinkInspectorPaused,
    plots: mavlinkInspectorPlots,
    addPlot: addMavlinkInspectorPlot,
    removePlot: removeMavlinkInspectorPlot,
    exportSnapshot: exportMavlinkInspectorSnapshot,
    recording: mavlinkInspectorRecording,
    recordedCount: mavlinkInspectorRecordedCount,
    recordingCapped: mavlinkInspectorRecordingCapped,
    recordingMax: mavlinkInspectorRecordingMax,
    startRecording: startMavlinkInspectorRecording,
    stopRecording: stopMavlinkInspectorRecording,
    downloadRecording: downloadMavlinkInspectorRecording,
    exportPlotCsv: exportMavlinkInspectorPlotCsv
  } = useMavlinkInspector(runtime, activeViewId === 'mavlink-inspector')
  // Live frames/sec for the DroneCAN inspector, sampled off the cumulative counter.
  const dronecanFramesPerSec = useDronecanBusStats(
    snapshot.canBus.framesReceived,
    snapshot.canBus.status === 'active'
  )
  // Online firmware lookup for DroneCAN nodes (desktop-only). The browser can't
  // reach firmware.ardupilot.org (no CORS), so this is wired ONLY when the
  // Electron firmware bridge is present — same precedent as the FC flasher. In
  // the web build it degrades to `available: false` (local .bin still works).
  // The node's bootloader flashes RAW bytes, so we decode the server's .apj
  // (zlib image) down to the raw image before handing it to the Phase-2 update.
  const dronecanFirmwareOnline = useMemo<DronecanFirmwareOnlineSource>(() => {
    const bridge =
      typeof window !== 'undefined'
        ? (
            window as unknown as {
              arduconfigDesktop?: {
                firmware?: {
                  listDronecanNode?: (boardId: number) => Promise<{
                    releaseTypes: string[]
                    entries: Array<{
                      boardId: number
                      platform: string
                      releaseType: string
                      versionStr: string
                      url: string
                      latest: boolean
                    }>
                  }>
                  download?: (url: string) => Promise<Uint8Array>
                }
              }
            }
          ).arduconfigDesktop?.firmware
        : undefined
    if (!bridge?.listDronecanNode || !bridge.download) {
      const unavailable = async (): Promise<never> => {
        throw new Error(
          'Online firmware lookup needs the ArduConfigurator desktop app — the browser can’t reach firmware.ardupilot.org. Pick a local .bin instead.'
        )
      }
      return {
        available: false,
        unavailableReason:
          'Online firmware lookup needs the ArduConfigurator desktop app (the browser can’t reach firmware.ardupilot.org). Pick a local .bin below.',
        findCandidates: unavailable,
        download: unavailable
      }
    }
    const list = bridge.listDronecanNode
    const download = bridge.download
    const releaseLabel = (releaseType: string): string => {
      if (releaseType === 'OFFICIAL') return 'Stable'
      if (releaseType === 'BETA') return 'Beta'
      if (releaseType === 'DEV') return 'Dev'
      if (releaseType.startsWith('STABLE-')) return releaseType.slice('STABLE-'.length)
      return releaseType
    }
    return {
      available: true,
      findCandidates: async (node) => {
        const boardId = dronecanNodeBoardId(node.hwVersion)
        if (boardId === undefined) {
          throw new Error(
            'This node hasn’t reported its hardware version yet — wait for its identity to fill in, then try again.'
          )
        }
        const result = await list(boardId)
        return result.entries.map((entry) => ({
          url: entry.url,
          versionLabel: entry.versionStr || 'unknown',
          releaseLabel: releaseLabel(entry.releaseType),
          platform: entry.platform || '',
          boardId: entry.boardId,
          latest: entry.latest
        }))
      },
      download: async (candidate) => {
        const apjBytes = await download(candidate.url)
        // The manifest serves AP_Periph firmware as .apj (JSON-wrapped, zlib
        // image). The node's bootloader writes raw bytes straight to flash
        // (AP_Bootloader/can.cpp), so decode to the raw image here.
        const parsed = parseApj(new TextDecoder().decode(apjBytes))
        const image = await decodeApjImage(parsed, inflateZlib)
        const fileName = candidate.url.split('/').slice(-2).join('/')
        return { fileName, image }
      }
    }
  }, [])
  // Human label for the current selection, used across preset notices/messages.
  const selectedPresetsLabel =
    selectedPresets.length === 0
      ? 'No preset selected'
      : selectedPresets.length === 1
        ? `Preset "${selectedPresets[0].label}"`
        : `${selectedPresets.length} presets (${selectedPresets.map((preset) => preset.label).join(', ')})`
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
    outputAssignmentInvalidDrafts,
    relayDraftEntries,
    relayStagedDrafts,
    relayInvalidDrafts
  } = useViewDraftSelectors({ parameterDraftEntries, isConfigParamId })

  // Drop drafts that match the live value once a FRESH parameter sync lands.
  //
  // An 'unchanged' draft (one edited back to the live value) is kept on screen
  // on purpose: removing it the instant it matched used to yank the input out
  // from under the operator mid-edit. But after a reboot or a Refresh, nobody
  // is mid-edit, and a draft that equals the controller's value can never
  // write — it just sits in the review reading "matches current — won't write"
  // with 0 STAGED, and the only way to clear it is to hunt for its Drop.
  //
  // A completed sync is the natural boundary: keyed on requestedAtMs so it
  // fires once per sync, not on every snapshot.
  const prunedSyncRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const requestedAtMs = snapshot.parameterStats.requestedAtMs
    if (snapshot.parameterStats.status !== 'complete' || requestedAtMs === undefined) {
      return
    }
    if (prunedSyncRef.current === requestedAtMs) {
      return
    }
    prunedSyncRef.current = requestedAtMs
    const matchingLive = parameterDraftEntries
      .filter((entry) => entry.status === 'unchanged')
      .map((entry) => entry.id)
    if (matchingLive.length > 0) {
      clearDrafts(matchingLive)
    }
  }, [snapshot.parameterStats.status, snapshot.parameterStats.requestedAtMs, parameterDraftEntries, clearDrafts])

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
  // OSD message shorthand table (fork @OSD/shorthand.dat) — detected over MAVFTP
  // when the OSD tab is open on a fork FC; drives the Messages-section editor.
  const osdShorthand = useOsdShorthand({
    runtime,
    active: activeViewId === 'osd',
    connected: snapshot.connection.kind === 'connected'
  })
  const {
    vtxEnableParameter,
    vtxFrequencyParameter,
    vtxPowerParameter,
    vtxMaxPowerParameter,
    vtxOptionsParameter
  } = useVtxCatalog(snapshot)
  const receiverSupportCatalog = useReceiverSupportCatalog(snapshot, editedValues)
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
    altHoldPilotParameters,
    loiterPilotParameters,
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
  // Relay tab: one card per reported RELAYx instance, grouped from the live
  // snapshot. Edits flow through the shared relay draft scope (isRelayParamId).
  const relayGroups = useMemo(() => buildRelayGroups(snapshot.parameters), [snapshot.parameters])
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
  // Drive the motor-test diagram off the REAL frame (FRAME_CLASS/FRAME_TYPE) so
  // an H-frame/hexa/Y6/etc. shows its own geometry and prop directions, not a
  // hardcoded quad-X. Empty until the frame params are known — the diagram then
  // renders a "connect to read your frame" prompt rather than a guessed shape.
  const motorPreviewNodes = useMemo(
    () =>
      createMotorPreviewNodes(motorPreviewCount, airframe.frameTypeLabel, {
        classValue: airframe.frameClassValue,
        typeValue: airframe.frameTypeValue
      }),
    [airframe.frameClassValue, airframe.frameTypeValue, airframe.frameTypeLabel, motorPreviewCount]
  )
  const motorPreviewFrameKnown =
    airframe.frameClassValue !== undefined && airframe.frameTypeValue !== undefined
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
    const ids = new Set<string>(['SERVO_BLH_RVMASK', 'SERVO_DSHOT_ESC'])
    effectiveMotorOutputs.forEach((output) => ids.add(output.paramId))
    return ids
  }, [effectiveMotorOutputs])
  const motorReorderDialogStagedDrafts = useMemo(
    () => stagedParameterDrafts.filter((draft) => motorReorderDialogParamIds.has(draft.id)),
    [stagedParameterDrafts, motorReorderDialogParamIds]
  )
  // "Save changes" completion: the drafts staged by handleSaveMotorReorder are
  // only visible here on the following render, so the write is deferred to this
  // effect rather than chained inline where it would see a stale empty list.
  useEffect(() => {
    if (!pendingMotorReorderSave || motorReorderDialogStagedDrafts.length === 0) {
      return
    }
    setPendingMotorReorderSave(false)
    void (async () => {
      await handleApplyScopedParameterDrafts(motorReorderDialogStagedDrafts, 'motor-reorder:apply', 'Motor setup')
      await handleGuidedAction('reboot-autopilot')
    })()
    // handleApplyScopedParameterDrafts / handleGuidedAction are stable function
    // declarations on the component body; re-running on their identity would
    // fire the write on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMotorReorderSave, motorReorderDialogStagedDrafts])
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
  // Networking (NET_*) — the whole surface is metadata-driven scoped fields, so
  // it reuses the additional-settings scope like the other param-group views.
  const {
    groups: networkingGroups,
    entries: networkingDraftEntries,
    staged: networkingStagedDrafts,
    invalid: networkingInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'networking',
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
    excludedCategoryIds: SERVO_ADDITIONAL_EXCLUDED_CATEGORY_IDS,
    parameterDraftEntries
  })
  const {
    groups: gimbalGroups,
    entries: gimbalDraftEntries,
    staged: gimbalStagedDrafts,
    invalid: gimbalInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'motors',
    includedCategoryIds: GIMBAL_CATEGORY_IDS,
    parameterDraftEntries
  })
  const {
    groups: flowLidarGroups,
    entries: flowLidarDraftEntries,
    staged: flowLidarStagedDrafts,
    invalid: flowLidarInvalidDrafts
  } = useAdditionalScope({
    snapshot,
    metadataCatalog,
    viewId: 'motors',
    includedCategoryIds: FLOW_LIDAR_CATEGORY_IDS,
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
    // selectedParameterId now drives the inline row EXPANSION in the Parameters
    // table. Collapse the expanded row if it scrolls out of the current filter
    // (e.g. the search no longer matches it) — but never auto-EXPAND a row the
    // operator didn't click, so a plain search doesn't pop a detail open.
    if (selectedParameterId && !filteredParameters.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(undefined)
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
    // Connecting again re-arms the auto-resume loop that a deliberate
    // disconnect stood down.
    intentionalDisconnectRef.current = false
    setBusyAction('connect')
    try {
      setSessionNotice(undefined)
      // Web Serial: an ArduPilot board with CAN exposes MAVLink + SLCAN as two
      // ports sharing one VID/PID, indistinguishable by metadata. When several
      // are granted, probe for the one streaming heartbeats and select it, so a
      // connect can't land on the silent SLCAN interface. Best-effort: any
      // failure falls through to the normal connect (and the no-heartbeat
      // message guides the operator to the other port).
      if (transportMode === 'web-serial') {
        try {
          const grantedPorts = await getAvailableWebSerialPorts()
          if (grantedPorts.length > 1) {
            const { mavlinkPort } = await detectMavlinkPort(grantedPorts, 115200)
            if (mavlinkPort) {
              selectedSerialPortRef.current = mavlinkPort
              rememberSelectedSerialPort(mavlinkPort)
            }
          }
        } catch {
          // detection is best-effort; proceed with the existing selection.
        }
      }
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

  // Open the browser's serial-port picker so the operator can grant or switch to
  // a different port — the fix for "can't get back to choose a port" and for
  // landing on the SLCAN interface. The MAVLink port is auto-detected at connect
  // once more than one is granted.
  // Enable the CAN bus for DroneCAN (CAN_P1_DRIVER=1, CAN_D1_PROTOCOL=1) from
  // the CAN tab's prompt when a DroneCAN peripheral is selected but the bus is
  // off. Verified write + auto-backup + reboot follow-up (both params are
  // @RebootRequired), mirroring the preset-apply path.
  async function handleEnableCanBus(): Promise<void> {
    if (!runtime) {
      return
    }
    const writes = deriveCanEnablement(runtime.getSnapshot()).writes
    if (writes.length === 0) {
      return
    }
    const autoBackup = createSavedSnapshot(
      createParameterBackup(runtime.getSnapshot()),
      'Before enabling CAN bus',
      'captured',
      { note: 'Auto-saved before enabling the CAN bus for DroneCAN.', tags: ['auto-backup', 'can-enable'] }
    )
    setSavedSnapshots((current) => [autoBackup, ...current.filter((entry) => entry.id !== autoBackup.id)])
    setBusyAction('can:enable')
    try {
      const result = await runtime.setParameters(writes, UI_PARAMETER_WRITE_OPTIONS)
      setParameterFollowUp({
        requiresReboot: true,
        refreshRequired: true,
        changedCount: result.applied.length,
        text: `Enabled the CAN bus for DroneCAN (${result.applied.length} write(s)). Reboot the flight controller, then pull parameters — DroneCAN nodes appear after the reboot.`
      })
    } catch (error) {
      setSessionNotice({
        tone: 'danger',
        text: `Failed to enable the CAN bus: ${error instanceof Error ? error.message : 'unknown error'}. Pre-write snapshot "${autoBackup.label}" was saved.`
      })
    } finally {
      setBusyAction((current) => (current === 'can:enable' ? undefined : current))
    }
  }

  async function handleChooseSerialPort(): Promise<void> {
    const serial = getWebSerialNavigator()
    if (!serial) {
      return
    }
    try {
      const port = await serial.requestPort()
      selectedSerialPortRef.current = port
      rememberSelectedSerialPort(port)
      setSessionNotice(undefined)
    } catch {
      // Picker dismissed — keep the current selection.
    }
  }

  async function handleDisconnect(): Promise<void> {
    // A deliberate disconnect cancels any in-flight reboot reconnect so the
    // loop can't fight the operator by re-opening the link they just closed.
    expectRebootReconnectRef.current = false
    rebootReconnectingRef.current = false
    watchdogResumingRef.current = false
    intentionalDisconnectRef.current = true
    setBusyAction('disconnect')
    try {
      setSessionNotice(undefined)
      await runtime.disconnect()
      // Closing the link on purpose means a clean slate: the retained table and
      // its "link lost" banner only make sense for a link that went away on its
      // own (a watchdog reset), not one the operator just closed.
      runtime.discardRetainedParameters()
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
        // Re-pull parameters on every reboot. Web-serial re-pulls via its
        // reconnect effect (the link drops then comes back). On link-persistent
        // transports (desktop bridge / SITL) the browser link stays up across
        // the FC reboot, so the reconnect path never fires — re-request here. A
        // short delay lets the FC drop off first; requestParameterList then
        // retries through the reboot gap until the firmware answers fresh values.
        if (transportMode !== 'web-serial') {
          void (async () => {
            await new Promise((resolve) => setTimeout(resolve, 3000))
            try {
              await runtime.requestParameterList({ fresh: true })
              setParameterFollowUp((current) =>
                current?.refreshRequired && !current.requiresReboot ? undefined : current
              )
            } catch {
              // Link dropped (e.g. a SITL socket) — a manual reconnect re-pulls.
            }
          })()
        }
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
    const performScroll = (attemptsLeft = 8) => {
      const target = document.getElementById(scrollTargetId)
      if (!target) {
        // The target view may still be painting (the Receiver/Motors views are
        // heavy). Retry across a few frames instead of silently no-op'ing.
        if (attemptsLeft > 0) {
          requestAnimationFrame(() => performScroll(attemptsLeft - 1))
        }
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
    // The wizard now lives on its own 'guided-setup' tab (not the 'setup'
    // overview). setupMode stays the "flow active" flag so a detour into an
    // exercise view (receiver/motors) can bounce back here.
    setActiveViewId('guided-setup')
    setSetupMode('wizard')
  }

  function closeSetupWizard(): void {
    setPendingSetupWizardFocusId(undefined)
    setSetupMode('overview')
    // "Back to Setup" returns to the Status & Info dashboard tab.
    setActiveViewId('setup')
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
    if (activeViewId !== 'guided-setup' || setupMode !== 'wizard' || !pendingSetupWizardFocusId) {
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
    setActiveViewId('guided-setup')
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

  // Fetch the FC's packed defaults (MAVFTP param.pck?withdefaults, 4.5+) and
  // derive the non-default set that drives "Show only changed" + the non-default
  // export. Parse is pure (parseParamPck); the flag on each entry IS the
  // non-default signal, so no value/default comparison is needed here.
  /**
   * Pull the FC's defaults the first time a parameter row is expanded.
   *
   * Defaults previously loaded only as a side effect of switching on the
   * "changed only" filter, and then only when a row was expanded, so the
   * Default column sat empty for anyone who just opened the view. A ref guard makes this fire at most
   * once per session: the fetch is a MAVFTP transfer, and a firmware that
   * cannot serve it (pre-4.5, or no MAVFTP) must not be re-asked on every
   * click. The explicit filter toggle still retries on demand.
   */
  const autoFetchedDefaultsRef = useRef(false)
  /** Silent auto-fetches attempted for the current build before giving up. */
  const defaultsAttemptsRef = useRef(0)

  /**
   * Drop the cached defaults when the thing they describe changes.
   *
   * Defaults are a property of the BUILD, not of the session, and they were
   * fetched at most once and then kept forever — the auto-fetch ref latched
   * true and the map stayed non-null. Reconnect to a different aircraft, or
   * flash a build whose compiled-in default differs, and the Parameters table
   * kept showing the old build's default and marking rows "changed" against it.
   *
   * Keyed on firmware + board rather than on connection state alone, so a flash
   * within one session invalidates too. Clearing on disconnect also means a
   * reconnect re-reads rather than trusting a map from another vehicle.
   */
  const defaultsIdentity = paramDefaultsIdentity(snapshot)
  const lastDefaultsIdentityRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const previous = lastDefaultsIdentityRef.current
    lastDefaultsIdentityRef.current = defaultsIdentity
    // Only a move BETWEEN known identities (or a disconnect) means the cached
    // map describes something else. Going from "not identified yet" to
    // identified is the same vehicle finishing its handshake — treating that as
    // a change threw away a fetch that had just succeeded, which is how a fresh
    // connect ended up with no defaults at all.
    if (previous === undefined || previous === defaultsIdentity) {
      return
    }
    autoFetchedDefaultsRef.current = false
    defaultsAttemptsRef.current = 0
    setParameterDefaults(null)
    setNonDefaultParamIds(null)
  }, [defaultsIdentity])

  useEffect(() => {
    if (
      // Opening the Parameters view is enough. Waiting for a row to be expanded
      // meant the Default column read "—" on every row until the operator
      // happened to open one — a column that looks broken rather than one that
      // is loading. It is a single 15 KB MAVFTP read, once per build.
      (activeViewId !== 'parameters' && selectedParameterId === undefined) ||
      parameterDefaults !== null ||
      autoFetchedDefaultsRef.current ||
      fetchDefaultsBusy ||
      snapshot.connection.kind !== 'connected' ||
      // Wait for the board to identify itself. Fetching first only to have the
      // result invalidated the moment identity lands is wasted MAVFTP traffic
      // at the busiest moment of a connection.
      defaultsIdentity === undefined ||
      snapshot.parameterStats.status !== 'complete'
    ) {
      return
    }
    autoFetchedDefaultsRef.current = true
    void handleFetchParamDefaults({ silent: true })
    // handleFetchParamDefaults is a stable function declaration on the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeViewId,
    selectedParameterId,
    parameterDefaults,
    fetchDefaultsBusy,
    defaultsIdentity,
    snapshot.connection.kind,
    snapshot.parameterStats.status
  ])

  async function handleFetchParamDefaults(options: { silent?: boolean } = {}): Promise<void> {
    setFetchDefaultsBusy(true)
    try {
      const result = parseParamPck(await runtime.downloadParamPack())
      if (!result.withDefaults) {
        setNonDefaultParamIds(new Set())
        setParameterDefaults(null)
        if (!options.silent) {
          setParameterNotice({
            tone: 'warning',
            text: 'This firmware returned params without default flags — update to ArduPilot 4.5+ to use the "changed only" filter.'
          })
        }
        return
      }
      setNonDefaultParamIds(result.nonDefaultParamIds)
      setParameterDefaults(result.defaultsByParamId)
      if (options.silent) {
        // Opening a row asked for a Default line, not a filter change or a
        // banner — populate quietly and leave the view as the operator left it.
        return
      }
      setShowOnlyNonDefault(true)
      setParameterNotice({
        tone: 'neutral',
        text: `Defaults fetched: ${result.nonDefaultParamIds.size} of ${result.entries.length} params differ from firmware default.`
      })
    } catch (error) {
      // A silent pull was speculative — the operator expanded a row, they did
      // not ask for a MAVFTP transfer. A board that cannot serve defaults just
      // shows no Default line rather than an error they did not provoke.
      if (!options.silent) {
        setParameterNotice({
          tone: 'danger',
          text: `Couldn't fetch packed defaults over MAVFTP (needs a MAVFTP-capable FC on ArduPilot 4.5+): ${
            error instanceof Error ? error.message : String(error)
          }`
        })
      }
      // Let a later attempt through. The auto-fetch latch was set before the
      // transfer began, so without this ONE failed pull — a MAVFTP timeout
      // during the crowded moments after connect is enough — meant no defaults
      // for the rest of the session. The attempt budget still stops a board
      // that genuinely cannot serve them from being asked on every click.
      defaultsAttemptsRef.current += 1
      if (defaultsAttemptsRef.current < MAX_DEFAULTS_FETCH_ATTEMPTS) {
        autoFetchedDefaultsRef.current = false
      }
    } finally {
      setFetchDefaultsBusy(false)
    }
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
    setScopedWriteProgress({ completed: 0, total: stagedDrafts.length, scopeLabel })
    try {
      const rebootRequiredCount = stagedDrafts.filter((entry) => entry.definition?.rebootRequired).length
      // Write AP_PARAM_FLAG_ENABLE gates (e.g. RCL<n>_FUNC) before their
      // dependent sub-params. setParameters is serial and confirms each readback
      // before the next, so ordering the gate first means its term is live by
      // the time MIN/MAX/OPT/SRC are written — otherwise those race a disabled,
      // non-echoing sub-tree and each burns the full verify timeout.
      const orderedDrafts = orderDraftsByEnableGate(stagedDrafts)
      const result = await runtime.setParameters(
        orderedDrafts.map((entry) => ({
          paramId: entry.id,
          paramValue: entry.nextValue as number
        })),
        UI_PARAMETER_WRITE_OPTIONS,
        (progress) => setScopedWriteProgress({ completed: progress.completed, total: progress.total, scopeLabel })
      )
      appliedParamIds.push(...result.applied.map((entry) => entry.paramId))
      markParametersWritten(result.applied.map((entry) => entry.paramId))
      setParameterNotice({
        tone: result.unconfirmed.length > 0 ? 'warning' : 'success',
        text:
          (result.applied.length === 0 && result.unconfirmed.length === 0
            ? `No ${scopeLabel.toLowerCase()} changes needed to be written.`
            : `Verified ${result.applied.length} ${scopeLabel.toLowerCase()} change(s) from this view.`) +
          describeUnconfirmedWrites(result.unconfirmed)
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
          await runtime.requestParameterList({ fresh: true })
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

      setScopedWriteProgress(undefined)
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

  // Bind the RC receiver (ELRS/CRSF). Sends MAV_CMD_START_RX_PAIR; ArduPilot
  // forwards the bind command to the active RC protocol's receiver. Fire-and-
  // forget — the FC doesn't report RX-side bind completion, so we just confirm
  // the request and tell the operator to put their transmitter in bind mode.
  async function handleBindReceiver(): Promise<void> {
    if (!runtime) {
      return
    }
    try {
      await runtime.startReceiverBind()
      setSessionNotice({
        tone: 'neutral',
        text: 'Receiver bind requested — put your ELRS/CRSF transmitter or module into bind mode; the receiver LED confirms when it pairs.'
      })
    } catch (error) {
      setSessionNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to send the receiver bind command.'
      })
    }
  }

  async function handleApplyAllParameterDrafts(): Promise<void> {
    if (!canApplyAllDraftParameters) {
      return
    }

    const appliedParamIds: string[] = []
    setBusyAction('param:apply-all')
    // Order by enable-gate so an AP_PARAM_FLAG_ENABLE param (e.g. RCLn_FUNC) is
    // written before its dependent sub-params — the scoped apply path does this,
    // and the RC Mixer's RCL drafts only reach the FC through this global bar.
    const writeRequests = orderDraftsByEnableGate(stagedParameterDrafts)
      .filter((draft) => draft.nextValue !== undefined)
      .map((draft) => ({
        paramId: draft.id,
        paramValue: draft.nextValue as number
      }))
    setApplyAllProgress({ completed: 0, total: writeRequests.length })
    // The FC's own parameter total, before the batch. Compared afterwards to
    // tell "this write opened a sub-tree" from "this write only changed values".
    const totalParametersBefore = runtime.getSnapshot().parameterStats.total
    try {
      const applyingRebootRequiredCount = stagedParameterDrafts.filter((draft) => draft.definition?.rebootRequired).length
      const result = await runtime.setParameters(
        writeRequests,
        UI_PARAMETER_WRITE_OPTIONS,
        (progress) => setApplyAllProgress({ completed: progress.completed, total: progress.total })
      )
      appliedParamIds.push(...result.applied.map((entry) => entry.paramId))
      markParametersWritten(result.applied.map((entry) => entry.paramId))
      setParameterNotice({
        tone: result.unconfirmed.length > 0 ? 'warning' : 'success',
        text:
          (result.applied.length === 0 && result.unconfirmed.length === 0
            ? 'No staged parameter changes needed to be written.'
            : `Verified ${result.applied.length} staged parameter change(s).`) +
          describeUnconfirmedWrites(result.unconfirmed)
      })
      // Re-pull the table only when the write actually changed its shape. The
      // written values themselves need no re-read — every one was verified by
      // its PARAM_VALUE echo — so a batch of plain value edits (EK3_SRC*, PIDs)
      // skips a ~1300-param download it can learn nothing from. Enabling a
      // sub-tree (TCAL, a CAN driver, a battery monitor) changes the FC's
      // reported total, and that is what triggers the pull.
      const resync = decidePostWriteResync({
        totalBefore: totalParametersBefore,
        totalAfter: runtime.getSnapshot().parameterStats.total,
        rebootRequiredCount: applyingRebootRequiredCount,
        appliedCount: result.applied.length
      })
      setParameterFollowUp({
        requiresReboot: applyingRebootRequiredCount > 0,
        refreshRequired: resync.resync,
        changedCount: result.applied.length,
        text:
          applyingRebootRequiredCount > 0
            ? `${applyingRebootRequiredCount} applied change(s) are marked as reboot-required. Request a reboot, then refresh parameters before continuing setup.`
            : resync.resync
              ? 'The board’s parameter list changed — refreshing the snapshot…'
              : 'Parameter values written and verified.'
      })
      if (resync.resync) {
        try {
          await runtime.requestParameterList({ fresh: true })
          await runtime.waitForParameterSync()
          setParameterFollowUp((current) => (current?.refreshRequired && !current.requiresReboot ? undefined : current))
        } catch {
          // Non-fatal — leave the bit for manual Refresh.
        }
      } else if (applyingRebootRequiredCount === 0) {
        // Nothing to wait for; don't leave a follow-up bar asking for a refresh
        // that is not needed.
        setParameterFollowUp(undefined)
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

    // Auto-backup the live config before a provisioning overwrite — the preset
    // and AI-assisted apply paths both snapshot first, so a bulk fleet/template
    // apply gets the same undo safety net (batch rollback only covers a mid-write
    // failure, not a "restore what I had before" after a successful apply).
    const provisioningBackup = createSavedSnapshot(
      createParameterBackup(snapshot),
      `Before provisioning — ${selectedProvisioningProfile.label}`,
      'captured',
      {
        note: `Auto-saved before applying provisioning profile "${selectedProvisioningProfile.label}".`,
        tags: ['auto-backup', 'provisioning']
      }
    )
    setSavedSnapshots((current) => [provisioningBackup, ...current.filter((entry) => entry.id !== provisioningBackup.id)])

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

    replaceDrafts(filteredSnapshotRestoreDraftValues)
    setSelectedParameterId(selectedSnapshotChangedEntries[0]?.id ?? selectedParameterId)
    setActiveViewId('parameters')
    setSnapshotNotice({
      tone: 'warning',
      text: `Loaded ${selectedSnapshotChangedEntries.length} snapshot change(s) into the Expert parameter editor draft set.`
    })
  }

  // "Stage All" — snapshot restore now STAGES the diff into the shared draft
  // set (matching the Parameters tab) rather than writing straight to the FC.
  // The write happens from the global draft bar's "Write all", the one verified,
  // readback-checked, rollback-on-failure path the whole app shares.
  function handleApplySelectedSnapshotRestore(): void {
    if (!selectedSnapshot) {
      return
    }

    if (!snapshotRestoreAcknowledged) {
      setSnapshotNotice({
        tone: 'warning',
        text: 'Acknowledge the overwrite warning before staging a snapshot restore.'
      })
      return
    }

    // Force-invalid path: also stage the blocked (out-of-doc-range / outside-enum)
    // raw values as drafts. They land as INVALID drafts the operator completes
    // from the Parameters tab ("Override and write anyway") — same escape hatch
    // the raw editor uses — instead of a snapshot-local force-write.
    const forcedInvalidDraftValues: Record<string, string> = snapshotForceInvalid
      ? Object.fromEntries(
          selectedSnapshotInvalidEntries
            .map((entry): [string, string] | null => {
              const raw = entry.rawValue ?? (entry.nextValue !== undefined ? String(entry.nextValue) : undefined)
              return raw !== undefined && raw !== '' ? [entry.id, raw] : null
            })
            .filter((pair): pair is [string, string] => pair !== null)
        )
      : {}
    const stagedValues = { ...filteredSnapshotRestoreDraftValues, ...forcedInvalidDraftValues }
    const stagedCount = Object.keys(stagedValues).length
    if (stagedCount === 0) {
      setSnapshotNotice({
        tone: 'neutral',
        text: `Snapshot "${selectedSnapshot.label}" already matches the live controller values.`
      })
      return
    }

    mergeDrafts(stagedValues)
    setSnapshotRestoreAcknowledged(false)
    setSnapshotForceInvalid(false)
    setSnapshotNotice({
      tone: 'warning',
      text: `Staged ${stagedCount} snapshot change(s) as drafts. Review and Write all from the draft bar to apply them.`
    })
    trackAppEvent('Snapshot Restore Staged', {
      changedCount: stagedCount,
      forcedCount: Object.keys(forcedInvalidDraftValues).length
    })
  }

  function handleStageSelectedPresetDiff(): void {
    if (selectedPresets.length === 0) {
      return
    }

    if (selectedPresetApplicability.status === 'blocked') {
      setPresetNotice({
        tone: 'danger',
        text: selectedPresetApplicability.reasons[0] ?? 'A selected preset is not compatible with the current live configuration.'
      })
      return
    }

    if (effectivePresetChangedEntries.length === 0) {
      setPresetNotice({
        tone: 'neutral',
        text: `${selectedPresetsLabel}: nothing left to apply (every value matches the live tuning, or was dropped).`
      })
      return
    }

    mergeDrafts(effectivePresetDraftValues)
    setActiveViewId('tuning')
    setParameterNotice({
      tone: 'warning',
      text: `Loaded ${effectivePresetChangedEntries.length} preset change(s) into the Tuning view for manual review.`
    })
    setPresetNotice({
      tone: 'warning',
      text: `${selectedPresetsLabel} loaded into manual tuning drafts instead of being applied directly.`
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
    if (selectedPresets.length === 0) {
      return
    }

    if (!canApplyDraftParameters) {
      setPresetNotice({
        tone: 'warning',
        text: 'Connect, finish parameter sync, and keep the vehicle disarmed before applying presets.'
      })
      return
    }

    if (selectedPresetApplicability.status === 'blocked') {
      setPresetNotice({
        tone: 'danger',
        text: selectedPresetApplicability.reasons[0] ?? 'A selected preset is not compatible with the current live configuration.'
      })
      return
    }

    if (!presetApplyAcknowledged) {
      setPresetNotice({
        tone: 'warning',
        text: 'Review the diff and acknowledge the overwrite warning before applying.'
      })
      return
    }

    if (effectivePresetInvalidEntries.length > 0) {
      setPresetNotice({
        tone: 'danger',
        text: `${selectedPresetsLabel} has ${effectivePresetInvalidEntries.length} invalid value(s) in the current metadata set.`
      })
      return
    }

    if (effectivePresetChangedEntries.length === 0) {
      setPresetNotice({
        tone: 'neutral',
        text: `${selectedPresetsLabel}: nothing left to apply (every value matches the live tuning, or was dropped).`
      })
      return
    }

    // One pre-apply backup covers the whole combined write. For a single preset
    // keep the existing label/note; for a combined apply, summarize the set.
    const backupLabel =
      selectedPresets.length === 1
        ? buildPresetAutoBackupLabel(snapshot, selectedPresets[0])
        : `Pre-apply backup — ${selectedPresets.length} presets`
    const backupNote =
      selectedPresets.length === 1
        ? buildPresetAutoBackupNote(selectedPresets[0])
        : `Auto-saved before applying ${selectedPresetsLabel}.`
    const autoBackup = createSavedSnapshot(createParameterBackup(snapshot), backupLabel, 'captured', {
      note: backupNote,
      tags: [...PRESET_AUTO_BACKUP_TAGS, ...selectedPresets.flatMap((preset) => [...preset.tags, preset.id])]
    })
    setSavedSnapshots((current) => [autoBackup, ...current.filter((entry) => entry.id !== autoBackup.id)])

    setBusyAction('presets:apply')
    try {
      const rebootRequiredCount = effectivePresetChangedEntries.filter((entry) => entry.definition?.rebootRequired).length
      const result = await runtime.setParameters(
        // Order by enable-gate so a preset that both enables a subsystem and sets
        // its sub-params writes the ENABLE gate first (matches the scoped path).
        orderDraftsByEnableGate(effectivePresetChangedEntries)
          .filter((entry) => entry.nextValue !== undefined)
          .map((entry) => ({
            paramId: entry.id,
            paramValue: entry.nextValue as number
          })),
        UI_PARAMETER_WRITE_OPTIONS
      )
      setPresetNotice({
        tone: result.unconfirmed.length > 0 ? 'warning' : 'success',
        text:
          (result.applied.length === 0
            ? `${selectedPresetsLabel} already matched the live controller. Auto-saved snapshot "${autoBackup.label}".`
            : `Applied ${selectedPresetsLabel} with ${result.applied.length} verified write(s). Auto-saved snapshot "${autoBackup.label}".`) +
          describeUnconfirmedWrites(result.unconfirmed)
      })
      setParameterFollowUp({
        requiresReboot: rebootRequiredCount > 0,
        refreshRequired: true,
        changedCount: result.applied.length,
        text:
          rebootRequiredCount > 0
            ? `${selectedPresetsLabel} changed reboot-sensitive settings. Request a reboot, then pull parameters again before flying.`
            : `${selectedPresetsLabel} changed live tuning values. Pull parameters again if you want a clean post-write snapshot.`
      })
    } catch (error) {
      setPresetNotice({
        tone: 'danger',
        text: `${error instanceof Error ? error.message : `${selectedPresetsLabel} failed to apply.`} Pre-apply snapshot "${autoBackup.label}" was saved before any writes were attempted.`
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
    // This re-check MUST agree with the one that decided whether to enable the
    // button (`motorTestGuardReasons` above), in both directions:
    //
    //  - Without motorTestExpertOptions it is STRICTER, so an Expert-mode
    //    duration over 5 s lit the button and then returned silently here —
    //    no spin, no message, nothing to diagnose. The comment below about
    //    passing "the SAME expert options" was only ever true of the
    //    runMotorTest call, not of this guard.
    //  - Without the USB acknowledgement it is WEAKER, which is worse: the
    //    last gate before a motor spins would stop enforcing the bench
    //    confirmation that the display gate demands.
    const effectiveCoreGuardReasons = computeMotorTestGuardReasons(snapshot, effectiveRequest, {
      propsRemoved: propsRemovedAcknowledged,
      testAreaClear: testAreaAcknowledged
    }, motorTestExpertOptions)
    const effectiveGuardReasons =
      motorTestOverUsb && !usbBenchAcknowledged
        ? [...effectiveCoreGuardReasons, 'Confirm the craft is on the bench with props off (USB connection detected).']
        : effectiveCoreGuardReasons

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

    // Stage CH5/CH6 switch endpoints too, but only when actually exercised
    // (both ends seen) — never push endpoints for a switch the operator didn't
    // touch. Switches have no trim/centre.
    RC_CALIBRATION_SWITCH_CHANNELS.forEach((channelNumber) => {
      const capture = rcCalibrationSession.switchCaptures[channelNumber]
      if (!capture || !capture.lowObserved || !capture.highObserved) {
        return
      }
      if (capture.observedMin !== undefined) {
        nextDrafts[`RC${channelNumber}_MIN`] = String(Math.round(capture.observedMin))
      }
      if (capture.observedMax !== undefined) {
        nextDrafts[`RC${channelNumber}_MAX`] = String(Math.round(capture.observedMax))
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
    guidedReorderAdvanceInFlightRef.current = false
    setGuidedReorderActive(false)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderAwaitingSpin(false)
    setGuidedReorderCompleted(false)
  }

  // Spin one output of the guided-identify sequence. The FIRST motor is
  // always an explicit click, and any motor can be re-spun ("Spin again")
  // before picking a position. History worth keeping: an older flow auto-spun
  // the next motor on a 400 ms timer after each pick, which raced the FC's
  // still-running previous test (ArduPilot stays armed through it, so the
  // rushed follow-up was rejected with "the vehicle reports armed=true").
  // The advance-on-selection path avoids that by ENDING the previous test
  // first and waiting for the abort's ACK, not by waiting on a timer.
  //
  // Awaitable core of a guided spin, so the advance-on-selection path can
  // chain it behind a stop inside ONE busy window (the fire-and-forget
  // wrapper below would clear busyAction out from under the follow-up).
  // Resolves once the FC has ACKed the DO_MOTOR_TEST, not when the motor
  // finishes spinning.
  async function runGuidedReorderSpin(index: number): Promise<void> {
    const output = effectiveMotorOutputs[index]
    if (!output) {
      return
    }
    // Conservative cap — 2.5s window with low throttle so the operator
    // has time to see which motor moved without spinning long enough to
    // overheat anything bench-mounted with props off. In practice the
    // window is now cut short by the operator's answer.
    const request = buildMotorTestRequest(output.channelNumber, 6, 2.5)
    try {
      await runtime.runMotorTest(request as MotorTestRequest)
      setGuidedReorderAwaitingSpin(false)
    } catch (error) {
      // Surface the failure in the dialog so the operator sees WHY no
      // motor moved. MotorTestService also records failure in the
      // snapshot, but that's invisible from the dialog context.
      const message = error instanceof Error ? error.message : 'Motor test failed.'
      setMotorDialogSpinError(`OUT${output.channelNumber}: ${message}`)
    }
  }

  function spinGuidedReorderStep(index: number): void {
    if (!effectiveMotorOutputs[index]) {
      return
    }
    setMotorDialogSpinError(undefined)
    setBusyAction('motor-test')
    void runGuidedReorderSpin(index).finally(() => {
      setBusyAction(undefined)
    })
  }

  function handleSpinGuidedReorderCurrent(): void {
    if (!guidedReorderActive) {
      return
    }
    spinGuidedReorderStep(guidedReorderStep)
  }

  // FALLBACK auto-spin for the NEXT motor in the guided identify sequence.
  // The normal path is now handlePickGuidedReorderPosition, which stops the
  // answered motor and starts the next one directly; this effect only covers
  // an advance that reached 'awaiting spin' WITHOUT going through that path
  // (e.g. a re-spun window that lapsed unanswered). It fires only for steps
  // after the first (the operator kicks the sequence off with an explicit
  // Spin), only once the previous motor test has left the requested/running
  // window — i.e. the FC has stopped the last motor and will accept a fresh
  // DO_MOTOR_TEST — and never for a step the direct path already claimed via
  // autoSpunGuidedReorderStepRef. Safety acknowledgements are re-checked here,
  // so un-ticking props-off / area-clear mid-sequence pauses the auto-spin
  // instead of spinning a motor unattended.
  useEffect(() => {
    if (!guidedReorderActive) {
      autoSpunGuidedReorderStepRef.current = null
      return
    }
    if (!guidedReorderAutoSpin || !guidedReorderAwaitingSpin || guidedReorderStep === 0) {
      return
    }
    if (autoSpunGuidedReorderStepRef.current === guidedReorderStep) {
      return // already auto-spun this step — never double-fire (StrictMode / async)
    }
    const motorTestStatus = snapshot.motorTest.status
    if (motorTestStatus === 'requested' || motorTestStatus === 'running') {
      return // previous motor still spinning — wait for its window to close
    }
    if (busyAction !== undefined) {
      return
    }
    if (!propsRemovedAcknowledged || !testAreaAcknowledged) {
      return // safety gate — hold auto-spin until re-acknowledged
    }
    autoSpunGuidedReorderStepRef.current = guidedReorderStep
    spinGuidedReorderStep(guidedReorderStep)
    // spinGuidedReorderStep is a stable component-scope function; the primitive
    // deps below fully determine when an auto-spin should fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    guidedReorderActive,
    guidedReorderAutoSpin,
    guidedReorderAwaitingSpin,
    guidedReorderStep,
    snapshot.motorTest.status,
    busyAction,
    propsRemovedAcknowledged,
    testAreaAcknowledged
  ])

  function handleStartGuidedReorder(): void {
    if (effectiveMotorOutputs.length === 0) {
      return
    }
    if (!propsRemovedAcknowledged || !testAreaAcknowledged) {
      return
    }
    guidedReorderAdvanceInFlightRef.current = false
    autoSpunGuidedReorderStepRef.current = null
    setGuidedReorderActive(true)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderCompleted(false)
    // Operator-paced: wait for the explicit Spin click, even for OUT1.
    setGuidedReorderAwaitingSpin(true)
  }

  function handleCancelGuidedReorder(): void {
    guidedReorderAdvanceInFlightRef.current = false
    setGuidedReorderActive(false)
    setGuidedReorderStep(0)
    setGuidedReorderMapping({})
    setGuidedReorderAwaitingSpin(false)
    void runtime.stopMotorTest().catch(() => {})
  }

  /**
   * The operator answered "that position moved" — so the motor spinning right
   * now has done its job and every remaining millisecond of its window is dead
   * time. Stop it immediately and move on.
   *
   * Exact sequence on a selection, in this order and no other:
   *   1. Record the pick + advance the step (synchronous, so the picked
   *      position locks before any await and a repeat click can't re-answer).
   *   2. DO_MOTOR_TEST param1=1, throttle_type=PERCENT, throttle=0, duration=0
   *      — the same hardware-verified zero-throttle abort the Cancel/Stop path
   *      sends — and AWAIT its COMMAND_ACK.
   *   3. Only then start the next output's DO_MOTOR_TEST.
   *
   * The stop is awaited rather than fired-and-forgotten because the ACK is the
   * only evidence the FC took the abort, and the round trip is one link RTT
   * (bench-measured stop-to-idle: 1150 -> 1000 µs in 19 ms). ArduCopter's motor
   * test is single-state, so a new start would in fact replace the old one —
   * but that is a property of one firmware, not a stop, so it is not leaned on.
   * If the abort goes unacknowledged we start NOTHING and say so: the FC's own
   * per-motor timeout is still the hard safety net.
   */
  function handlePickGuidedReorderPosition(clickedMotorNumber: number): void {
    const plan = planGuidedIdentifyAdvance({
      active: guidedReorderActive,
      advanceInFlight: guidedReorderAdvanceInFlightRef.current,
      step: guidedReorderStep,
      outputChannels: effectiveMotorOutputs.map((output) => output.channelNumber),
      mapping: guidedReorderMapping,
      clickedMotorPosition: clickedMotorNumber,
      autoSpin: guidedReorderAutoSpin,
      // Re-read the acks at answer time: a run whose acknowledgement was
      // withdrawn mid-sequence stops the current motor but starts nothing.
      safetyAcknowledged: propsRemovedAcknowledged && testAreaAcknowledged
    })
    if (plan.kind === 'ignore') {
      return
    }

    setGuidedReorderMapping(plan.nextMapping)
    if (plan.kind === 'complete') {
      // All outputs identified. Invert the output→position identify map
      // into the reorder table's motor→output selections (pure + tested
      // in motor-reorder-mapping.ts), so Stage Reorder writes the
      // SERVOn_FUNCTION drafts that make every physical position drive
      // its expected motor number.
      setMotorReorderSelections(invertGuidedReorderMapping(plan.nextMapping))
      setGuidedReorderActive(false)
      setGuidedReorderStep(0)
      setGuidedReorderAwaitingSpin(false)
      // Unlocks the Stage button's primary emphasis and the
      // "no changes needed" note when the order already matches.
      setGuidedReorderCompleted(true)
    } else {
      setGuidedReorderStep(plan.nextStep)
      setGuidedReorderAwaitingSpin(true)
      if (plan.startStep !== undefined) {
        // Claim the step for the direct start so the status-gated auto-spin
        // effect can never fire a second DO_MOTOR_TEST for it.
        autoSpunGuidedReorderStepRef.current = plan.startStep
      }
    }

    const startStep = plan.kind === 'advance' ? plan.startStep : undefined
    guidedReorderAdvanceInFlightRef.current = true
    setMotorDialogSpinError(undefined)
    // One busy window covers stop + start, so nothing else (including the
    // Spin button) can inject a motor command between the two.
    setBusyAction('motor-test')
    void (async () => {
      try {
        const stopped = await runtime.stopMotorTest()
        if (stopped.sent && !stopped.acknowledged) {
          // Unproven stop — refuse to add a second motor command on top of an
          // FC state we cannot vouch for. Same surfacing as any other guided
          // spin failure so the operator sees why the sequence paused.
          setMotorDialogSpinError(
            'Stopping the spinning motor was not acknowledged, so the next motor was not started. The autopilot still stops it on its own timeout — check the motor is idle, then click Spin.'
          )
          return
        }
        if (startStep !== undefined) {
          await runGuidedReorderSpin(startStep)
        }
      } catch (error) {
        // stopMotorTest swallows a rejected abort into `acknowledged: false`,
        // so anything thrown here is unexpected — still never chain a start
        // onto it; report and stop the sequence.
        const message = error instanceof Error ? error.message : 'Stopping the motor test failed.'
        setMotorDialogSpinError(`${message} The next motor was not started.`)
      } finally {
        setBusyAction(undefined)
        guidedReorderAdvanceInFlightRef.current = false
      }
    })()
  }

  /**
   * Stage the identified motor order as parameter drafts.
   *
   * `keepDialogOpen` exists for the one-click "Save changes" finish: staging
   * normally closes the dialog and hands the operator off to Outputs to write,
   * which reads as two disjoint steps across two screens. The save path stages
   * and writes without ever leaving the dialog.
   */
  function handleStageMotorReorderDrafts(options: { keepDialogOpen?: boolean } = {}): number {
    if (!motorReorderCanStage) {
      return 0
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
    if (!options.keepDialogOpen) {
      setMotorReorderDialogOpen(false)
    }

    if (changedParamIds.length === 0) {
      setParameterNotice({
        tone: 'neutral',
        text: 'Motor output order already matches the selected layout.'
      })
      return 0
    }

    if (!options.keepDialogOpen) {
      setSelectedParameterId(changedParamIds[0] ?? selectedParameterId)
      setParameterNotice({
        tone: 'warning',
        text: `Staged ${changedParamIds.length} motor output remap change(s). Apply them from Outputs, then rerun the guarded motor direction check before flight.`
      })
    }
    return changedParamIds.length
  }

  /**
   * One-click finish for the guided identify run: stage the reorder and write
   * it without closing the dialog.
   *
   * The write cannot happen in this same tick — `motorReorderDialogStagedDrafts`
   * is derived from `stagedParameterDrafts`, which has not re-rendered yet, so
   * applying here would write a stale (usually empty) list. Instead this arms
   * `pendingMotorReorderSave` and an effect performs the write once the drafts
   * actually land, reusing the normal scoped-apply path so validation, notices
   * and rollback behave identically to the two-step flow.
   */
  function handleSaveMotorReorder(): void {
    const staged = handleStageMotorReorderDrafts({ keepDialogOpen: true })
    if (staged > 0) {
      setPendingMotorReorderSave(true)
    }
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
    // Receiver -> Functions task card counts (RCn_OPTION assignment).
    rcFunctionAssignedCount: receiverSupportCatalog.rcFunctionAssigned,
    rcFunctionConflictCount: receiverSupportCatalog.rcFunctionConflicts.length,
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
  // Staged starting-point values, for the task-card badge. Counted by id
  // membership rather than by re-running the calculation, so the badge does not
  // depend on what is currently typed into the form.
  // Firmware major from the reported version string; the filter parameters were
  // renamed between 3.x and 4.x and staging the wrong generation writes ids the
  // vehicle does not have. Unknown falls back to 4, which is what anything this
  // app connects to in practice runs.
  const initialTuneFirmwareMajor = useMemo(() => {
    const match = /(\d+)\./.exec(snapshot.vehicle?.firmware ?? '')
    const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4
  }, [snapshot.vehicle?.firmware])

  const initialTuneStagedCount = useMemo(
    () => Array.from(parameterDraftById.keys()).filter((id) => isInitialTuneParamId(id)).length,
    [parameterDraftById]
  )
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
        autotuneInvalidCount: copterAutotuneInvalidDrafts.length,
        autotuneStagedCount: copterAutotuneStagedDrafts.length,
        profileInvalidCount: selectedTuningProfileInvalidEntries.length,
        profileChangedCount: selectedTuningProfileChangedEntries.length,
        savedProfileCount: savedTuningProfiles.length,
        reviewInvalidCount: tuningInvalidDrafts.length,
        reviewStagedCount: tuningStagedDrafts.length,
        initialTuneStagedCount: initialTuneStagedCount
      }),
    [
      initialTuneStagedCount,
      tuningFilterInvalidDrafts.length,
      tuningFilterStagedDrafts.length,
      tuningInvalidDrafts.length,
      tuningPidInvalidDrafts.length,
      tuningPidStagedDrafts.length,
      tuningRateInvalidDrafts.length,
      tuningRateStagedDrafts.length,
      tuningStagedDrafts.length,
      copterAutotuneInvalidDrafts.length,
      copterAutotuneStagedDrafts.length,
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
        description={parameter.definition?.description}
        onStage={handleStageTuningParameterValue}
      />
    )
  }

  /**
   * Filter Editor control: the Tuning slider where a slider makes sense, the
   * generic metadata editor where it does not.
   *
   * TuningControl is always a slider + number, which is right for a filter
   * frequency and wrong for INS_HNTCH_MODE (an enum) or INS_HNTCH_OPTS (a
   * bitmask) -- dragging a slider through mode values, or through a bitmask,
   * produces states nobody meant to ask for. Those two fall through to the
   * shared metadata renderer, which gives a named list and per-bit toggles.
   * Both paths carry the same "i" bubble and wiki link.
   */
  // Live values for the filter helpers below the Filters grid. One map, built
  // once per parameter change, rather than one per helper per render.
  const filterLiveValues = useMemo(
    () => new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter.value])),
    [snapshot.parameters]
  )

  const renderFilterControl = (parameter: ParameterState): ReactNode => {
    const definition = parameter.definition
    const isChoice = definition?.bitmask === true || (definition?.options?.length ?? 0) > 0
    // INS_HNTCH_REF and INS_HNTCH_FM_RAT are AP_Float ratios in 0..1, not
    // frequencies: the values that matter are a measured hover thrust or
    // exactly 1, and neither is something you find by dragging. They get the
    // typed number field; the Hz filters keep the slider.
    const isRatio = parameter.id === 'INS_HNTCH_REF' || parameter.id === 'INS_HNTCH_FM_RAT'
    return isChoice || isRatio ? renderMetadataParameterField(parameter) : renderTuningControl(parameter)
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
  // Same expert options as every other gate — omitting them made the guided
  // identify button refuse Expert-mode durations the main Motor Test tab allows.
  const guidedMotorTestCoreGuardReasons = computeMotorTestGuardReasons(snapshot, guidedMotorTestRequest, {
    propsRemoved: propsRemovedAcknowledged,
    testAreaClear: testAreaAcknowledged
  }, motorTestExpertOptions)
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
    return resolveSetupConfirmationRecord({
      record: setupConfirmations[sectionId],
      signature: setupConfirmationSignatures[sectionId],
      // Signatures are derived from parameters; mid-sync they are meaningless
      // and must not be allowed to invalidate stored progress. See
      // setup-confirmation-resolve.ts.
      parameterSyncComplete: snapshot.parameterStats.status === 'complete'
    })
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
        escReviewConfirmed: Boolean(escReviewConfirmation),
        isCopterVehicle
      }),
    [
      airframe.expectedMotorCount,
      escReviewConfirmation,
      isCopterVehicle,
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
    ? (outputTaskOverride === 'servo-mapping' ||
       outputTaskOverride === 'peripherals' ||
       outputTaskOverride === 'gimbal' ||
       outputTaskOverride === 'flow-lidar' ||
       outputTaskOverride === 'relays'
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
        gimbalGroupCount: gimbalGroups.length,
        gimbalStagedDraftCount: gimbalStagedDrafts.length,
        gimbalInvalidDraftCount: gimbalInvalidDrafts.length,
        flowLidarGroupCount: flowLidarGroups.length,
        flowLidarStagedDraftCount: flowLidarStagedDrafts.length,
        flowLidarInvalidDraftCount: flowLidarInvalidDrafts.length,
        outputPeripheralStagedDraftCount,
        hasNotificationLedTypes: Boolean(notificationLedTypesParameter),
        hasNotificationBuzzTypes: Boolean(notificationBuzzTypesParameter),
        outputAdditionalGroupCount: outputAdditionalGroups.length,
        relayInstanceCount: relayGroups.length,
        relayStagedCount: relayStagedDrafts.length,
        relayInvalidCount: relayInvalidDrafts.length,
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
      relayGroups.length,
      relayStagedDrafts.length,
      relayInvalidDrafts.length,
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
        rcDirectionResults,
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
    rcDirectionResults,
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
  // Expert-only bootloader hash preview for the Flash tab's Update Bootloader
  // action. Reads nothing until the flasher arms the update and calls load().
  const bootloaderIdentity = useBootloaderIdentity(runtime, snapshot.connection.kind === 'connected')
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
    rcMixerFunctionCatalog,
    rcMixerFunctionLookup,
    rcMixerLivePwmByChannel,
    handleRcMixerAddAssignment,
    handleRcMixerRemoveAssignment,
    handleRcMixerUpdateAssignment
  } = useRcMixer(snapshot)
  // VTX band/frequency table (MAVFTP @VTX/vtxtable.dat). Detects lazily when the
  // VTX view opens; when present the view shows the real editable table,
  // otherwise the "Table not available" preview.
  const vtxTable = useVtxTable({
    runtime,
    // Also load on the RC Mixer view so a VTX_POWER term's level selector can
    // list the real @VTX power levels by mW.
    active: (activeViewId === 'osd' && osdVtxTab === 'vtx') || activeViewId === 'rc-mixer',
    connected: snapshot.connection.kind === 'connected'
  })
  // NET_ENABLE is present on every networking-capable ArduPilot build (Ethernet
  // or PPP), so its presence is the reliable "this FC does networking" sentinel.
  const hasNetworkingParams = useMemo(
    () => snapshot.parameters.some((parameter) => parameter.id === 'NET_ENABLE'),
    [snapshot.parameters]
  )
  // SCR_ENABLE only exists when the board's firmware was built with the Lua VM,
  // so its presence is the reliable "this FC can run scripts" sentinel that
  // gates the Expert-only Lua Scripts tab.
  const hasScriptingParams = useMemo(
    () => snapshot.parameters.some((parameter) => parameter.id === 'SCR_ENABLE'),
    [snapshot.parameters]
  )
  // SERIAL_PASS2 is the AP_SerialManager transparent USB↔UART bridge param —
  // its presence is the "this FC can passthru-flash an ELRS RX" sentinel that
  // gates the Expert-only ELRS Flash tab.
  const hasSerialPassthrough = useMemo(
    () => snapshot.parameters.some((parameter) => parameter.id === 'SERIAL_PASS2'),
    [snapshot.parameters]
  )

  // ELRS passthrough flasher (Expert + SERIAL_PASS2-gated tab). Slice A wires the
  // SERIAL_PASS bridge arm/teardown; esptool flashing over the reopened port is
  // the next slice.
  const [elrsFlasherBusy, setElrsFlasherBusy] = useState(false)
  const [elrsBridgeArmed, setElrsBridgeArmed] = useState(false)
  const [elrsFlasherNotice, setElrsFlasherNotice] = useState<ElrsFlasherNotice | undefined>(undefined)
  const [elrsFlashProgress, setElrsFlashProgress] = useState<ElrsFlashProgress | undefined>(undefined)
  async function handleArmElrsPassthrough(input: {
    destinationPort: number
    timeoutSeconds: number
    baudRate: number
  }): Promise<void> {
    setElrsFlasherBusy(true)
    setElrsFlasherNotice(undefined)
    try {
      await runtime.enableSerialPassthrough(input.destinationPort, { timeoutSeconds: input.timeoutSeconds })
      setElrsBridgeArmed(true)
      setElrsFlasherNotice({
        tone: 'warning',
        text: `Passthru enabled on Serial${input.destinationPort}. The bridge is open — choose the ELRS firmware .bin and flash the receiver below.`
      })
    } catch (error) {
      setElrsFlasherNotice({
        tone: 'danger',
        text: `Could not arm the pass-through bridge: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setElrsFlasherBusy(false)
    }
  }
  async function handleCancelElrsPassthrough(): Promise<void> {
    setElrsFlasherBusy(true)
    try {
      await runtime.setParameter('SERIAL_PASS2', -1)
      setElrsFlasherNotice({ tone: 'neutral', text: 'Bridge closed — SERIAL_PASS2 reset to disabled; MAVLink restored.' })
    } catch {
      setElrsFlasherNotice({
        tone: 'warning',
        text: 'Could not reset SERIAL_PASS2 over the link; the bridge auto-restores after the timeout.'
      })
    } finally {
      setElrsBridgeArmed(false)
      setElrsFlasherBusy(false)
    }
  }
  async function handleFlashElrs(input: {
    firmware: Uint8Array
    baudRate: number
    fileName: string
    bindPhrase?: string
  }): Promise<void> {
    const port = selectedSerialPortRef.current
    if (!port) {
      setElrsFlasherNotice({
        tone: 'warning',
        text: 'Receiver flashing needs a direct Web Serial connection (not demo/bridge). Reconnect over USB serial first.'
      })
      return
    }
    // Patch the options region (bind phrase → UID) before flashing, if requested.
    // A non-unified .bin throws here so we never write a corrupted image.
    let firmwareToFlash = input.firmware
    if (input.bindPhrase) {
      try {
        firmwareToFlash = patchElrsFirmwareOptions(input.firmware, { bindPhrase: input.bindPhrase })
      } catch (error) {
        setElrsFlasherNotice({
          tone: 'danger',
          text: `Could not set the bind phrase: ${error instanceof Error ? error.message : String(error)}`
        })
        return
      }
    }
    setElrsFlasherBusy(true)
    setElrsFlashProgress({ phase: 'bootloader', message: 'Preparing…' })
    try {
      // Release the MAVLink transport so esptool owns the raw port. The FC's
      // pass-through bridge stays up (armed above) until SERIAL_PASSTIMO.
      await runtime.disconnect().catch(() => {})
      const result = await flashElrsReceiver({
        port,
        firmware: firmwareToFlash,
        crsfBaud: input.baudRate,
        onProgress: (progress) => setElrsFlashProgress(progress)
      })
      setElrsFlasherNotice({
        tone: 'success',
        text: `Flashed ${result.chipName} with ${input.fileName}. Power-cycle the receiver, then reconnect to the flight controller.`
      })
      setElrsBridgeArmed(false)
    } catch (error) {
      setElrsFlasherNotice({
        tone: 'danger',
        text: `Flashing failed: ${error instanceof Error ? error.message : String(error)}. Power-cycle the receiver and reconnect before retrying.`
      })
    } finally {
      setElrsFlashProgress(undefined)
      setElrsFlasherBusy(false)
    }
  }
  // Lua Scripts view-model: scripting-capability gate + per-applet sanity, plus
  // the installed-file state machine (MAVFTP against /APM/scripts). The catalog
  // + capability logic is a pure builder (unit-tested); the hook owns the async
  // install/upload/remove/enable actions through the runtime's verified paths.
  const luaScriptsModel = useMemo(
    () => buildLuaScriptsViewModel({ params: snapshot.parameters, installedNames: [] }),
    [snapshot.parameters]
  )
  const luaScripts = useLuaScripts({
    runtime,
    connected: snapshot.connection.kind === 'connected',
    isActive: activeViewId === 'lua',
    scriptsDir: LUA_SCRIPTS_DIR,
    appletContents: LUA_APPLET_CONTENTS,
    catalog: LUA_APPLET_CATALOG,
    heapLow: luaScriptsModel.capability.heapLow,
    recommendedHeapBytes: luaScriptsModel.capability.recommendedHeapBytes,
    writeOptions: UI_PARAMETER_WRITE_OPTIONS
  })
  // Fold the live installed-file listing into the catalog cards so each card
  // knows whether its script is already on the SD card (Install vs Reinstall).
  const luaScriptCards = useMemo(
    () =>
      buildLuaScriptsViewModel({
        params: snapshot.parameters,
        installedNames: (luaScripts.installed ?? []).map((script) => script.name)
      }).cards,
    [snapshot.parameters, luaScripts.installed]
  )
  // AI Assistant controller. Reads live vehicle state through a snapshot
  // accessor (never the runtime directly), so its read-only tools always see the
  // current snapshot. e2e forces the offline 'mock' provider via ?aiProvider=mock
  // (dev/localhost only) so the tab can be exercised with no key and no network.
  const aiAssistantAccessor = useMemo(() => ({ getSnapshot: () => runtime.getSnapshot() }), [runtime])
  const aiForcedProvider = useMemo(() => {
    if (!canUseGuidedSetupTestingShortcut()) return undefined
    try {
      return new URLSearchParams(window.location.search).get('aiProvider') === 'mock'
        ? ('mock' as const)
        : undefined
    } catch {
      return undefined
    }
  }, [])
  // Applies an AI-proposed, human-approved batch of parameter changes. Mirrors
  // the preset apply path: auto-backup to Snapshots first (undo safety net),
  // then the verified batch write with rollback. The model can never call this —
  // it only runs from an explicit human click behind the acknowledge gate.
  const handleAiApplyProposal = useCallback(
    async (
      requests: ParameterWriteRequest[],
      onProgress?: (progress: ParameterBatchWriteProgress) => void
    ): Promise<ParameterBatchWriteResult> => {
      const backupSnapshot = runtime.getSnapshot()
      const autoBackup = createSavedSnapshot(createParameterBackup(backupSnapshot), 'Before AI-assisted changes', 'captured', {
        note: 'Auto-saved before applying AI Assistant proposed parameter changes.',
        tags: ['auto-backup', 'ai-assistant']
      })
      setSavedSnapshots((current) => [autoBackup, ...current.filter((entry) => entry.id !== autoBackup.id)])
      const result = await runtime.setParameters(requests, UI_PARAMETER_WRITE_OPTIONS, onProgress)
      if (result.applied.length > 0) {
        void runtime.requestParameterList({ fresh: true }).then(() => runtime.waitForParameterSync()).catch(() => undefined)
      }
      return result
    },
    [runtime, setSavedSnapshots]
  )
  const aiAssistant = useAiAssistant({
    accessor: aiAssistantAccessor,
    applyChanges: handleAiApplyProposal,
    forcedProviderId: aiForcedProvider
  })
  const aiTranscript = useMemo(() => buildTranscript(aiAssistant.messages), [aiAssistant.messages])
  const aiWriteBlockReason = useMemo(
    () =>
      resolveWriteBlockReason({
        connectionKind: snapshot.connection.kind,
        armed: snapshot.vehicle?.armed ?? false,
        syncStatus: snapshot.parameterStats.status
      }),
    [snapshot.connection.kind, snapshot.vehicle?.armed, snapshot.parameterStats.status]
  )
  // RCL_ENABLE is the AP_RC_Logic engine sentinel — present only on firmware that
  // compiled the RC logic / range-function engine. Its presence unlocks the real
  // RC Mixer editor; otherwise the tab stays a preview.
  const hasRcLogicParams = useMemo(
    () => snapshot.parameters.some((parameter) => parameter.id === 'RCL_ENABLE'),
    [snapshot.parameters]
  )
  // RC Mixer bound to the AP_RC_Logic engine (RCL_* params) when supported: the
  // model derives channel assignments from the RANGE terms, and edits stage as
  // parameter drafts that flow through the normal verified write path.
  const rcLogicModel = useMemo(
    () => readRcLogicModel(snapshot.parameters, editedValues),
    [snapshot.parameters, editedValues]
  )
  const rcLogicFunctionCatalogMemo = useMemo(() => orderRcMixerFunctionCatalog(rcLogicFunctionCatalog()), [])
  const rcLogicFunctionLookup = useMemo(
    () => buildRcMixerFunctionLookup(rcLogicFunctionCatalogMemo),
    [rcLogicFunctionCatalogMemo]
  )
  const rcLogicExcludedChannels = useMemo(() => derivePrimaryStickChannels(snapshot), [snapshot])
  // Remove on an ALREADY-APPLIED term only STAGES a FUNC=0 draft (same
  // stage-then-apply model every other RC Mixer edit uses) — readRcLogicModel
  // still reports the term as "touched" while that draft is pending, so the
  // row stayed visible after clicking Remove and looked like the button did
  // nothing. Hide it locally the instant Remove is clicked; the check
  // against editedValues (not just membership) means a term falls back out
  // of this set on its own once the draft is applied (cleared) or discarded
  // (reverted to a nonzero live func, at which point it belongs back on
  // screen) — no separate reset path needed.
  const [rcLogicRemovedTerms, setRcLogicRemovedTerms] = useState<ReadonlySet<number>>(() => new Set())
  const rcLogicVisibleAssignments = useMemo(
    () =>
      rcLogicModel.assignments.filter((assignment) => {
        const term = rcLogicTermFromAssignmentId(assignment.id)
        if (term === null || !rcLogicRemovedTerms.has(term)) {
          return true
        }
        return editedValues[rcLogicTermParamIds(term).func] !== '0'
      }),
    [rcLogicModel.assignments, rcLogicRemovedTerms, editedValues]
  )
  const rcLogicChannels = useMemo(
    () => groupAssignmentsByChannel(rcLogicVisibleAssignments, 16, rcLogicExcludedChannels),
    [rcLogicVisibleAssignments, rcLogicExcludedChannels]
  )
  // Cross-subsystem channel awareness (both directions):
  //  - external claims (flight-mode switch / RCn_OPTION aux funcs) badged in the
  //    RC Mixer so a channel already in use is visible before layering a term.
  //  - RCL-term claims surfaced back in the Receiver / Modes / arm-switch views.
  const externalChannelClaims = useMemo(() => deriveExternalChannelClaims(snapshot), [snapshot])
  const rcLogicChannelClaims = useMemo(
    () => deriveRcLogicChannelClaims(rcLogicVisibleAssignments),
    [rcLogicVisibleAssignments]
  )
  // Non-zero @VTX power levels in table order — a VTX_POWER RCL term's level
  // selector stores the 0-based index here into OPT bits 5-7. Use the DETECTED
  // (saved) table, not the editable draft: the RCL index resolves against what
  // the FC actually has, so unsaved VTX-table edits must not shift it.
  const rcMixerVtxPowerLevels = useMemo(
    () => deriveVtxPowerLevels(vtxTable.detected?.powerLevels),
    [vtxTable.detected]
  )
  // A slot freed by a prior remove stays in rcLogicRemovedTerms even after the
  // disable is applied (the Set is never pruned). Reusing that slot for a new
  // term would leave the new (FUNC=0) row hidden by the removed-term filter, so
  // clear the slot from the set when it's re-allocated.
  function unmarkRcLogicRemovedTerm(term: number | null): void {
    if (term === null) {
      return
    }
    setRcLogicRemovedTerms((current) => {
      if (!current.has(term)) {
        return current
      }
      const next = new Set(current)
      next.delete(term)
      return next
    })
  }
  function handleRcLogicAddAssignment(channel: number): void {
    const drafts = rcLogicAddDrafts(rcLogicModel, channel)
    if (!drafts) {
      setParameterNotice({
        tone: 'warning',
        text: 'All 12 RC logic terms are in use — remove one before adding another.'
      })
      return
    }
    unmarkRcLogicRemovedTerm(rcLogicModel.freeTermIndex)
    mergeDrafts(drafts)
  }
  function handleRcLogicUpdateAssignment(assignmentId: string, patch: Partial<RcMixerAssignment>): void {
    const term = rcLogicTermFromAssignmentId(assignmentId)
    if (term === null) {
      return
    }
    mergeDrafts(rcLogicUpdateDrafts(snapshot.parameters, editedValues, term, patch))
  }
  function handleRcLogicRemoveAssignment(assignmentId: string): void {
    const term = rcLogicTermFromAssignmentId(assignmentId)
    if (term === null) {
      return
    }
    const plan = rcLogicRemovePlan(snapshot.parameters, term)
    clearDrafts(plan.clear)
    if (Object.keys(plan.disable).length > 0) {
      mergeDrafts(plan.disable)
      // Disabling an already-applied term only stages a draft (same
      // stage-then-apply model as every other RC Mixer edit) — hide the row
      // immediately instead of leaving it visible until the operator applies
      // the global staged changes.
      setRcLogicRemovedTerms((current) => {
        const next = new Set(current)
        next.add(term)
        return next
      })
    }
  }
  // Condition/link terms for the Logic section, with the same removed-term
  // self-heal the channel assignments use.
  const rcLogicVisibleLogicTerms = useMemo(
    () =>
      rcLogicModel.logicTerms.filter((logicTerm) => {
        const term = rcLogicTermFromAssignmentId(logicTerm.id)
        if (term === null || !rcLogicRemovedTerms.has(term)) {
          return true
        }
        return editedValues[rcLogicTermParamIds(term).func] !== '0'
      }),
    [rcLogicModel.logicTerms, rcLogicRemovedTerms, editedValues]
  )
  function handleRcLogicAddLogicTerm(): void {
    const drafts = rcLogicAddLogicTermDrafts(rcLogicModel)
    if (!drafts) {
      setParameterNotice({
        tone: 'warning',
        text: 'All 12 RC logic terms are in use — remove one before adding another.'
      })
      return
    }
    unmarkRcLogicRemovedTerm(rcLogicModel.freeTermIndex)
    mergeDrafts(drafts)
  }
  function handleRcLogicUpdateLogicTerm(id: string, patch: Partial<RcLogicLogicTerm>): void {
    const term = rcLogicTermFromAssignmentId(id)
    if (term === null) {
      return
    }
    mergeDrafts(rcLogicUpdateLogicTermDrafts(snapshot.parameters, editedValues, term, patch))
  }
  function handleRcLogicToggleEngine(enabled: boolean): void {
    setDraft('RCL_ENABLE', enabled ? '1' : '0')
  }
  // Arm switch: writes plain RCn_OPTION directly (153, or 154 for the
  // AirMode variant) — independent of the AP_RC_Logic engine above, so it
  // works on every ArduPilot vehicle/firmware, not just the fork that ships
  // RCL_*. channel 0 means "None" (clear the current assignment).
  function handleSetArmSwitchChannel(channel: number, airmode: boolean): void {
    const targetChannel = channel === 0 ? undefined : channel
    mergeDrafts(armSwitchAssignmentDrafts(armSwitchAssignment, targetChannel, airmode))
  }
  // DroneNet: the Networking tab embeds a NET_-filtered DroneCAN node editor so a
  // peripheral's network settings are configurable without the CAN tab. Filtering
  // at the state level means the node list, param count, staged changes, and the
  // editor all restrict to NET_ automatically (CanBusView is unchanged).
  const networkCanBusState = useMemo(
    () => ({
      ...snapshot.canBus,
      nodes: snapshot.canBus.nodes.map((node) => ({
        ...node,
        parameters: node.parameters.filter((parameter) => parameter.name.startsWith('NET_'))
      }))
    }),
    [snapshot.canBus]
  )
  const [networkingTab, setNetworkingTab] = useState<NetworkingTab>('fc')
  // Opening the DroneNet tab auto-connects over CAN (starts the forward) so
  // peripherals are discovered without the operator hunting for a Start button.
  // The idle guard means it fires once; the CAN tab / Stop button still control it.
  useEffect(() => {
    if (
      activeViewId === 'networking' &&
      networkingTab === 'dronenet' &&
      snapshot.connection.kind === 'connected' &&
      snapshot.canBus.status === 'idle'
    ) {
      void runtime?.startCanBusForward(1)
    }
  }, [activeViewId, networkingTab, snapshot.connection.kind, snapshot.canBus.status, runtime])
  // On the DroneNet tab, auto-walk each discovered node's params once so its
  // network settings (incl. passthrough) populate without a manual "Re-fetch".
  // Guarded on idle + empty so it fires exactly once per node.
  useEffect(() => {
    if (activeViewId !== 'networking' || networkingTab !== 'dronenet' || snapshot.canBus.status !== 'active') {
      return
    }
    for (const node of snapshot.canBus.nodes) {
      if (node.paramFetch.status === 'idle' && node.parameters.length === 0) {
        runtime?.fetchAllCanBusParameters(node.nodeId)
      }
    }
  }, [activeViewId, networkingTab, snapshot.canBus.status, snapshot.canBus.nodes, runtime])
  // Friendly passthrough-row editors, one per DroneNet node that reports a
  // NET_PASSn_ block. Writes go over DroneCAN via the shared apply-and-save path.
  // Built from the FULL node params (not the NET_-filtered view) so the endpoint
  // dropdowns can be derived from the node's SERIALn_ / NET_Pn_ params.
  const dronenetPassthroughEditors = snapshot.canBus.nodes
    .map((node) => ({ node, blocks: groupPassthroughBlocks(node.parameters) }))
    .filter((entry) => entry.blocks.length > 0)
    .map(({ node, blocks }) => (
      <PassthroughEditor
        key={node.nodeId}
        nodeId={node.nodeId}
        nodeName={node.name ?? `node ${node.nodeId}`}
        blocks={blocks}
        endpointOptions={availablePassthroughEndpoints(
          node.parameters.map((parameter) => parameter.name),
          blocks.flatMap((block) => [block.ep1, block.ep2])
        )}
        busy={busyAction !== undefined}
        onApplyAndSave={(nodeId, writes) => { void runtime?.applyAndSaveCanBusParameters(nodeId, writes) }}
      />
    ))
  // --- CAN device inspectors (merged CAN tab + per-device popout windows) ---
  // The autopilot's own DroneCAN node id(s) (CAN_Dn_UC_NODE): such a node is the
  // FC itself and answers no DroneCAN param walk, so both the inline and the
  // popped-out inspector label it rather than showing an empty table.
  const canSelfNodeIds = [
    readRoundedParameter(snapshot, 'CAN_D1_UC_NODE'),
    readRoundedParameter(snapshot, 'CAN_D2_UC_NODE')
  ].filter((id): id is number => typeof id === 'number' && id > 0)
  // The SAME "enable CAN bus & reboot" offer the CAN tab makes, mirrored into
  // Servos ▸ Peripherals — but ONLY when the optical-flow driver is what fired
  // it (FLOW_TYPE = 6 / DroneCAN). A DroneCAN GPS is a real problem too, and the
  // CAN tab still says so; it just isn't this card's business to interrupt with.
  // Reason: a CAN sensor on a disabled bus reports absolutely nothing, so the
  // operator is looking straight at the flow config wondering why it's dead —
  // which is precisely where the one-click fix belongs.
  const opticalFlowCanEnablePrompt =
    canEnablement.needsEnable && canEnablement.triggerParamIds.includes('FLOW_TYPE') && runtime ? (
      <CanEnablePrompt
        triggerLabels={canEnablement.triggerLabels}
        onEnable={() => { void handleEnableCanBus() }}
        busy={busyAction === 'can:enable'}
        testId="peripherals-can-enable-prompt"
        buttonTestId="peripherals-can-enable-button"
      />
    ) : undefined
  // Popout windows live at App level so they survive a tab switch (see
  // use-can-device-popouts). They never touch CAN forwarding — the runtime's CAN
  // bus service keeps MAV_CMD_CAN_FORWARD re-armed for as long as the bus is
  // connected, no matter how many windows are watching it.
  const canDevicePopouts = useCanDevicePopouts()
  // Recent Notices reuses the SAME popout machinery as the CAN inspectors
  // (usePopoutWindows: gesture-synchronous window.open, stylesheet + theme
  // cloning, three-way reaping). A second independent instance rather than a
  // shared registry, because the two surfaces key their windows differently and
  // nothing about a notices window should be able to reap a device window.
  const noticesPopout = usePopoutWindows()
  const noticesPopoutHandle = noticesPopout.popouts.find((handle) => handle.key === NOTICES_POPOUT_KEY)
  // The destructive per-device actions, shared by the inline and popped-out
  // inspectors. Passed only under Expert mode — they used to be reachable solely
  // from the expert-only DroneCAN Inspector tab.
  const canDeviceExpertActions = useMemo(
    () => ({
      firmwareUpdate: snapshot.canBus.firmwareUpdate,
      onRestartNode: (nodeId: number) => { void runtime?.restartCanBusNode(nodeId) },
      onStartFirmwareUpdate: (nodeId: number, fileName: string, image: Uint8Array) => {
        void runtime?.startCanBusNodeFirmwareUpdate(nodeId, fileName, image)
      },
      onCancelFirmwareUpdate: () => { runtime?.cancelCanBusNodeFirmwareUpdate() },
      firmwareOnline: dronecanFirmwareOnline
    }),
    [snapshot.canBus.firmwareUpdate, runtime, dronecanFirmwareOnline]
  )
  const visibleAppViews = useMemo(
    () =>
      buildVisibleAppViews({
        appViews,
        isExpertMode,
        canBusStatus: snapshot.canBus.status,
        canBusBus: snapshot.canBus.bus,
        connectionKind: snapshot.connection.kind,
        hasNetworkingParams,
        hasRcLogicParams,
        hasScriptingParams,
        hasSerialPassthrough
      }),
    [
      appViews,
      isExpertMode,
      snapshot.canBus.status,
      snapshot.canBus.bus,
      snapshot.connection.kind,
      hasNetworkingParams,
      hasRcLogicParams,
      hasScriptingParams,
      hasSerialPassthrough
    ]
  )
  const activeViewDescriptor = visibleAppViews.find((view) => view.id === activeViewId) ?? visibleAppViews[0]
  function formatCategoryLabel(categoryId: string | undefined): string {
    if (!categoryId) {
      return 'Uncategorized'
    }

    return metadataCatalog.categoryById[categoryId]?.label ?? categoryId
  }

  // The Motor Setup sub-tab IS the reorder/direction panel (formerly a popout);
  // rendered inline (no lightbox chrome) straight into the tab body.
  function renderMotorSetupReorderPanel(): ReactNode {
    return (
      <MotorReorderDialog
        inline
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
        guidedReorderAutoSpin={guidedReorderAutoSpin}
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
        onToggleGuidedReorderAutoSpin={setGuidedReorderAutoSpin}
        onPickGuidedReorderPosition={handlePickGuidedReorderPosition}
        onStageReorderDrafts={() => handleStageMotorReorderDrafts()}
        onSaveReorder={handleSaveMotorReorder}
        onSpinSingleMotor={handleDialogSpinSingleMotor}
        setDraft={setDraft}
        motorReorderStagedCount={motorReorderDialogStagedDrafts.length}
        canApplyMotorDrafts={canApplyDraftParameters}
        rebootRecommended={parameterFollowUp?.requiresReboot ?? false}
        onApplyAndRebootMotorDrafts={() =>
          void (async () => {
            await handleApplyScopedParameterDrafts(motorReorderDialogStagedDrafts, 'motor-reorder:apply', 'Motor setup')
            await handleGuidedAction('reboot-autopilot')
          })()
        }
      />
    )
  }

  // ESC & DShot section footer: one-click "enable bidirectional DShot"
  // choreography + the hardware-capability warnings the generic field grid
  // can't express. Enabling bdshot stages it on the first 4 outputs
  // (BLH_BDMASK=0b1111) AND turns on BLHeli auto (BLH_AUTO=1), since AP needs
  // both; gated on a DShot protocol with a note that most boards only do
  // bdshot on the first 4 outputs (some do 8).
  function renderBoardOrientationFooter(): ReactNode {
    // Reflect the SELECTED orientation (staged draft if any, else live) so the
    // picture updates as the operator changes the dropdown, before Apply.
    const raw = editedValues.AHRS_ORIENTATION ?? readRoundedParameter(snapshot, 'AHRS_ORIENTATION')
    const value = raw === undefined || raw === '' ? undefined : Math.round(Number(raw))
    if (value === undefined || Number.isNaN(value)) {
      return null
    }
    const label = AHRS_ORIENTATION_OPTIONS.find((option) => option.value === value)?.label
    const visual = deriveBoardOrientationVisual(value, label)
    if (!visual) {
      return null
    }
    return <BoardOrientationDiagram visual={visual} testId="board-orientation-diagram" />
  }


  // Power moved off its own nav tab into a Config category. It keeps its own
  // panel wholesale — the battery-monitor selection, the live voltage/current
  // readout, and its own staged-change review with its own Apply — so this is a
  // fieldless section that exists purely to host it. Note that means two apply
  // scopes are visible together on this tab: Config's, and Power's own for the
  // battery params. That is the accepted trade of keeping the panel intact
  // rather than dissolving it into Config's field grid.
  /**
   * The flight-mode panel, formerly the top-level Modes tab.
   *
   * That tab overlapped Receiver's own Flight Modes sub-tab, so it is gone and
   * this renders inside Config instead. Receiver keeps its version untouched --
   * the two read and write the same parameters, so configuring modes from
   * either place is the same edit.
   */
  function renderFlightModesFooter(): ReactNode {
    return (
        <ModesView
          modeChannelLabel={configuredModeChannel !== undefined ? `CH${configuredModeChannel}` : 'Not configured'}
          modeChannelParamName={snapshot.vehicle?.vehicle === 'ArduRover' ? 'MODE_CH' : 'FLTMODE_CH'}
          modeChannelRcLogicClaim={configuredModeChannel !== undefined ? rcLogicChannelClaims.get(configuredModeChannel) : undefined}
          joystickModeNote={
            snapshot.vehicle?.vehicle === 'ArduSub'
              ? 'ArduSub selects modes via joystick button assignments (BTNn_FUNCTION), not an RC mode-switch channel — configure them in the Parameters view.'
              : undefined
          }
          currentSlotLabel={modeSwitchEstimate.estimatedSlot !== undefined ? `Slot ${modeSwitchEstimate.estimatedSlot}` : 'Waiting'}
          currentSlotSubtext={modeSwitchEstimate.pwm !== undefined ? `${modeSwitchEstimate.pwm} µs live` : 'No live RC input.'}
          activeModeLabel={snapshot.vehicle?.flightMode ?? 'Unknown'}
          slots={MODES_SLOT_DEFINITIONS.map((slot) => {
            const paramId = modeSlotParamId(snapshot.vehicle?.vehicle, slot.position)
            const paramValue = readRoundedParameter(snapshot, paramId)
            // Offer what the vehicle says it can fly, not just what the
            // catalogue knows — otherwise a fork's custom mode cannot be
            // assigned from this dropdown at all.
            const parameter = withFlightModeOptions(
              selectParameterById(snapshot, paramId),
              snapshot.availableModes
            )
            return {
              position: slot.position,
              pwmLabel: slot.pwmLabel,
              modeLabel: formatModeAssignment(paramValue, snapshot.vehicle?.vehicle, snapshot.availableModes),
              paramSynced: paramValue !== undefined,
              isActive: modeSwitchEstimate.estimatedSlot === slot.position,
              parameter
            }
          })}
          fiberModeAvailable={isFiberModeAvailable(snapshot)}
          editedValues={editedValues}
          draftStatusById={parameterDraftById}
          onChangeSlot={(paramId, value) => setDraft(paramId, value)}
          onOpenFlightModeTask={() => {
            setActiveViewId('receiver')
            setReceiverTaskOverride('flight-modes')
          }}
        />
    )
  }

  function renderPowerSectionFooter(): ReactNode {
    return (
        <PowerView
          isBatteryVerified={snapshot.liveVerification.batteryTelemetry.verified}
          batteryHealthLabel={batteryHealthLabel(snapshot)}
          batteryHealthTone={batteryHealthTone(snapshot)}
          parameterNotice={parameterNotice ? { tone: parameterNotice.tone, toneLabel: statusToneLabel(parameterNotice.tone), text: parameterNotice.text } : null}
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
        />
    )
  }

  function renderEscDshotFooter(): ReactNode {
    const motPwmType = Math.round(
      Number(editedValues.MOT_PWM_TYPE ?? readRoundedParameter(snapshot, 'MOT_PWM_TYPE') ?? 0)
    )
    const isDShot = motPwmType >= 4 && motPwmType <= 7 // DShot150/300/600/1200
    // BDShot is a compile-time / board feature: SERVO_BLH_BDMASK only exists in
    // the synced parameter tree when the firmware was built with it. Absent =>
    // this firmware/board can't do bidirectional DShot.
    const bdshotSupported = configParametersById.has('SERVO_BLH_BDMASK')
    return (
      <div className="esc-dshot-footer" data-testid="esc-dshot-footer">
        {!bdshotSupported ? (
          <small className="esc-dshot-footer__warning" data-testid="esc-bdshot-unsupported">
            Your firmware build doesn’t support bidirectional DShot (no SERVO_BLH_BDMASK parameter). Flash a board/firmware
            built with BDShot to get RPM telemetry over the DShot signal wire.
          </small>
        ) : (
          <>
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
                ? 'Selecting a DShot protocol auto-stages bdshot on outputs 1-4 (BLHeli auto on). Most boards support bdshot on the first 4 outputs only — a few do 8; check your FC before enabling more.'
                : 'Pick a DShot protocol above to enable bidirectional DShot (RPM telemetry).'}
            </small>
          </>
        )}
      </div>
    )
  }

  function renderMetadataParameterField(parameter: ParameterState, infoTestIdPrefix = 'metadata-field-info') {
    // Shared metadata-driven editor used across Power additional
    // settings, Output additional settings, Tuning, and other generic
    // surfaces. The ScopedField dispatcher picks: bitmask -> per-bit
    // checkbox grid, enum options -> select, otherwise number with
    // smart step inference. Staged-red + "was X" + float-noise
    // formatting still come from the underlying widgets unchanged.

    // Conditional visibility: a field with `visibleWhen` renders only when the
    // controlling param's current value (in-flight draft if staged, else live)
    // is allowed — e.g. analog rangefinder knobs appear once RNGFND1_TYPE is
    // set to Analog. Reacts live because editedValues drives the re-render.
    const visibleWhen = parameter.definition?.visibleWhen
    if (visibleWhen) {
      const draft = editedValues[visibleWhen.paramId]
      const live = snapshot.parameters.find((candidate) => candidate.id === visibleWhen.paramId)?.value
      const current = draft !== undefined && draft !== '' ? Number(draft) : live
      if (current === undefined || Number.isNaN(current) || !visibleWhen.in.includes(Math.round(current))) {
        return null
      }
    }

    // Every "Additional settings" card in the app (Servos ▸ Peripherals &
    // Alerts, Power, Failsafe, Ports, Receiver, guided Setup) funnels through
    // this one renderer, so the per-parameter "i" is attached here rather than
    // at each of those call sites. The bubble is a SIBLING of the editor, not a
    // child: ScopedField wraps its control in a <label>, and an anchor (the
    // wiki link) nested inside a <label> is both invalid and unclickable.
    return (
      <div key={parameter.id} className="config-section__field-row">
        <ScopedField
          parameter={parameter}
          liveValue={parameter.value}
          editedValues={editedValues}
          onChange={(paramId, value) => setDraft(paramId, value)}
          draftStatusById={parameterDraftById}
          stepFallback={parameter.definition?.step ?? 1}
        />
        <ParamInfoBubble
          paramId={parameter.id}
          label={parameter.definition?.label ?? parameter.id}
          description={parameter.definition?.description}
          testId={`${infoTestIdPrefix}-${parameter.id}`}
        />
      </div>
    )
  }

  // Networking field renderer: compose the four NET_…IP octet params into one
  // dotted-quad editor; everything else falls through to the generic metadata
  // field. Sibling octets (byte 2-4) render null — the byte-1 quad draws them.
  // MAC stays as plain byte fields (in-place hex editing fights the cursor).
  // Wrap a networking field with a per-param "i" — hover/focus reveals the
  // ArduPilot description right next to the control, so the operator knows what
  // each NET_ param does without leaving the tab. Mirrors the Config "i".
  function withNetworkingFieldInfo(parameter: ParameterState, node: ReactNode): ReactNode {
    if (node === null || node === undefined) {
      return node
    }
    // Same shared per-field "i" affordance as the Config tab — hover/focus
    // reveals the raw parameter id, the ArduPilot description and a wiki deep
    // link, so it's consistent with the rest of the app. No longer gated on
    // there being a description: the id and the link are always worth having.
    return (
      <div key={parameter.id} className="config-section__field-row">
        {node}
        <ParamInfoBubble
          paramId={parameter.id}
          label={parameter.definition?.label ?? parameter.id}
          description={parameter.definition?.description}
          testId={`networking-field-info-${parameter.id}`}
        />
      </div>
    )
  }

  function renderNetworkingField(parameter: ParameterState): ReactNode {
    // MAC address: six octets, colon-separated, on one row like the IPs.
    if (parameter.id === 'NET_MACADDR0') {
      const octets = [0, 1, 2, 3, 4, 5]
        .map((index) => selectParameterById(snapshot, `NET_MACADDR${index}`))
        .filter((entry): entry is ParameterState => entry !== undefined)
      if (octets.length === 6) {
        return withNetworkingFieldInfo(
          parameter,
          <IpAddressField
            key={parameter.id}
            label={(parameter.definition?.label ?? 'MAC address').replace(/ · byte \d+$/, '')}
            description={parameter.definition?.description}
            octets={octets}
            editedValues={editedValues}
            draftStatusById={parameterDraftById}
            onChange={(paramId, value) => setDraft(paramId, value)}
            separator=":"
          />
        )
      }
    }
    if (/^NET_MACADDR[1-5]$/.test(parameter.id)) {
      return null
    }
    const octet0 = /^(NET_(?:IPADDR|GWADDR|REMPPP_IP|P\d+_IP))0$/.exec(parameter.id)
    if (octet0) {
      // Honour the same visibleWhen gating the generic renderer applies (endpoint
      // IPs stay hidden until their NET_Pn_TYPE is an active type).
      const visibleWhen = parameter.definition?.visibleWhen
      if (visibleWhen) {
        const draft = editedValues[visibleWhen.paramId]
        const live = snapshot.parameters.find((candidate) => candidate.id === visibleWhen.paramId)?.value
        const current = draft !== undefined && draft !== '' ? Number(draft) : live
        if (current === undefined || Number.isNaN(current) || !visibleWhen.in.includes(Math.round(current))) {
          return null
        }
      }
      const base = octet0[1]
      const octets = [0, 1, 2, 3]
        .map((index) => selectParameterById(snapshot, `${base}${index}`))
        .filter((entry): entry is ParameterState => entry !== undefined)
      if (octets.length === 4) {
        return withNetworkingFieldInfo(
          parameter,
          <IpAddressField
            key={parameter.id}
            label={(parameter.definition?.label ?? base).replace(/ · byte \d+$/, '')}
            description={parameter.definition?.description}
            octets={octets}
            editedValues={editedValues}
            draftStatusById={parameterDraftById}
            onChange={(paramId, value) => setDraft(paramId, value)}
          />
        )
      }
    }
    // A non-leading octet of an IP group — already drawn by its byte-1 quad.
    if (/^NET_(?:IPADDR|GWADDR|REMPPP_IP|P\d+_IP)[1-3]$/.test(parameter.id)) {
      return null
    }
    // Plain NET_ params go through the generic renderer, which now attaches the
    // "i" itself — wrapping again here would render two bubbles per field. Pass
    // the networking test-id prefix through so `networking-field-info-*` hooks
    // keep resolving. withNetworkingFieldInfo stays for the composed
    // dotted-quad/MAC editors above, which the generic renderer never sees.
    return renderMetadataParameterField(parameter, 'networking-field-info')
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

  // Stage a Log-Tuning recommendation as a draft: the analyzer produces a raw
  // param id + numeric value, which goes into the shared editedValues draft set
  // (the same one the Tuning Review tab and the global draft bar read), so it is
  // reviewed and written through the normal verified path — never auto-applied.
  function handleStageLogTuningParam(param: string, value: number): void {
    updateDrafts((existing) => ({ ...existing, [param]: String(value) }))
  }

  // Stage the whole Initial Tune batch in one draft update. Same shared draft
  // set as every other tuning change, so a dozen parameters land in the Review
  // tab together and are written through the normal verified path — this
  // deliberately does not get its own write route, because a batch of starting
  // values is exactly the kind of change that should be looked at before it
  // reaches an aircraft.
  function handleStageInitialTuneParameters(parameters: Array<{ id: string; value: number }>): void {
    if (parameters.length === 0) {
      return
    }
    mergeDrafts(Object.fromEntries(parameters.map(({ id, value }) => [id, String(value)])))
    setParameterNotice({
      tone: 'success',
      text: `Staged ${parameters.length} starting-point value${parameters.length === 1 ? '' : 's'} for review.`
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
    discardScope: string,
    renderField: (parameter: ParameterState) => ReactNode = renderMetadataParameterField
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
        renderField={renderField}
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

  // Keep the "flow active" flag (setupMode) synced to the tab. The Guided Setup
  // tab always shows the wizard, so mark the flow active when it's open — this
  // matters when the operator reaches the tab via the nav (not openSetupWizard),
  // so the exercise-return effect still bounces them back after an RC/motor
  // exercise. The Status & Info tab is always the overview. setupMode is NOT
  // reset while on a detour view (receiver/motors), so the flow survives it.
  useEffect(() => {
    if (activeViewId === 'guided-setup' && setupMode !== 'wizard') {
      setSetupMode('wizard')
    } else if (activeViewId === 'setup' && setupMode !== 'overview') {
      setSetupMode('overview')
    }
  }, [activeViewId, setupMode])

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

    if (setupMode !== 'wizard' || activeViewId === 'guided-setup') {
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
    // Drop any selected preset ids that are no longer in the catalog (e.g. after
    // a vehicle change swaps the preset set). Multi-select starts empty — nothing
    // is auto-selected; the operator picks what to combine.
    setSelectedPresetIds((current) => {
      const valid = current.filter((id) => presetDefinitions.some((preset) => preset.id === id))
      return valid.length === current.length ? current : valid
    })
  }, [presetDefinitions])

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
    // Also clear the "force-write blocked values" opt-in when the selected
    // snapshot (its diff) changes: otherwise enabling force for snapshot A then
    // selecting B would silently force-write B's out-of-range/enum values to the
    // live FC without the operator re-opting-in for that snapshot.
    setSnapshotForceInvalid(false)
  }, [selectedSnapshotDiffSignature])

  useEffect(() => {
    setProvisioningRestoreAcknowledged(false)
  }, [selectedProvisioningProfileDiffSignature])

  useEffect(() => {
    setPresetApplyAcknowledged(false)
    setPresetNotice(undefined)
    setDroppedPresetParamIds([])
  }, [selectedPresetDiffSignature])

  useEffect(() => {
    if (isExpertMode || !isExpertOnlyView(activeViewId)) {
      return
    }

    setActiveViewId('setup')
  }, [activeViewId, isExpertMode])

  // "Show changes" (global draft bar) switches to Parameters AND bumps this so
  // ParametersSection scrolls to the diff grid — a plain boolean can't refire
  // on a second click while already on the tab. Reset to 0 the instant the
  // operator leaves Parameters, so the counter is only ever nonzero in the
  // exact render where Show Changes caused the switch; a later unrelated
  // manual nav back into Parameters (remounting the section) sees 0 and
  // doesn't auto-scroll.
  const [showChangesRequestId, setShowChangesRequestId] = useState(0)
  useEffect(() => {
    if (activeViewId !== 'parameters') {
      setShowChangesRequestId(0)
    }
  }, [activeViewId])

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
      // The RC exercises live in specific Receiver tabs. Pin the matching tab
      // (the override survives the view switch — the clear effect early-returns
      // once activeViewId is 'receiver') and route via scrollToPanel so the
      // header offset and the paint-aware retry are consistent with every other
      // guided nav, instead of a bare scrollIntoView that races the heavy view.
      case 'mode-switch-exercise':
        handleStartModeSwitchExercise()
        setReceiverTaskOverride('flight-modes')
        scrollToPanel('setup-panel-rc')
        return
      case 'rc-range-exercise':
        handleStartRcRangeExercise()
        setReceiverTaskOverride('endpoints')
        scrollToPanel('setup-panel-rc')
        return
      case 'rc-mapping-exercise':
        handleStartRcMappingExercise()
        setReceiverTaskOverride('mapping')
        scrollToPanel('setup-panel-rc')
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
  // Recent Notices: optional expert-mode text filter, then coalesce repeats +
  // split into Warnings & Critical / Info.
  const trimmedNoticeFilter = noticeFilter.trim().toLowerCase()
  const filteredNoticeEntries = trimmedNoticeFilter
    ? snapshot.statusTexts.filter((entry) => entry.text.toLowerCase().includes(trimmedNoticeFilter))
    : snapshot.statusTexts
  const recentNotices = buildRecentNotices(filteredNoticeEntries)
  // Shared by the inline panel and the popped-out window so both do exactly the
  // same thing — clipboard API first, hidden-textarea execCommand fallback for
  // the non-secure-context / older-browser case.
  const copyAllNotices = (): void => {
    if (setupStatusEntries.length === 0) {
      return
    }
    const payload = setupStatusEntries.map((entry) => `[${entry.severity.toUpperCase()}] ${entry.text}`).join('\n')
    const finish = (): void => {
      setNoticesCopied(true)
      window.setTimeout(() => setNoticesCopied(false), 1500)
    }
    const fallbackCopy = (): void => {
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
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(finish).catch(fallbackCopy)
    } else {
      fallbackCopy()
    }
  }
  // Props every copy of the feed shares. The popped-out window renders the same
  // component over the same model: it is a portal into this tree, so each new
  // STATUSTEXT that lands in the snapshot re-renders BOTH copies from the one
  // subscription. A reconnect can neither stall it (the snapshot is the only
  // source) nor duplicate entries (buildRecentNotices coalesces by
  // severity+text, so a repeated message bumps ×N instead of adding a row).
  const sharedNoticeFeedProps = {
    notices: recentNotices,
    hasEntries: setupStatusEntries.length > 0,
    copied: noticesCopied,
    onCopyAll: copyAllNotices,
    onClearAll: () => void runtime.clearStatusTexts(),
    filterValue: productMode === 'expert' ? noticeFilter : undefined,
    onFilterChange: productMode === 'expert' ? setNoticeFilter : undefined
  }
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
  // RNGFND1_TYPE, falling back to the pre-4.5 unnumbered RNGFND_TYPE. Kept as
  // `undefined` when neither is in the table: "not synced yet" is not the same
  // claim as "the sensor is switched off", and the Status card must not make
  // the second claim while only the first is true.
  const rangefinderTypeValue = (selectParameterById(snapshot, 'RNGFND1_TYPE') ?? selectParameterById(snapshot, 'RNGFND_TYPE'))
    ?.value
  const headerRangefinderActive =
    snapshot.connection.kind === 'connected' && (rangefinderTypeValue ?? 0) !== 0
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
        // Driver numbers per AP_OpticalFlow.h `Type` / the FLOW_TYPE @Values
        // block in AP_OpticalFlow.cpp — 6 is DroneCAN (HereFlow) and 8 is
        // UPFLOW. The previous copy here said "10 HereFlow, 8 PMW3901"; 10 is
        // SITL and PMW3901 is not a FLOW_TYPE option at all, so it pointed
        // operators at a value that would never work.
        ? 'FLOW_TYPE is not in the parameter table yet — finish parameter sync, then set FLOW_TYPE to your sensor (e.g. 6 DroneCAN/HereFlow, 4 CXOF, 1 PX4Flow) to enable the optical flow stream.'
        : 'FLOW_TYPE is 0 (disabled). Set FLOW_TYPE to your sensor (e.g. 6 DroneCAN/HereFlow, 4 CXOF, 1 PX4Flow) and reboot to enable the optical flow stream.'
    }
    if (snapshot.liveVerification.opticalFlow.lastSeenAtMs !== undefined) {
      return `FLOW_TYPE=${flowTypeValue} is configured and the sensor was reporting, but the OPTICAL_FLOW stream has gone silent. Check the sensor wiring or the driver-specific bus.`
    }
    return `FLOW_TYPE=${flowTypeValue} is configured but no OPTICAL_FLOW messages have arrived yet. Verify the sensor wiring; some drivers need a reboot after FLOW_TYPE changes.`
  })()
  // Status & Info advanced sensor cards (rangefinder + optical flow). The
  // builder decides both the state and whether a card exists at all, so an
  // unconfigured sensor simply produces nothing to render here — GPS and
  // compass stay unconditional, everything above them is opt-in.
  //
  // `nowMs` is `statusClockMs`, a ~1 Hz ticking clock rather than Date.now():
  // the card has to be able to age from "reporting" into "data stopped"
  // without a snapshot arriving, and a snapshot is exactly what stops arriving
  // when the sensor dies. Reading Date.now() during render would freeze the
  // age at the last snapshot and the card would sit on a stale number forever.
  const advancedSensorCards = buildAdvancedSensorCards({
    connected: snapshot.connection.kind === 'connected',
    liveVerification: snapshot.liveVerification,
    rangefinderType: rangefinderTypeValue,
    flowType: flowTypeValue,
    nowMs: statusClockMs
  })

  // Pre-arm box. Shares `statusClockMs` for the same reason the sensor cards do:
  // the "reported Ns ago" labels have to keep ageing while no snapshot arrives,
  // which is precisely the situation a latched pre-arm reason sits in — the
  // vehicle re-sends a failing reason at most every 30s and never announces a
  // pass at all, so the live SYS_STATUS bit (preArmStatus.liveCheck) is what
  // actually decides the verdict here.
  const preArmStatusViewModel = buildPreArmStatusViewModel({
    preArmStatus: snapshot.preArmStatus,
    nowMs: statusClockMs
  })

  // ── Status & Info dashboard ─────────────────────────────────────────────
  //
  // Every status card is built here, exactly as it was built inline before,
  // and handed to the dashboard as an opaque node. The dashboard decides only
  // WHERE a card sits — never what it says, whether it exists, or what it
  // requests. The conditional sensor cards keep coming straight from
  // buildAdvancedSensorCards, so an unconfigured sensor still produces no
  // card and a configured-but-silent one still produces its fault card.
  const statusDashboardCards: StatusDashboardCardEntry[] = [
    {
      id: 'gps',
      label: 'GPS',
      node: (
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
              ) : gpsCoordFormat === 'utm' ? (
                <div className="setup-gui-box__kv-row"><span>Grid (UTM)</span><strong data-testid="setup-gps-utm">{formatUtm(snapshot.liveVerification.globalPosition.latitudeDeg, snapshot.liveVerification.globalPosition.longitudeDeg)}</strong></div>
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
      )
    },
    ...advancedSensorCards.map((card) => ({
      id: card.id,
      label: card.title,
      node: <AdvancedSensorCard card={card} />
    })),
    {
      id: 'prearm',
      label: 'Pre-arm',
      node: (
        <article className="setup-gui-box" data-testid="setup-prearm" data-prearm-source={preArmStatusViewModel.source}>
          <div className="setup-gui-box__titlebar">
            <strong>Pre-arm</strong>
            <StatusBadge tone={preArmStatusViewModel.tone}>
              <span data-testid="setup-prearm-badge">{preArmStatusViewModel.badgeLabel}</span>
            </StatusBadge>
          </div>
          <div className="setup-gui-box__body">
            <p className="telemetry-note" data-testid="setup-prearm-summary">
              {preArmStatusViewModel.summary}
            </p>
            {preArmStatusViewModel.issues.length > 0 && (
              <ul className="setup-statistics__prearm-list" data-testid="setup-prearm-issues">
                {preArmStatusViewModel.issues.map((issue, index) => (
                  <li key={`prearm:${index}:${issue.text}`}>
                    {issue.text}
                    {/* The age is always rendered next to the reason: without it
                        a minute-old latched line is indistinguishable from a
                        reading taken just now, which is the misread that started
                        this. */}
                    <span className="setup-statistics__prearm-age"> ({issue.ageLabel})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      )
    },
    {
      id: 'statistics',
      label: 'Statistics',
      node: (
        <article className="setup-gui-box setup-gui-box--compact" data-testid="setup-statistics">
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
      )
    },
    {
      id: 'notices',
      label: 'Recent Notices',
      node: (
        <article className="setup-gui-box" data-testid="setup-notices-panel">
          <div className="setup-gui-box__titlebar">
            <strong>Recent Notices</strong>
            {recentNoticesBadge(recentNotices)}
          </div>
          <div className="setup-gui-box__body">
            <RecentNoticesFeed
              {...sharedNoticeFeedProps}
              variant="inline"
              testIdPrefix="setup-notices"
              entryTestIdPrefix="setup-notice"
              expanded={noticesExpanded}
              onToggleExpanded={toggleNoticesExpanded}
              poppedOut={noticesPopoutHandle !== undefined}
              popoutBlocked={noticesPopout.blockedKey === NOTICES_POPOUT_KEY}
              onTogglePopout={() => {
                // Synchronous with the click: window.open only
                // survives a popup blocker inside the browser's
                // user-activation window, so nothing may await
                // before this call.
                if (noticesPopoutHandle) {
                  noticesPopout.close(NOTICES_POPOUT_KEY)
                } else {
                  noticesPopout.open(NOTICES_POPOUT_KEY, 'Recent Notices')
                }
              }}
            />
          </div>
        </article>
      )
    },
    {
      id: 'system-info',
      label: 'System Info',
      node: (
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
              {/* The FW version doubles as the way into the
               *  Flash tab. It replaces the "Enter DFU mode"
               *  button that used to sit above the craft view:
               *  flashing is discoverable from the value that
               *  makes an operator want to flash in the first
               *  place, without a link-drops-the-vehicle action
               *  living on a read-only status page.
               *
               *  A <button>, not an <a>: routing here is state
               *  (`setActiveViewId`), and an href would reload
               *  the SPA and drop the MAVLink link — the exact
               *  thing this change is trying to stop happening
               *  by accident. The row renders at all only when
               *  a version is known, so there is no dead link
               *  before the board has answered. */}
              {snapshot.hardware.board?.firmwareVersion ? (
                <div className="setup-gui-box__kv-row">
                  <span>FW version</span>
                  <strong>
                    <button
                      type="button"
                      className="setup-gui-box__value-link"
                      data-testid="setup-firmware-flash-link"
                      onClick={() => setActiveViewId('flash')}
                      aria-label={`Firmware ${snapshot.hardware.board.firmwareVersion} — open Flash tab`}
                      title="Open the Flash tab (firmware, DFU / bootloader, flash wizard)"
                    >
                      {snapshot.hardware.board.firmwareVersion}
                    </button>
                  </strong>
                </div>
              ) : null}
              {/* The board's own name, from the boot banner. Distinct from the
               *  APJ board id, which we resolve through our own table — an
               *  uncatalogued board has a real name here and only a number
               *  there. Nothing in the USB ids helps: ArduPilot ships the
               *  generic pid.codes VID with the stock STM32 CDC PID. */}
              {snapshot.hardware.board?.reportedBoardName ? (
                <div className="setup-gui-box__kv-row">
                  <span>Board</span>
                  <strong data-testid="setup-reported-board-name">{snapshot.hardware.board.reportedBoardName}</strong>
                </div>
              ) : null}
              {/* Full firmware string, keeping the fork/vendor suffix the
               *  decoded version drops — the part that distinguishes several
               *  builds that all read "4.7.0 (beta)". Shown only when it says
               *  more than the decoded version already does. */}
              {snapshot.hardware.board?.reportedFirmwareString ? (
                <div className="setup-gui-box__kv-row">
                  <span>FW build</span>
                  <strong data-testid="setup-reported-firmware-string">
                    {snapshot.hardware.board.reportedFirmwareString}
                  </strong>
                </div>
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
              <div className="setup-gui-box__kv-row"><span>Pre-arm</span><strong>{preArmStatusViewModel.badgeLabel}</strong></div>
            </div>
          </div>
        </article>
      )
    },
    {
      id: 'instruments',
      label: 'Instruments',
      node: (
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
      )
    },
    {
      id: 'guided-setup',
      label: 'Guided setup',
      node: (
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
      )
    }
  ]

  // The DEFAULT arrangement, and the ONLY description of it: this list — with
  // `DEFAULT_STATUS_DASHBOARD_COLUMNS`, which names the columns themselves —
  // is what the page renders when nothing has been dragged, so between them
  // they have to be the shipped layout exactly.
  //
  //   * the sensor row under the craft model — GPS plus whichever advanced
  //     sensor cards exist — because the three answer one question and used to
  //     be split across two columns and two scroll positions. It is a SHELF
  //     column, so a sensor card that appears mid-session lands beside its
  //     neighbours rather than under them;
  //   * Pre-arm above Statistics in the first status column, Recent Notices
  //     beside them in the second;
  //   * System Info at the TOP of the sidebar, above Instruments and Guided
  //     setup: it is reference data the operator goes looking for, not
  //     something they scan, so it does not hold prime main-column space.
  //
  // A stored layout is reconciled against this list every render, which is how
  // a sensor card appearing or disappearing mid-session stays graceful.
  const statusDashboardSpecs: StatusDashboardCardSpec[] = [
    { id: 'gps', label: 'GPS', column: 'sensors' },
    ...advancedSensorCards.map((card) => ({ id: card.id, label: card.title, column: 'sensors' })),
    { id: 'prearm', label: 'Pre-arm', column: 'midcol' },
    { id: 'statistics', label: 'Statistics', column: 'midcol' },
    { id: 'notices', label: 'Recent Notices', column: 'noticecol' },
    { id: 'system-info', label: 'System Info', column: 'sidebar' },
    { id: 'instruments', label: 'Instruments', column: 'sidebar' },
    { id: 'guided-setup', label: 'Guided setup', column: 'sidebar' }
  ]
  const statusDashboard = useStatusDashboardLayout(statusDashboardSpecs)

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
      // While the synthetic GPS runs, the "fix" is one THIS APP is fabricating
      // at an operator-typed location, so the chip must say so rather than
      // reporting a verified fix the vehicle does not have. Label included:
      // hover text alone is not a warning on a touch device.
      id: 'gps',
      label: snapshot.liveVerification.fakeGpsActive ? 'GPS (sim)' : 'GPS',
      stateClass: snapshot.liveVerification.fakeGpsActive
        ? 'is-active'
        : snapshot.liveVerification.globalPosition.verified
          ? 'is-fix'
          : setupGpsConfigured
            ? 'is-active'
            : '',
      title: snapshot.liveVerification.fakeGpsActive
        ? 'SYNTHETIC GPS: this configurator is streaming a fabricated fix at the location you entered, for compass calibration without a GPS. The position shown is not measured. Stop it before flying.'
        : snapshot.liveVerification.globalPosition.verified
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

  const showLanding = (activeViewId === 'setup' || activeViewId === 'guided-setup') && snapshot.connection.kind !== 'connected'

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
      {scopedWriteProgress ? (
        <div className="write-progress-banner" role="status" aria-live="polite" data-testid="write-progress-banner">
          <span className="write-progress-banner__label">
            Writing {scopedWriteProgress.scopeLabel.toLowerCase()} — {scopedWriteProgress.completed} / {scopedWriteProgress.total} parameters
          </span>
          <progress
            className="write-progress-banner__bar"
            data-testid="write-progress-bar"
            value={scopedWriteProgress.completed}
            max={scopedWriteProgress.total}
          />
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
        onChooseSerialPort={() => void handleChooseSerialPort()}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Persistent staged-changes bar. Editing any param tab stages a draft;
          this bar follows you across every tab while edits are pending and
          offers one place to review (Show changes -> Parameters) and write the
          whole set (Write all), or discard. Hidden when nothing is staged. */}
      {snapshot.connection.kind === 'connected' &&
      (parameterDraftSummary.stagedCount > 0 ||
        parameterDraftSummary.invalidCount > 0 ||
        Boolean(parameterFollowUp?.requiresReboot)) ? (
        <ParameterDraftBar
          summary={parameterDraftSummary}
          busyAction={busyAction}
          canApplyAllDraftParameters={canApplyAllDraftParameters}
          applyAllBusyLabel={applyAllBusyLabel}
          rebootPending={Boolean(parameterFollowUp?.requiresReboot)}
          onShowChanges={() => {
            setActiveViewId('parameters')
            setShowChangesRequestId((n) => n + 1)
          }}
          onWriteAll={() => void handleApplyAllParameterDrafts()}
          onDiscard={clearAllDrafts}
          onRequestReboot={() => void handleGuidedAction('reboot-autopilot')}
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
          {/* A guided-setup step sends the operator to another tab to do the
              work (Receiver for an RC exercise, Motors for a spin check). The
              flow stays active, and it auto-returns when an exercise COMPLETES
              — but an operator who just wants to go back, or who did not finish,
              had no way other than finding the tab in the nav and hoping they
              landed on the right step. This is that way back. */}
          {setupMode === 'wizard' && activeViewId !== 'guided-setup' ? (
            <button
              type="button"
              className="setup-return-bar"
              data-testid="setup-return-to-wizard"
              onClick={() => setActiveViewId('guided-setup')}
            >
              ← Back to guided setup
              {selectedSetupSection ? <span>{selectedSetupSection.title}</span> : null}
            </button>
          ) : null}
          <WorkspaceNotes
            snapshot={snapshot}
            sessionNotice={sessionNotice}
            onReconnect={() => void handleConnect()}
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
          ) : activeViewId === 'setup' || activeViewId === 'guided-setup' ? (
            <SetupView
              // The tab decides the surface: Status & Info ('setup') shows the
              // health/status dashboard (overviewSlot); Guided Setup shows the
              // wizard (wizardSlot). setupMode remains the "flow active" flag for
              // effects, but the rendered surface is tab-driven so they can't
              // desync.
              mode={activeViewId === 'guided-setup' ? 'wizard' : 'overview'}
              actionsSlot={
                activeViewId === 'guided-setup' ? (
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

                    {/* "Enter DFU / bootloader mode" used to sit here, as a
                     *  two-step armed confirm directly above the craft view.
                     *  It is gone: entering DFU drops the MAVLink link and
                     *  re-enumerates the board, which is the opening move of a
                     *  flashing session, not a status readout — and the Flash
                     *  tab already offers the identical control (FirmwareFlasher
                     *  `onEnterDfu`, same connected/disarmed guards) alongside
                     *  the firmware picker and the flash wizard that follow it.
                     *  Nothing was lost; a disconnect-the-vehicle button simply
                     *  stopped living one stray click from read-only status.
                     *  The route in is the FW version value in System Info. */}

                    {/* The arrangement below is user-rearrangeable: drag a card
                     *  by its handle anywhere on the page, drag a column's edge
                     *  to set its width, drag a card's bottom edge to cap its
                     *  height. The controls only appear on viewports wide
                     *  enough for the multi-column layout to mean anything —
                     *  on a phone the page is one column and the default order
                     *  stands. */}
                    <StatusDashboardProvider controller={statusDashboard} cards={statusDashboardCards}>
                    {statusDashboard.customisable ? (
                      <div className="status-dash-toolbar" data-testid="status-dash-toolbar">
                        <span className="status-dash-toolbar__hint">
                          Drag a card by its ⠿ handle to put it anywhere — beside another card, into a gap to open a new
                          column, or above or below everything for a new row. Drag a column's right edge to set its
                          width, or a card's bottom edge to set its height. Keyboard: focus a handle and use the arrow
                          keys, with shift for width.
                        </span>
                        {statusDashboard.customised ? (
                          <>
                            {/* Tidy is the way out of a mess that is not a full
                             *  Reset: it drops the columns the operator emptied
                             *  and evens up the widths, keeping the arrangement
                             *  they actually built. */}
                            <button
                              type="button"
                              style={buttonStyle()}
                              data-testid="status-dash-tidy-layout"
                              onClick={statusDashboard.tidyLayout}
                              title="Close up empty columns and even out the widths, keeping your arrangement"
                            >
                              Tidy Up
                            </button>
                            <button
                              type="button"
                              style={buttonStyle()}
                              data-testid="status-dash-reset-layout"
                              onClick={statusDashboard.resetLayout}
                              title="Put every Status card back where it shipped"
                            >
                              Reset Layout to Default
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
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

                        {/* Everything below the craft model is one 12-column
                         *  grid with auto rows: the sensor shelf is band 0, the
                         *  two status columns are band 1, and the operator can
                         *  put any card in any column, at any width, in either
                         *  band — or open new ones.
                         *
                         *  There are two regions rather than one because the
                         *  sidebar is a SIBLING of the viewer in the page shell
                         *  and runs alongside the craft preview; folding it in
                         *  would move it below the preview.
                         *
                         *  The default arrangement (`statusDashboardSpecs` plus
                         *  `DEFAULT_STATUS_DASHBOARD_COLUMNS`) reproduces the
                         *  shipped page exactly — span 6 of 12 with a 14px
                         *  gutter is the same width as one of the two auto-fit
                         *  tracks it replaces — so with nothing dragged this
                         *  renders identically to the static tree it replaced.
                         *
                         *  The comments that used to justify each card's
                         *  position now live on `statusDashboardSpecs`, which is
                         *  the single place the default arrangement is stated. */}
                        <StatusDashboardRegion
                          region="main"
                          className="status-dash-region--main"
                          testId="setup-sensor-group-region"
                        />
                      </div>

                      <StatusDashboardRegion
                        region="side"
                        className="setup-bench__sidebar status-dash-region--side"
                      />
                    </div>
                    </StatusDashboardProvider>
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
                    onResetProgress={handleResetGuidedSetup}
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

                      <SetupWizardDetail
                        selectedSetupSection={selectedSetupSection}
                        snapshot={snapshot}
                        // Compass cal stalls without a position; give the
                        // guided step the same fake-GPS control the
                        // Calibration tab has instead of leaving the operator
                        // to discover it two tabs over.
                        compassLocationSlot={
                          runtime ? <CalibrationLocationButton snapshot={snapshot} runtime={runtime} /> : undefined
                        }
                      />

                      {['airframe', 'accelerometer', 'compass'].includes(selectedSetupSection.id) ? (
                        <details className="setup-wizard__advanced-disclosure" data-testid="setup-wizard-advanced">
                          <summary>
                            <strong>Advanced settings</strong>
                            <span>board orientation, sensors &amp; related parameters</span>
                          </summary>
                          {renderAdditionalSettingsCard(
                            'Advanced setup settings',
                            'Board orientation, sensor, and related setup parameters stay attached to the guided flow when this step needs them.',
                            setupAdditionalGroups,
                            setupAdditionalDraftEntries,
                            setupAdditionalStagedDrafts,
                            setupAdditionalInvalidDrafts,
                            'setup:additional',
                            'Apply Setup Changes',
                            'advanced setup settings'
                          )}
                        </details>
                      ) : null}
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
          rebootRequired={parameterFollowUp?.requiresReboot ?? false}
          onReboot={() => void handleGuidedAction('reboot-autopilot')}
          boardCatalogEntry={boardCatalogEntry}
          boardReferenceLinks={boardReferenceLinks}
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
          onApplyScopedDrafts={handleApplyScopedParameterDrafts}
          onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          setActiveViewId={setActiveViewId}
          renderAdditionalSettingsCard={renderAdditionalSettingsCard}
          runtime={runtime}
        />
	      ) : null}


        {activeViewId === 'osd' ? (
          <div className="tab-strip config-category-nav" data-testid="osd-vtx-nav" role="tablist">
            {([
              { id: 'osd' as const, label: 'OSD' },
              { id: 'vtx' as const, label: 'VTX' }
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={osdVtxTab === tab.id}
                className={`tab-strip__tab${osdVtxTab === tab.id ? ' is-active' : ''}`}
                data-testid={`osd-vtx-tab-${tab.id}`}
                onClick={() => setOsdVtxTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {activeViewId === 'osd' && osdVtxTab === 'vtx' ? (
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
            vtxTable={vtxTable}
          />
        ) : null}

        {activeViewId === 'osd' && osdVtxTab === 'osd' ? (
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
            osdShorthand={osdShorthand}
            onApplyScopedDrafts={handleApplyScopedParameterDrafts}
            onDiscardScopedDrafts={handleDiscardScopedParameterDrafts}
          />
        ) : null}

	      {(activeViewId === 'receiver' || activeViewId === 'modes') ? (
      <section className={`grid ${activeViewId === 'receiver' || activeViewId === 'modes' ? 'one-up' : 'two-up'}`}>
        {activeViewId === 'receiver' ? (
        <ReceiverSection
          snapshot={snapshot}
          canApplyDraftParameters={canApplyDraftParameters}
          busyAction={busyAction}
          onBindReceiver={() => void handleBindReceiver()}
          rcDirectionResults={rcDirectionResults}
          rcDirectionActiveAxis={rcDirectionActiveAxis}
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
            receiverHasPendingReview,
            armSwitchAvailable,
            armSwitchAssignment,
            rcLogicChannelClaims
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
            setReceiverTaskOverride,
            handleSetArmSwitchChannel
          }}
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
          onOpenPower={() => setActiveViewId('config')}
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
          logUpload={logUpload}
        />
      ) : null}

      {(activeViewId === 'motors' || activeViewId === 'servos') ? (
      <OutputsSection
        // Motors and Servos are the same component with a different prop, so
        // React reconciles them as one element: the DOM nodes, internal state
        // and measured sizes all carry across a tab switch instead of the tabs
        // swapping. Keying on the view makes it a real remount, so each tab
        // starts from its own clean state rather than mutating the other's.
        key={activeViewId}
        activeViewId={activeViewId}
        snapshot={snapshot}
        motorSetupSlot={renderMotorSetupReorderPanel()}
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
          motorPreviewFrameKnown,
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
          activeOutputTask,
          relayGroups,
          relayDraftEntries,
          relayStagedDrafts,
          relayInvalidDrafts,
          peripheralsCanEnableSlot: opticalFlowCanEnablePrompt
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
          gimbalGroups,
          gimbalDraftEntries,
          gimbalStagedDrafts,
          gimbalInvalidDrafts,
          flowLidarGroups,
          flowLidarDraftEntries,
          flowLidarStagedDrafts,
          flowLidarInvalidDrafts,
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
          resetToDefaultsSlot={
            <ResetToDefaultsButton
              // Same gated handler the Presets view uses — one destructive
              // code path, one set of guards, rather than a second
              // reimplementation per surface.
              onReset={
                runtime && snapshot.connection.kind === 'connected'
                  ? () => void handleEraseSettings()
                  : undefined
              }
              disabledReason={
                snapshot.connection.kind !== 'connected'
                  ? 'Connect to a vehicle first.'
                  : snapshot.vehicle?.armed
                    ? 'Disarm the vehicle before erasing settings.'
                    : undefined
              }
              isResetting={busyAction === 'presets:erase'}
              isBusy={busyAction !== undefined}
              suggestSnapshot={false}
            />
          }
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
            snapshotImportCalibration,
            snapshotRestoreExcludedCalibrationCount,
            snapshotRestoreDroppedParamIds,
            parameterEnumOverrides,
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
            // Per-row Apply STAGES the single change as a draft (like the
            // Parameters tab) — the write happens from the global draft bar.
            handleApplySnapshotEntry: (entry) => {
              if (entry.nextValue === undefined) {
                return
              }
              mergeDrafts({ [entry.id]: String(entry.nextValue) })
              setSnapshotNotice({
                tone: 'warning',
                text: `Staged ${entry.id} as a draft. Write all from the draft bar to apply it.`
              })
            },
            // Group-level Stage/Drop over one category of the restore diff.
            handleApplySnapshotGroup: (entries) => {
              // stageableDraftValues is shared with the Parameters review: it
              // skips rows with no resolved value rather than staging an empty
              // string, which would turn an unreadable row into an invalid
              // draft that then blocks the whole write.
              const values = stageableDraftValues(entries)
              const count = Object.keys(values).length
              if (count === 0) {
                return
              }
              mergeDrafts(values)
              setSnapshotNotice({
                tone: 'warning',
                text: `Staged ${count} change(s) as drafts. Write all from the draft bar to apply them.`
              })
            },
            handleDropSnapshotGroup: (paramIds) => {
              paramIds.forEach((paramId) => handleDropSnapshotRestoreEntry(paramId))
              setSnapshotNotice({
                tone: 'neutral',
                text: `Dropped ${paramIds.length} change(s) from this restore.`
              })
            },
            handleToggleParameterEnumOverride,
            // Bulk "Override and write anyway" for the rescuable invalid rows,
            // so a cross-board restore blocked by a handful of metadata-range
            // rejections doesn't require a per-row detour through Parameters.
            handleOverrideAllSnapshotInvalid: (paramIds) => {
              if (paramIds.length === 0) {
                return
              }
              setParameterEnumOverrides((current) => {
                const next = new Set(current)
                paramIds.forEach((paramId) => next.add(paramId))
                return next
              })
              setSnapshotNotice({
                tone: 'warning',
                text: `Overrode ${paramIds.length} blocked value(s). They no longer block the write — review them before writing.`
              })
            },
            handleCaptureLiveSnapshot,
            handleOverwriteSelectedSnapshot,
            handleDropSnapshotRestoreEntry,
            handleDropAllSnapshotRestoreEntries,
            handleClearSnapshotRestoreDrops,
            setSnapshotImportCalibration,
            handleCreateProvisioningProfile,
            handleDeleteSelectedProvisioningProfile,
            handleDeleteSelectedSnapshot,
            handleExportProvisioningLibrary,
            handleExportSelectedProvisioningProfile,
            handleExportSelectedSnapshot,
            handleExportSelectedSnapshotToDesktop,
            handleExportSnapshotLibrary,
            handleUploadSnapshotLibrary,
            handleUploadSelectedSnapshot,
            snapshotLibraryUploadTarget,
            selectedSnapshotUploadTarget,
            artifactUpload: snapshotArtifactUpload,
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
            altHoldPilotParameters,
            loiterPilotParameters,
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
          renderFilterControl,
            formatCategoryLabel
          }}
          filterNotchSlot={
            <>
              <FilterNotchHelp
                liveValues={filterLiveValues}
                editedValues={editedValues}
                onSetDraft={setDraft}
                disabled={busyAction !== undefined}
              />
              {/* Enter a gyro cutoff, get ArduPilot's derived filter set as
                  editable proposals, stage them as ordinary drafts. It stages
                  rather than writes, so the values land in the fields above and
                  go out through the same reviewed Apply as any other edit. */}
              <FiltersFromGyro
                liveValues={filterLiveValues}
                labelFor={(paramId) =>
                  metadataCatalog.parameters[paramId]?.label ??
                  snapshot.parameters.find((parameter) => parameter.id === paramId)?.definition?.label ??
                  paramId
                }
                onStage={(values) => {
                  for (const entry of values) {
                    setDraft(entry.id, String(entry.value))
                  }
                }}
                disabled={busyAction !== undefined}
              />
            </>
          }
          initialTuneSlot={
            /* Starting-point tuning. Reads live values to show what each
               parameter moves FROM, and stages through the shared draft set —
               it has no write path of its own. */
            <InitialTuneView
              liveValues={new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter.value]))}
              stagedIds={new Set(parameterDraftById.keys())}
              onStage={handleStageInitialTuneParameters}
              /* Always Copter here — this section only renders for
                 isCopterVehicle, so the ATC_/MOT_ prefixes are the right ones.
                 The builder still supports the QuadPlane Q_A_/Q_M_ prefixes
                 (and is tested for them) so a Plane surface can reuse it
                 without the logic being rewritten. */
              quadplane={false}
              firmwareMajor={initialTuneFirmwareMajor}
              hasAccelPMax={snapshot.parameters.some((parameter) => /_ACCEL_P_MAX$/.test(parameter.id))}
              disabled={busyAction !== undefined}
            />
          }
          logTuningSlot={
            /* Rendered inside the Tuning task body when the 'log-tuning' sub-tab
               is active. Self-contained: it owns the uploaded log + analysis, and
               stages recommendations into the shared draft set via onStageParam. */
            <LogTuningView
              onStageParam={handleStageLogTuningParam}
              stagedParams={new Set(parameterDraftById.keys())}
            />
          }
          autotuneSlot={
            /* Rendered INSIDE the Tuning task body when the 'autotune' tab is
               active (see TuningCopterSection), so it no longer trails below the
               overview. Its own disjoint AUTOTUNE_* scoped-draft scope — applying
               here never touches the ATC_* tuning batch. Null on firmware with no
               AUTOTUNE_ params. */
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
          }
        />
      ) : null}

      {activeViewId === 'presets' ? (
        <PresetsSection
          snapshot={snapshot}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          parameterFollowUp={parameterFollowUp}
          presetNotice={presetNotice}
          presetDefinitions={presetDefinitions}
          presetGroups={presetGroups}
          presetsByGroup={presetsByGroup}
          selectedPresetSerialRemap={selectedPresetSerialRemap}
          selectedPresetDependencyLabels={selectedPresetDependencyLabels}
          onSerialRemapChange={(port) => {
            const presetId = selectedPresetSerialRemap?.presetId
            if (presetId) {
              setPresetSerialRemapTargets((current) => ({ ...current, [presetId]: port }))
            }
          }}
          onDeleteUserPreset={handleDeleteUserPreset}
          onUpdateUserPreset={handleUpdateUserPreset}
          presetPreviewById={presetPreviewById}
          selectedPresets={selectedPresets}
          selectedPresetConflicts={selectedPresetConflicts}
          selectedPresetUnknownIds={selectedPresetUnknownIds}
          selectedPresetTouchedCount={selectedPresetTouchedCount}
          selectedPresetApplicability={selectedPresetApplicability}
          selectedPresetDiffGroups={selectedPresetDiffGroups}
          selectedPresetChangedEntries={effectivePresetChangedEntries}
          selectedPresetInvalidEntries={effectivePresetInvalidEntries}
          droppedPresetParamIds={droppedPresetParamIds}
          onTogglePresetParamDrop={togglePresetParamDrop}
          savedSnapshots={savedSnapshots}
          presetApplyAcknowledged={presetApplyAcknowledged}
          setPresetApplyAcknowledged={setPresetApplyAcknowledged}
          onTogglePreset={togglePresetSelection}
          runtime={runtime}
          formatCategoryLabel={formatCategoryLabel}
          onApplySelectedPreset={handleApplySelectedPreset}
          onStageSelectedPresetDiff={handleStageSelectedPresetDiff}
          onEraseSettings={handleEraseSettings}
          userPresets={libraries.savedUserPresets}
          onImportUserPresets={handleImportUserPresets}
          setPresetNotice={setPresetNotice}
        />
      ) : null}

      {activeViewId === 'rc-mixer' ? (
      <RcMixerView
        channels={hasRcLogicParams ? rcLogicChannels : rcMixerChannels}
        functionCatalog={hasRcLogicParams ? rcLogicFunctionCatalogMemo : rcMixerFunctionCatalog}
        functionLookup={hasRcLogicParams ? rcLogicFunctionLookup : rcMixerFunctionLookup}
        livePwmByChannel={rcMixerLivePwmByChannel}
        rcLinkLive={snapshot.liveVerification.rcInput.verified}
        onAddAssignment={hasRcLogicParams ? handleRcLogicAddAssignment : handleRcMixerAddAssignment}
        onRemoveAssignment={hasRcLogicParams ? handleRcLogicRemoveAssignment : handleRcMixerRemoveAssignment}
        onUpdateAssignment={hasRcLogicParams ? handleRcLogicUpdateAssignment : handleRcMixerUpdateAssignment}
        firmwareSupported={hasRcLogicParams}
        engineEnabled={rcLogicModel.enabled}
        onToggleEngine={handleRcLogicToggleEngine}
        logicTerms={hasRcLogicParams ? rcLogicVisibleLogicTerms : undefined}
        onAddLogicTerm={handleRcLogicAddLogicTerm}
        onUpdateLogicTerm={handleRcLogicUpdateLogicTerm}
        onRemoveLogicTerm={handleRcLogicRemoveAssignment}
        tableFull={rcLogicModel.freeTermIndex === null}
        externalClaimByChannel={externalChannelClaims}
        vtxPowerLevels={rcMixerVtxPowerLevels}
      />
      ) : null}

      {activeViewId === 'networking' ? (
      <NetworkingView
        hasParameters={hasNetworkingParams}
        activeTab={networkingTab}
        onTabChange={setNetworkingTab}
        dronenetNodeCount={networkCanBusState.nodes.length}
        scanning={snapshot.canBus.status === 'active' || snapshot.canBus.status === 'requesting'}
        passthroughSlot={dronenetPassthroughEditors.length > 0 ? <>{dronenetPassthroughEditors}</> : null}
        settingsSlot={renderAdditionalSettingsCard(
          'Network settings',
          'ArduPilot NET_ parameters — IP addressing (Ethernet/PPP), DHCP, gateway, MAC, and network serial endpoints.',
          networkingGroups,
          networkingDraftEntries,
          networkingStagedDrafts,
          networkingInvalidDrafts,
          'networking:apply',
          'Apply Network Changes',
          'network settings',
          renderNetworkingField
        )}
        dronecanSlot={
          <CanBusView
            state={networkCanBusState}
            vehicleConnected={snapshot.connection.kind === 'connected'}
            selfNodeIds={canSelfNodeIds}
            onStartForward={(bus) => { void runtime?.startCanBusForward(bus) }}
            onStopForward={() => { void runtime?.stopCanBusForward() }}
            onRefreshNode={(nodeId) => { runtime?.refreshCanBusNode(nodeId) }}
            onFetchAllParameters={(nodeId) => { runtime?.fetchAllCanBusParameters(nodeId) }}
            onApplyAndSave={(nodeId, writes) => { void runtime?.applyAndSaveCanBusParameters(nodeId, writes) }}
            paramMetadata={(name) => metadataCatalog.parameters[name] ?? AP_PERIPH_PARAM_METADATA[name]}
            title="DroneNet peripherals"
            subtitle="Configure a DroneCAN peripheral's network settings — its NET_ parameters, written over the CAN bus and saved to the node. Start the bus to discover nodes; no need to leave this tab."
          />
        }
      />
      ) : null}

      {activeViewId === 'lua' ? (
      <LuaScriptsView
        connected={snapshot.connection.kind === 'connected'}
        capability={luaScriptsModel.capability}
        scriptsDir={LUA_SCRIPTS_DIR}
        cards={luaScriptCards}
        installed={luaScripts.installed}
        installedLoading={luaScripts.installedLoading}
        installedError={luaScripts.installedError}
        notice={luaScripts.notice}
        busyAction={luaScripts.busyAction}
        onEnableScripting={luaScripts.enableScripting}
        onReboot={luaScripts.reboot}
        onRestartScripting={luaScripts.restartScripting}
        onStopScripting={luaScripts.stopScripting}
        onRefresh={luaScripts.refresh}
        onInstall={luaScripts.install}
        onRemove={luaScripts.remove}
        onUpload={luaScripts.upload}
      />
      ) : null}

      {activeViewId === 'ai-assistant' ? (
      <AiAssistantView
        connected={snapshot.connection.kind === 'connected'}
        configReady={aiAssistant.configReady}
        status={aiAssistant.status}
        error={aiAssistant.error}
        transcript={aiTranscript}
        providerId={aiAssistant.settings.providerId}
        model={aiAssistant.settings.model}
        baseUrl={aiAssistant.settings.baseUrl}
        apiKey={aiAssistant.apiKey}
        rememberKey={aiAssistant.settings.rememberKey}
        allowProposals={aiAssistant.settings.allowProposals}
        availableModels={aiAssistant.availableModels}
        modelsStatus={aiAssistant.modelsStatus}
        modelsError={aiAssistant.modelsError}
        onRefreshModels={aiAssistant.refreshModels}
        onProviderChange={aiAssistant.setProviderId}
        onModelChange={aiAssistant.setModel}
        onBaseUrlChange={aiAssistant.setBaseUrl}
        onApiKeyChange={aiAssistant.setApiKey}
        onRememberKeyChange={aiAssistant.setRememberKey}
        onAllowProposalsChange={aiAssistant.setAllowProposals}
        proposal={aiAssistant.pendingProposal}
        writeBlockReason={aiWriteBlockReason}
        onApplyProposal={aiAssistant.applyProposal}
        onDiscardProposal={aiAssistant.discardProposal}
        onSend={aiAssistant.send}
        onStop={aiAssistant.stop}
        onClear={aiAssistant.clear}
      />
      ) : null}

      {activeViewId === 'can' ? (
      <CanBusView
        state={snapshot.canBus}
        vehicleConnected={snapshot.connection.kind === 'connected'}
        selfNodeIds={canSelfNodeIds}
        onStartForward={(bus) => { void runtime?.startCanBusForward(bus) }}
        onStopForward={() => { void runtime?.stopCanBusForward() }}
        onRefreshNode={(nodeId) => { runtime?.refreshCanBusNode(nodeId) }}
        onFetchAllParameters={(nodeId) => { runtime?.fetchAllCanBusParameters(nodeId) }}
        onApplyAndSave={(nodeId, writes) => { void runtime?.applyAndSaveCanBusParameters(nodeId, writes) }}
        paramMetadata={(name) => metadataCatalog.parameters[name] ?? AP_PERIPH_PARAM_METADATA[name]}
        enablement={canEnablement.needsEnable ? { triggerLabels: canEnablement.triggerLabels } : undefined}
        onEnableCanBus={runtime ? () => { void handleEnableCanBus() } : undefined}
        enableBusy={busyAction === 'can:enable'}
        // --- folded-in DroneCAN inspector (was a separate expert-only tab) ---
        framesPerSec={dronecanFramesPerSec}
        escTelemetry={snapshot.canBus.escTelemetry}
        busy={busyAction !== undefined}
        // Restart + firmware update were expert-gated by living in the expert-only
        // inspector tab; the CAN tab is always visible, so the gate moves here
        // rather than being lost in the merge.
        expertActions={isExpertMode ? canDeviceExpertActions : undefined}
        popout={{
          openNodeIds: canDevicePopouts.openNodeIds,
          onOpen: (nodeId, label) => canDevicePopouts.openDevice(nodeId, label),
          onClose: (nodeId) => canDevicePopouts.closeDevice(nodeId),
          blockedNodeId: canDevicePopouts.blockedNodeId
        }}
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
          onEnterRomDfu={
            // The genuine STM32 ROM DFU path, distinct from the ArduPilot
            // bootloader above. Same connectivity requirement.
            runtime && snapshot.connection.kind === 'connected'
              ? async () => { await runtime.rebootToDfu() }
              : undefined
          }
          onResetParameters={
            // Same action the Presets tab's "Erase settings" runs — reset then
            // reboot. Surfaced here too because an operator debugging a board
            // is on the Flash tab, and flashing is exactly what does NOT do it.
            runtime && snapshot.connection.kind === 'connected'
              ? async () => {
                  // Deliberately NOT handleEraseSettings: that one reports
                  // through setPresetNotice, which is on another tab, and
                  // swallows the error — so the Flash tab would have announced
                  // success over a failed reset. The flasher shows the outcome
                  // itself, so it needs the throw.
                  await runtime.resetParametersToDefaults()
                  try {
                    await runtime.reboot()
                  } catch {
                    // The reset landed; a missing reboot ack is not a failure
                    // (the operator can power-cycle). Same call as the Presets
                    // path makes.
                  }
                }
              : undefined
          }
          resetParametersDisabledReason={
            snapshot.connection.kind !== 'connected'
              ? 'Connect to a vehicle first to reset parameters.'
              : snapshot.vehicle?.armed
                ? 'Disarm the vehicle before resetting parameters.'
                : undefined
          }
          enterDfuDisabledReason={
            snapshot.connection.kind !== 'connected'
              ? 'Connect to a vehicle first to send a DFU reboot command.'
              : snapshot.vehicle?.armed
                ? 'Disarm the vehicle before requesting a DFU reboot.'
                : undefined
          }
          onFlashBootloader={
            // Re-flashes the bootloader embedded in the RUNNING firmware, so it
            // needs a live MAVLink link and no DFU cable.
            runtime && snapshot.connection.kind === 'connected'
              ? async () => { await runtime.flashBootloader() }
              : undefined
          }
          flashBootloaderDisabledReason={
            snapshot.connection.kind !== 'connected'
              ? 'Connect to a vehicle first to update the bootloader.'
              : snapshot.vehicle?.armed
                ? 'Disarm the vehicle before updating the bootloader.'
                : undefined
          }
          // Expert-gated the same way the CAN tab gates its node actions: pass
          // undefined in basic mode and the block does not exist at all. A
          // developer affordance — it identifies the two images but changes
          // nothing about the flash, including its existing arm/confirm gate.
          bootloaderIdentity={isExpertMode ? bootloaderIdentity.preview : undefined}
          onLoadBootloaderIdentity={isExpertMode ? bootloaderIdentity.load : undefined}
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

      {activeViewId === 'elrs-flash' ? (
        <ElrsFlasher
          snapshot={snapshot}
          isConnected={snapshot.connection.kind === 'connected'}
          busy={elrsFlasherBusy}
          bridgeArmed={elrsBridgeArmed}
          notice={elrsFlasherNotice}
          onArmPassthrough={handleArmElrsPassthrough}
          onCancel={handleCancelElrsPassthrough}
          onFlash={handleFlashElrs}
          flashProgress={elrsFlashProgress}
        />
      ) : null}

      {activeViewId === 'files' ? (
        <FilesView
          path={filesBrowser.path}
          entries={filesBrowser.entries}
          loading={filesBrowser.loading}
          error={filesBrowser.error}
          busyAction={busyAction}
          downloadProgress={filesBrowser.downloadProgress}
          vehicleConnected={snapshot.connection.kind === 'connected'}
          onNavigate={filesBrowser.navigate}
          onRefresh={filesBrowser.refresh}
          onDownload={filesBrowser.download}
          onUpload={filesBrowser.upload}
          onDelete={filesBrowser.remove}
          onSanitize={filesBrowser.sanitize}
        />
      ) : null}

      {activeViewId === 'mavlink-inspector' ? (
        <MavlinkInspectorView
          stats={mavlinkInspectorStats}
          sentStats={mavlinkInspectorSentStats}
          connected={snapshot.connection.kind === 'connected'}
          paused={mavlinkInspectorPaused}
          onTogglePause={() => setMavlinkInspectorPaused(!mavlinkInspectorPaused)}
          onClear={clearMavlinkInspector}
          sourceHealth={mavlinkInspectorSourceHealth}
          onRequestMessage={
            runtime
              ? async ({ kind, messageId, rateHz }) => {
                  const result =
                    kind === 'once'
                      ? await runtime.requestMessageOnce(messageId)
                      : await runtime.requestMessageInterval(
                          messageId,
                          intervalUsForRate(kind === 'disable' ? -1 : rateHz)
                        )
                  return { ok: result.ok, resultLabel: result.resultLabel }
                }
              : undefined
          }
          onExportSnapshot={exportMavlinkInspectorSnapshot}
          recording={mavlinkInspectorRecording}
          recordedCount={mavlinkInspectorRecordedCount}
          recordingCapped={mavlinkInspectorRecordingCapped}
          recordingMax={mavlinkInspectorRecordingMax}
          onStartRecording={startMavlinkInspectorRecording}
          onStopRecording={stopMavlinkInspectorRecording}
          onDownloadRecording={downloadMavlinkInspectorRecording}
          plots={mavlinkInspectorPlots}
          onAddPlot={addMavlinkInspectorPlot}
          onRemovePlot={removeMavlinkInspectorPlot}
          onExportPlotCsv={exportMavlinkInspectorPlotCsv}
          maxPlots={MAX_MAVLINK_PLOTS}
        />
      ) : null}

      {/* Popped-out CAN device inspectors. Rendered OUTSIDE the activeViewId
          switch (and portalled into their own windows) so a device an operator
          tore off stays up while they work in another tab — the windows are
          views onto the one runtime snapshot, never a second session. CAN
          forwarding is untouched by opening/closing them: the runtime's CAN bus
          service owns the MAV_CMD_CAN_FORWARD keep-alive for as long as the bus
          is connected. */}
      {canDevicePopouts.windows.map(({ nodeId, handle }) => {
        const node = snapshot.canBus.nodes.find((entry) => entry.nodeId === nodeId)
        return createPortal(
          node ? (
            <CanDeviceInspectorView
              node={node}
              isSelf={canSelfNodeIds.includes(nodeId)}
              paramMetadata={(name) => metadataCatalog.parameters[name] ?? AP_PERIPH_PARAM_METADATA[name]}
              draftValues={canDevicePopouts.draftValues}
              onDraftChange={canDevicePopouts.setDraft}
              onDropDraft={canDevicePopouts.dropDraft}
              onDropAllDrafts={canDevicePopouts.dropAllDrafts}
              onApplyAndSave={(id, writes) => {
                void runtime?.applyAndSaveCanBusParameters(id, writes)
                canDevicePopouts.dropDrafts(id, writes.map((write) => write.name))
              }}
              onRefreshNode={(id) => { runtime?.refreshCanBusNode(id) }}
              onFetchAllParameters={(id) => { runtime?.fetchAllCanBusParameters(id) }}
              busy={busyAction !== undefined}
              expertActions={isExpertMode ? canDeviceExpertActions : undefined}
              // Real filtering, not a label: this window only ever shows this
              // node's ESC telemetry out of the bus-wide stream.
              escTelemetry={filterEscTelemetryForNode(snapshot.canBus.escTelemetry, nodeId)}
              heading={node.name && node.name.length > 0 ? node.name : `Node ${nodeId}`}
            />
          ) : (
            <p className="can-bus-empty" data-testid={`can-device-popout-missing-${nodeId}`}>
              Node {nodeId} is no longer reporting on the bus. This window updates again if it comes back.
            </p>
          ),
          handle.container,
          handle.key
        )
      })}

      {/* Popped-out Recent Notices — the same portal contract as the CAN
          inspectors above, and hosted here at App level for the same reason: the
          operator pops the feed out precisely so it survives leaving Status &
          Info. Because it is a portal into this tree it re-renders off the one
          runtime subscription, so every STATUSTEXT that lands in the snapshot
          appears in the window with no second session, no second stream request,
          and nothing to re-arm on reconnect. */}
      {noticesPopoutHandle
        ? createPortal(
            <article className="setup-gui-box" data-testid="notices-popout-panel">
              <div className="setup-gui-box__titlebar">
                <strong>Recent Notices</strong>
                {recentNoticesBadge(recentNotices)}
              </div>
              <div className="setup-gui-box__body">
                <RecentNoticesFeed
                  {...sharedNoticeFeedProps}
                  variant="popout"
                  testIdPrefix="notices-popout"
                  entryTestIdPrefix="notices-popout-notice"
                />
              </div>
            </article>,
            noticesPopoutHandle.container,
            noticesPopoutHandle.key
          )
        : null}

      {activeViewId === 'calibration' ? (
        <CalibrationSection
          snapshot={snapshot}
          runtime={runtime}
          busyAction={busyAction}
          canApplyDraftParameters={canApplyDraftParameters}
          airframe={airframe}
          isCopterVehicle={isCopterVehicle}
          isExpertMode={isExpertMode}
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
          sections={configSections.map((section) => {
            if (section.id === 'esc-dshot') {
              return { ...section, footer: renderEscDshotFooter() }
            }
            if (section.id === 'board-orientation') {
              return { ...section, footer: renderBoardOrientationFooter() }
            }
            return section
          }).concat([
            {
              id: 'flight-modes',
              title: 'Flight modes',
              description:
                'Which mode each switch position selects, the mode channel, and the live position reported by the vehicle.',
              category: 'flight-modes' as const,
              wide: true,
              fields: [],
              footer: renderFlightModesFooter()
            },
            {
              id: 'power',
              title: 'Battery & power',
              description:
                'Battery monitor, capacity, and the arming thresholds that depend on them, with live voltage and current from the vehicle.',
              category: 'power' as const,
              wide: true,
              fields: [],
              footer: renderPowerSectionFooter()
            }
          ])}
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
          resetToDefaultsSlot={
            <ResetToDefaultsButton
              // Same gated handler the Presets view uses — one destructive
              // code path, one set of guards, rather than a second
              // reimplementation per surface.
              onReset={
                runtime && snapshot.connection.kind === 'connected'
                  ? () => void handleEraseSettings()
                  : undefined
              }
              disabledReason={
                snapshot.connection.kind !== 'connected'
                  ? 'Connect to a vehicle first.'
                  : snapshot.vehicle?.armed
                    ? 'Disarm the vehicle before erasing settings.'
                    : undefined
              }
              isResetting={busyAction === 'presets:erase'}
              isBusy={busyAction !== undefined}
              suggestSnapshot={true}
            />
          }
          snapshot={snapshot}
          metadataCatalog={metadataCatalog}
          canApplyDraftParameters={canApplyDraftParameters}
          canApplyAllDraftParameters={canApplyAllDraftParameters}
          busyAction={busyAction}
          applyAllBusyLabel={applyAllBusyLabel}
          editedValues={editedValues}
          parameterNotice={parameterNotice}
          parameterFollowUp={parameterFollowUp}
          scrollToChangesRequestId={showChangesRequestId}
          formatCategoryLabel={formatCategoryLabel}
          parameterSearch={parameterSearch}
          parameterExactSearch={parameterExactSearch}
          setParameterExactSearch={setParameterExactSearch}
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
          parameterExportExclusions={parameterExportExclusions}
          onToggleParameterExportExclusion={(category) =>
            setParameterExportExclusions((current) => ({
              ...current,
              [category]: !current[category]
            }))
          }
          onExportParameterBackup={handleExportParameterBackup}
          handleUploadParameterBackup={handleUploadParameterBackup}
          parameterBackupUploadTarget={parameterBackupUploadTarget}
          artifactUpload={backupArtifactUpload}
          onExportParameterBackupAsParm={handleExportParameterBackupAsParm}
          onExportParameterBackupAsParams={handleExportParameterBackupAsParams}
          onImportParameterBackup={handleImportParameterBackup}
          pendingParameterImport={pendingParameterImport}
          onStagePendingParameterImport={stagePendingParameterImport}
          onStagePendingParameterImportSubset={stagePendingParameterImportSubset}
          importedDraftOrigins={importedDraftOrigins}
          onDropPendingParameterImportEntries={dropPendingParameterImportEntries}
          onDismissPendingParameterImport={dismissPendingParameterImport}
          onRefreshParameters={() => handleGuidedAction('request-parameters')}
          refreshDisabled={busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')}
          parameterEnumOverrides={parameterEnumOverrides}
          onToggleParameterEnumOverride={handleToggleParameterEnumOverride}
          onRequestReboot={() => void handleGuidedAction('reboot-autopilot')}
          nonDefaultParamIds={nonDefaultParamIds}
          parameterDefaults={parameterDefaults}
          showOnlyNonDefault={showOnlyNonDefault}
          // Ticking "show only changed" fetches the firmware defaults it needs,
          // rather than requiring the operator to press a separate button first.
          // Fetching defaults was never the goal — it only ever existed to make
          // this filter possible, so making it a prerequisite step pushed the
          // app's bookkeeping onto the operator. Already-fetched defaults are
          // reused; only turning the filter ON triggers a fetch.
          recentlyWrittenParamIds={recentlyWrittenParamIds}
          onToggleShowOnlyNonDefault={() => {
            const enabling = !showOnlyNonDefault
            if (enabling && !nonDefaultParamIds && !fetchDefaultsBusy) {
              // handleFetchParamDefaults flips the filter on itself once the
              // defaults land, so a failed fetch leaves the filter off rather
              // than on-but-showing-everything.
              void handleFetchParamDefaults()
              return
            }
            setShowOnlyNonDefault(enabling)
          }}
          onFetchParamDefaults={handleFetchParamDefaults}
          fetchDefaultsBusy={fetchDefaultsBusy}
          onCreateUserPreset={handleCreateUserPreset}
        />
      ) : null}
        </div>
      </div>



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
        {/* Same view model as the Pre-arm box, so the footer can never disagree
            with the card — and so a live failure we have no text for yet reads
            as "Pre-arm blocked" rather than the old "0 pre-arm issues". */}
        {preArmStatusViewModel.healthy
          ? <span className="app-status-bar__item is-ok"><span className="dot" />Pre-arm clear</span>
          : <span className="app-status-bar__item is-warn"><span className="dot" />{preArmStatusViewModel.issues.length === 0 ? 'Pre-arm blocked' : `${preArmStatusViewModel.issues.length} pre-arm issues`}</span>}
        <span className="app-status-bar__spacer" />
        <span className="app-status-bar__item">
          {missionTitleForView(activeViewId)}
        </span>
      </footer>
    </main>
    </>
  )
}
