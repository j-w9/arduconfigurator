export type GuidedActionId =
  | 'request-parameters'
  | 'calibrate-accelerometer'
  // Simple board-level calibration — distinct from the 6-pose accel cal.
  // Operator sets the FC level on a flat surface; AP samples gravity and
  // stores AHRS_TRIM_X / AHRS_TRIM_Y. Triggered via
  // MAV_CMD_PREFLIGHT_CALIBRATION param5=2. Mission Planner's
  // "Calibrate Level" button does the same.
  | 'calibrate-level'
  | 'calibrate-compass'
  | 'reboot-autopilot'

export type LiveSignalId = 'rc-input' | 'battery-telemetry'
export type AppViewId =
  | 'setup'
  | 'ports'
  | 'vtx'
  | 'osd'
  | 'receiver'
  | 'modes'
  // The old monolithic 'outputs' tab was split into two distinct
  // workflows: 'motors' (speed control — motor setup, direction tests,
  // ESC protocol, verification review) and 'servos' (position control —
  // peripheral servo function assignments for gimbal/parachute/gripper,
  // ArduPlane control surfaces, etc.). The 'outputs' parameter category
  // and Setup section ids stay, since param grouping and the Setup
  // checklist work as a single block — only the nav was split.
  | 'motors'
  | 'servos'
  | 'power'
  | 'failsafe'
  | 'logs'
  | 'snapshots'
  | 'tuning'
  | 'presets'
  // BF-style catch-all "Configuration" surface for baseline misc:
  // board orientation, arming behavior, beeper, system identity,
  // statistics — items that don't fit cleanly into a dedicated tab.
  // Currently a placeholder scaffold; section coverage grows as the
  // operator decides what belongs there.
  | 'config'
  | 'parameters'
  // 'rc-mixer' is a UI scaffold (still NOT added to any metadata catalog's
  // appViews list). The configurator injects it into the nav at render time.
  | 'rc-mixer'
  // 'can' is the DroneCAN inspector tab — connects via MAV_CMD_CAN_FORWARD,
  // discovers nodes from passive NodeStatus broadcasts, fetches identity
  // via GetNodeInfo, and supports per-node parameter read/write/save via
  // the param.GetSet and param.ExecuteOpcode services. Like 'rc-mixer',
  // injected at render time rather than via the metadata catalogs.
  | 'can'
  // 'flash' is the firmware-flasher tab — promotes the previously
  // modal-only flasher to a first-class nav surface so DFU entry,
  // custom-build-server URL, and the flash wizard live in one place.
  // Injected at render time (no metadata-driven category) since
  // firmware management is orthogonal to vehicle catalogs.
  | 'flash'
  // 'files' is the MAVFTP file browser — lists/downloads/uploads/deletes
  // files on the FC filesystem (@SYS virtual files, /APM, scripts) over
  // the MAVLink FTP service. Injected at render time; request/response
  // based, not streamed into the snapshot.
  | 'files'
  // 'calibration' is a dedicated surface for the sensor calibration actions
  // (accelerometer / level / compass) — the same guided-action flow the
  // Setup wizard drives, gathered into one tab. Injected at render time.
  | 'calibration'
  // Expert-only read-only inspectors, injected at render time:
  // 'mavlink-inspector' — live decoded MAVLink message stream (type/rate/last
  // value); 'dronecan-inspector' — live DroneCAN bus traffic by node/message.
  | 'mavlink-inspector'
  | 'dronecan-inspector'

export interface ParameterValueOption {
  value: number
  label: string
  description?: string
}

export interface ParameterDefinition {
  id: string
  label: string
  description: string
  category: string
  unit?: string
  minimum?: number
  maximum?: number
  step?: number
  rebootRequired?: boolean
  snapshotExcluded?: boolean
  notes?: string[]
  options?: ParameterValueOption[]
  /**
   * When true, `options` enumerate BIT INDICES (0, 1, 2, …) rather than
   * mutually-exclusive values, and the generic editor renders the
   * parameter as a grid of per-bit checkboxes whose OR is the stored
   * value (see ScopedBitmaskField).
   */
  bitmask?: boolean
  /**
   * Conditional visibility. When set, the generic editor renders this field
   * only if the controlling parameter `paramId`'s current value (the live
   * value, or the in-flight draft if one is staged) is one of `in`. Used for
   * type-specific knobs — e.g. analog rangefinder pin/scaling shown only when
   * RNGFND1_TYPE = Analog. Value is rounded before comparison.
   */
  visibleWhen?: { paramId: string; in: number[] }
}

