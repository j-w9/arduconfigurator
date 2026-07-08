// Read-only tool definitions + executor for the AI Assistant (slice 1).
//
// These are MCP-style tools: each has a name, a description, and a JSON-schema
// input contract, and each resolves purely from the live ConfiguratorSnapshot
// via an injected accessor. The schemas are deliberately provider-neutral and
// MCP-portable, so a future desktop-hosted MCP server can expose the exact same
// contract.
//
// SLICE 1 IS READ-ONLY. No tool here mutates a parameter or issues a vehicle
// command — the model physically cannot change the aircraft. The write path
// (propose -> human approves -> runtime.setParameters) is a separate later
// slice. Keeping writes out also keeps prompt-injection (e.g. via STATUSTEXT
// the model reads through get_telemetry / get_prearm_status) inert.

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

/** Minimal JSON-schema shape for a tool's input contract. */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolInputSchema
}

/** The single seam through which tools read live vehicle state. Injected by the
 *  app with `() => runtime.getSnapshot()`; the package never touches the runtime
 *  instance directly, keeping it UI/transport-agnostic. */
export interface SnapshotAccessor {
  getSnapshot(): ConfiguratorSnapshot
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

/** Hard cap so a single list/search call can never blow the model's context
 *  with a full ~1000-param dump. The model pages with offset/limit. */
const DEFAULT_PARAM_PAGE = 100
const MAX_PARAM_PAGE = 300
/** Cap on how many ids get_parameters will detail in one call — keeps a single
 *  batched lookup bounded even if the model asks for an unreasonably long list. */
const MAX_BATCH_PARAMETERS = 50

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  if (rounded < 0) return fallback
  return Math.min(rounded, max)
}

/** Real (non-alias-mirror) params only — mirrors would double-count. */
function realParameters(snapshot: ConfiguratorSnapshot): ParameterState[] {
  return snapshot.parameters.filter((parameter) => parameter.aliasedFrom === undefined)
}

/** Compact {id, value} projection for list/search — no metadata, so the model
 *  can scan hundreds cheaply, then drill in with get_parameter. */
function compactParam(parameter: ParameterState): { id: string; value: number } {
  return { id: parameter.id, value: parameter.value }
}

/** Full metadata projection for a single param the model asked about. */
function detailParam(parameter: ParameterState): Record<string, unknown> {
  const definition = parameter.definition
  return {
    id: parameter.id,
    value: parameter.value,
    unit: definition?.unit,
    label: definition?.label,
    description: definition?.description,
    minimum: definition?.minimum,
    maximum: definition?.maximum,
    rebootRequired: definition?.rebootRequired ?? false,
    options: definition?.options?.map((option) => ({
      value: option.value,
      label: option.label
    })),
    bitmask: definition?.bitmask ?? undefined
  }
}

/** One parameter change the model proposes. `reason` is shown to the human on
 *  the approval card. Semantic validation (range/enum/exists) happens web-side
 *  against the live snapshot — this is just the wire shape. */
export interface ProposedChange {
  paramId: string
  value: number
  reason?: string
}

/** Upper bound on a single proposal, so a runaway response cannot stage a huge
 *  batch. Enforced by parseProposedChanges. */
export const MAX_PROPOSED_CHANGES = 40

// The one WRITE-INTENT tool. It does NOT write — the app dispatches it specially,
// validates it against the live snapshot, and stages it for explicit human
// approval. Only a human click applies it. Kept out of createToolExecutor (which
// stays strictly read-only) precisely so it can never execute a write here.
export const PROPOSE_PARAM_CHANGES_TOOL: ToolDefinition = {
  name: 'propose_param_changes',
  description:
    'Propose one or more parameter changes for the USER to review and approve. This does NOT apply anything — it stages a diff the user must explicitly approve and apply. Use exact parameter ids and values within each parameter\'s valid range. Give a short reason per change. Never claim you have applied changes; you can only propose them.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One-sentence summary of what this set of changes accomplishes.' },
      changes: {
        type: 'array',
        description: `The proposed changes (max ${MAX_PROPOSED_CHANGES}).`,
        items: {
          type: 'object',
          properties: {
            paramId: { type: 'string', description: 'Exact parameter id, e.g. "ATC_RAT_PIT_P".' },
            value: { type: 'number', description: 'The proposed new value.' },
            reason: { type: 'string', description: 'Why this change (shown to the user).' }
          },
          required: ['paramId', 'value']
        }
      }
    },
    required: ['changes'],
    additionalProperties: false
  }
}