export interface PresetGroupDefinition {
  id: string
  label: string
  description: string
  order: number
}

export interface ParameterPresetValue {
  paramId: string
  value: number
}

export interface PresetCompatibilityDefinition {
  frameClasses?: number[]
}

export interface PresetDefinition {
  id: string
  label: string
  description: string
  groupId: string
  order: number
  values: ParameterPresetValue[]
  note?: string
  tags?: string[]
  prerequisites?: string[]
  cautions?: string[]
  compatibility?: PresetCompatibilityDefinition
}

export interface AppViewDefinition {
  id: AppViewId
  label: string
  description: string
  order: number
}

export interface ParameterCategoryDefinition {
  id: string
  label: string
  description: string
  order: number
  viewId: AppViewId
}

export interface SetupSectionDefinition {
  id: string
  title: string
  description: string
  requiredParameters: string[]
  /**
   * Parameter ids whose value must be non-zero (a defined integer >= 1 or a
   * finite non-zero float) for the section to count as complete. This catches
   * the case where a param IS present in the snapshot (the FC reports it) but
   * its value is 0 / "unset" — e.g. FRAME_CLASS=0 means the operator has not
   * picked a frame class, the autopilot is reporting "Frame: UNSUPPORTED",
   * and every calibration COMMAND will be refused. Without this, the section
   * status read "complete" purely because the param key existed.
   */
  requiredNonZeroParameters?: string[]
  /**
   * At least ONE of the listed params must have a non-zero value for the
   * section to count as complete. Captures the "configured something"
   * semantic: e.g. Outputs is not done while every SERVOn_FUNCTION is still
   * 0 (no motor assigned anywhere). Unlike requiredNonZeroParameters which
   * is an AND-of-non-zero, this is an OR-of-non-zero. Use both when needed
   * (e.g. require FRAME_CLASS != 0 AND at least one SERVOn_FUNCTION != 0).
   */
  requiredAnyNonZeroParameters?: string[]
  requiredLiveSignals?: LiveSignalId[]
  completionStatusTexts?: string[]
  /**
   * Alternative evidence that the calibration ran successfully in a PREVIOUS
   * session. `completionStatusTexts` only fires when the runtime sees the
   * specific success banner mid-session — so a reconnected, already-calibrated
   * autopilot stayed stuck on "in-progress" forever even though the cal was
   * complete. Whenever any param in this list has a non-zero value (truthy
   * finite number other than 0) the completion-text gate is treated as
   * satisfied. Typical wiring: AHRS_TRIM_X/Y for level cal,
   * INS_ACCOFFS_X/Y/Z for accelerometer cal, COMPASS_OFS_X/Y/Z for compass
   * cal — all of which the autopilot writes only after a successful run.
   */
  completionEvidenceNonZeroParameters?: string[]
  actions?: GuidedActionId[]
}

export interface FirmwareMetadataBundle {
  firmware: 'ArduCopter' | 'ArduPlane' | 'ArduRover' | 'ArduSub'
  appViews?: AppViewDefinition[]
  categories?: Record<string, ParameterCategoryDefinition>
  presetGroups?: Record<string, PresetGroupDefinition>
  presets?: Record<string, PresetDefinition>
  parameters: Record<string, ParameterDefinition>
  setupSections: SetupSectionDefinition[]
}

export interface NormalizedParameterDefinition extends ParameterDefinition {
  categoryDefinition: ParameterCategoryDefinition
}

export interface NormalizedPresetDefinition extends Omit<PresetDefinition, 'tags'> {
  groupDefinition: PresetGroupDefinition
  tags: string[]
}

export interface NormalizedFirmwareMetadataBundle {
  firmware: FirmwareMetadataBundle['firmware']
  appViews: AppViewDefinition[]
  categories: ParameterCategoryDefinition[]
  categoryById: Record<string, ParameterCategoryDefinition>
  presetGroups: PresetGroupDefinition[]
  presetGroupById: Record<string, PresetGroupDefinition>
  presets: NormalizedPresetDefinition[]
  presetsByGroup: Record<string, NormalizedPresetDefinition[]>
  parameters: Record<string, NormalizedParameterDefinition>
  parametersByCategory: Record<string, NormalizedParameterDefinition[]>
}