export interface ParsedProposal {
  summary?: string
  changes: ProposedChange[]
}

/** Validate + normalize raw propose_param_changes arguments (shape + cap only).
 *  Returns the parsed proposal or a human-readable error. */
export function parseProposedChanges(
  args: Record<string, unknown>,
  maxChanges: number = MAX_PROPOSED_CHANGES
): { proposal: ParsedProposal } | { error: string } {
  const rawChanges = args.changes
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    return { error: 'Proposal must include a non-empty "changes" array.' }
  }
  if (rawChanges.length > maxChanges) {
    return { error: `Too many changes (${rawChanges.length}); propose at most ${maxChanges} at once.` }
  }
  const changes: ProposedChange[] = []
  for (const raw of rawChanges) {
    if (typeof raw !== 'object' || raw === null) {
      return { error: 'Each change must be an object with paramId and value.' }
    }
    const candidate = raw as Record<string, unknown>
    const paramId = candidate.paramId
    const value = candidate.value
    if (typeof paramId !== 'string' || paramId.length === 0) {
      return { error: 'Each change needs a non-empty string "paramId".' }
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `Change for "${paramId}" needs a finite numeric "value".` }
    }
    changes.push({
      paramId,
      value,
      reason: typeof candidate.reason === 'string' ? candidate.reason : undefined
    })
  }
  return {
    proposal: {
      summary: typeof args.summary === 'string' ? args.summary : undefined,
      changes
    }
  }
}

/** The tool set offered to the provider. Read-only always; the propose tool is
 *  added only when the user has left proposals enabled. */
export function toolsFor(options: { allowProposals: boolean }): ToolDefinition[] {
  return options.allowProposals ? [...AI_ASSISTANT_TOOLS, PROPOSE_PARAM_CHANGES_TOOL] : [...AI_ASSISTANT_TOOLS]
}

export const AI_ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_vehicle_info',
    description:
      'Identity and live status of the connected flight controller: firmware, vehicle type (ArduCopter/Plane/Rover/Sub), armed state, current flight mode, decoded system status, board type, and firmware version. Call this first to ground your understanding of what is connected.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_parameters',
    description:
      'List parameter ids and current values (compact — no metadata). There can be ~1000+ params, so results are paged. Use `prefix` to scope to a family (e.g. "INS_", "ATC_", "SERVO"). Use get_parameter or search_parameters to get labels/units/ranges for specific ids.',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Only return ids starting with this (case-insensitive).' },
        offset: { type: 'number', description: 'Skip this many matches (paging). Default 0.' },
        limit: { type: 'number', description: `Max results, capped at ${MAX_PARAM_PAGE}. Default ${DEFAULT_PARAM_PAGE}.` }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_parameter',
    description:
      'Full detail for ONE parameter: current value plus its label, description, unit, valid range, enum options, and whether a reboot is required to apply. Use the exact parameter id (e.g. "ATC_RAT_PIT_P"). If you need detail on more than one parameter, call get_parameters instead of calling this repeatedly — it returns the same detail for many ids in a single round trip.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Exact parameter id.' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'get_parameters',
    description:
      `Full detail (value, label, description, unit, range, enum options) for MULTIPLE parameters in one call — the batched form of get_parameter. Always prefer this over several individual get_parameter calls when you already know which ids you need (e.g. after list_parameters or search_parameters). Unknown ids are reported separately rather than failing the whole call. Max ${MAX_BATCH_PARAMETERS} ids per call.`,
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: `Exact parameter ids, max ${MAX_BATCH_PARAMETERS}.`
        }
      },
      required: ['ids'],
      additionalProperties: false
    }
  },
  {
    name: 'search_parameters',
    description:
      'Find parameters by fuzzy text across id, label, and description (e.g. "battery failsafe", "notch filter", "compass orientation"). Returns matching ids with their labels and current values. Follow up with get_parameters (batched) for full detail on the ones you need — not one get_parameter call per id.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query.' },
        limit: { type: 'number', description: `Max results, capped at ${MAX_PARAM_PAGE}. Default 25.` }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'get_telemetry',
    description:
      'Live telemetry snapshot: RC input channels, battery voltage/current, attitude (roll/pitch/yaw), GPS/position, and sensor health bits (baro, gyro, accel, mag, GPS, optical flow) from SYS_STATUS. Values may be undefined on a bench FC with no fix.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_prearm_status',
    description:
      'Current pre-arm check status: whether the vehicle would allow arming, and the list of outstanding pre-arm failure messages the firmware is reporting. Use this to explain why a vehicle will not arm.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_can_nodes',
    description:
      'DroneCAN peripherals discovered on the bus (GPS, compass, ESCs, power modules, etc.): node name, health, mode, and hardware/software versions. Empty when no CAN bus is active or no nodes are present.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_setup_status',
    description:
      'Guided-setup checklist state: each setup section (radio, sensors, outputs, failsafe, etc.) with its completion status and notes, plus the state of guided actions (calibrations, reboot). Use this to see what setup steps still need attention.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
]

/** Build a pure, read-only tool executor over an injected snapshot accessor. */
export function createToolExecutor(accessor: SnapshotAccessor): {
  definitions: ToolDefinition[]
  execute(name: string, args: Record<string, unknown>): ToolResult
} {
  function execute(name: string, args: Record<string, unknown>): ToolResult {
    const snapshot = accessor.getSnapshot()
    switch (name) {
      case 'get_vehicle_info': {
        const board = snapshot.hardware.board
        return {
          ok: true,
          data: {
            connection: snapshot.connection.kind,
            firmware: snapshot.vehicle?.firmware ?? 'Unknown',
            vehicle: snapshot.vehicle?.vehicle ?? 'Unknown',
            armed: snapshot.vehicle?.armed ?? false,
            flightMode: snapshot.vehicle?.flightMode,
            systemStatus: snapshot.vehicle?.systemStatus,
            firmwareVersion: board?.firmwareVersion,
            boardType: board?.boardType,
            parametersDownloaded: snapshot.parameterStats.downloaded,
            parameterSyncStatus: snapshot.parameterStats.status
          }
        }
      }
      case 'list_parameters': {
        const prefix = asString(args.prefix)?.toUpperCase()
        const offset = asPositiveInt(args.offset, 0, Number.MAX_SAFE_INTEGER)
        const limit = asPositiveInt(args.limit, DEFAULT_PARAM_PAGE, MAX_PARAM_PAGE) || DEFAULT_PARAM_PAGE
        const all = realParameters(snapshot)
          .filter((parameter) => (prefix ? parameter.id.toUpperCase().startsWith(prefix) : true))
          .sort((left, right) => left.id.localeCompare(right.id))
        const page = all.slice(offset, offset + limit)
        return {
          ok: true,
          data: {
            total: all.length,
            offset,
            returned: page.length,
            parameters: page.map(compactParam)
          }
        }
      }
      case 'get_parameter': {
        const id = asString(args.id)?.toUpperCase()
        if (!id) return { ok: false, error: 'Missing required "id".' }
        const match = realParameters(snapshot).find((parameter) => parameter.id.toUpperCase() === id)
        if (!match) return { ok: false, error: `No parameter "${id}" on this vehicle.` }
        return { ok: true, data: detailParam(match) }
      }
      case 'get_parameters': {
        const rawIds = args.ids
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
          return { ok: false, error: 'Missing required non-empty "ids" array.' }
        }
        const ids = rawIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        if (ids.length === 0) return { ok: false, error: '"ids" must contain at least one non-empty string.' }
        const requested = ids.slice(0, MAX_BATCH_PARAMETERS).map((id) => id.toUpperCase())
        const byId = new Map(realParameters(snapshot).map((parameter) => [parameter.id.toUpperCase(), parameter]))
        const found: Record<string, unknown>[] = []
        const notFound: string[] = []
        for (const id of requested) {
          const match = byId.get(id)
          if (match) found.push(detailParam(match))
          else notFound.push(id)
        }
        return {
          ok: true,
          data: {
            parameters: found,
            notFound,
            truncated: ids.length > MAX_BATCH_PARAMETERS
          }
        }
      }
      case 'search_parameters': {
        const query = asString(args.query)?.toLowerCase()
        if (!query) return { ok: false, error: 'Missing required "query".' }
        const limit = asPositiveInt(args.limit, 25, MAX_PARAM_PAGE) || 25
        const terms = query.split(/\s+/).filter(Boolean)
        const scored = realParameters(snapshot)
          .map((parameter) => {
            const haystack = [
              parameter.id,
              parameter.definition?.label ?? '',
              parameter.definition?.description ?? ''
            ]
              .join(' ')
              .toLowerCase()
            const score = terms.reduce((sum, term) => (haystack.includes(term) ? sum + 1 : sum), 0)
            return { parameter, score }
          })
          .filter((entry) => entry.score === terms.length)
          .slice(0, limit)
        return {
          ok: true,
          data: {
            query,
            returned: scored.length,
            parameters: scored.map((entry) => ({
              id: entry.parameter.id,
              label: entry.parameter.definition?.label,
              value: entry.parameter.value
            }))
          }
        }
      }
      case 'get_telemetry': {
        const live = snapshot.liveVerification
        const sensor = (state: { present: boolean; healthy: boolean }): string =>
          state.healthy ? 'healthy' : state.present ? 'present-unhealthy' : 'absent'
        return {
          ok: true,
          data: {
            rc: {
              verified: live.rcInput.verified,
              channelCount: live.rcInput.channelCount,
              channels: live.rcInput.channels
            },
            battery: {
              voltageV: live.batteryTelemetry.voltageV,
              currentA: live.batteryTelemetry.currentA,
              remainingPercent: live.batteryTelemetry.remainingPercent
            },
            attitude: {
              rollDeg: live.attitudeTelemetry.rollDeg,
              pitchDeg: live.attitudeTelemetry.pitchDeg,
              yawDeg: live.attitudeTelemetry.yawDeg
            },
            position: {
              latitudeDeg: live.globalPosition.latitudeDeg,
              longitudeDeg: live.globalPosition.longitudeDeg,
              relativeAltitudeM: live.globalPosition.relativeAltitudeM
            },
            sensors: {
              baro: sensor(live.baroSensor),
              gyro: sensor(live.gyroSensor),
              accel: sensor(live.accelSensor),
              mag: sensor(live.magSensor),
              gps: sensor(live.gpsSensor),
              opticalFlow: live.opticalFlow.verified ? 'active' : 'idle'
            }
          }
        }
      }
      case 'get_prearm_status': {
        return {
          ok: true,
          data: {
            healthy: snapshot.preArmStatus.healthy,
            issues: snapshot.preArmStatus.issues.map((issue) => ({
              text: issue.text,
              severity: issue.severity
            }))
          }
        }
      }
      case 'get_can_nodes': {
        return {
          ok: true,
          data: {
            busStatus: snapshot.canBus.status,
            nodes: snapshot.canNodes.map((node) => ({
              componentId: node.componentId,
              name: node.name,
              health: node.health,
              mode: node.mode,
              uptimeSec: node.uptimeSec,
              swVersion: node.swVersion
            }))
          }
        }
      }
      case 'get_setup_status': {
        return {
          ok: true,
          data: {
            sections: snapshot.setupSections.map((section) => ({
              id: section.id,
              title: section.title,
              status: section.status,
              notes: section.notes
            })),
            guidedActions: Object.values(snapshot.guidedActions).map((action) => ({
              actionId: action.actionId,
              status: action.status,
              summary: action.summary
            }))
          }
        }
      }
      default:
        return { ok: false, error: `Unknown tool "${name}".` }
    }
  }

  return { definitions: AI_ASSISTANT_TOOLS, execute }
}
