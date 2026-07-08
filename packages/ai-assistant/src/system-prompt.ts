// System prompt + vehicle grounding summary for the AI Assistant.
//
// The grounding summary is a compact, plain-text snapshot of the connected
// vehicle injected into the system prompt each turn, so the model has the
// essential context (what's connected, is it armed, is it healthy, how many
// params) without spending a mandatory first tool call to discover it — the
// MCP "resource" idea, inlined. The model still drills into detail through the
// read-only tools.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/** Compact plain-text vehicle state for the system prompt. Pure; safe to call
 *  on a disconnected snapshot (returns a "not connected" line). */
export function buildVehicleGroundingSummary(snapshot: ConfiguratorSnapshot): string {
  if (snapshot.connection.kind !== 'connected') {
    return 'No flight controller is currently connected. Answer general ArduPilot questions, and tell the user to connect a vehicle before asking about live state.'
  }

  const vehicle = snapshot.vehicle
  const board = snapshot.hardware.board
  const prearm = snapshot.preArmStatus
  const lines: string[] = []

  lines.push(`Vehicle: ${vehicle?.vehicle ?? 'Unknown'} (${vehicle?.firmware ?? 'Unknown'} firmware${
    board?.firmwareVersion ? `, ${board.firmwareVersion}` : ''
  })`)
  lines.push(`State: ${vehicle?.armed ? 'ARMED' : 'disarmed'}, mode ${vehicle?.flightMode ?? 'unknown'}, system ${vehicle?.systemStatus ?? 'unknown'}`)
  lines.push(`Parameters: ${snapshot.parameterStats.downloaded} downloaded (sync ${snapshot.parameterStats.status})`)
  lines.push(
    prearm.healthy
      ? 'Pre-arm: passing.'
      : `Pre-arm: ${prearm.issues.length} outstanding issue(s). Use get_prearm_status for detail.`
  )
  if (snapshot.canNodes.length > 0) {
    lines.push(`DroneCAN: ${snapshot.canNodes.length} node(s) on the bus.`)
  }

  return lines.join('\n')
}

export interface SystemPromptInputs {
  /** Output of buildVehicleGroundingSummary for the current snapshot. */
  grounding: string
  /** When true, the propose_param_changes tool is available (still human-gated). */
  allowProposals?: boolean
}

/** Build the full system prompt. The access framing switches on whether the
 *  propose tool is offered — but a write is ALWAYS human-approved either way. */
export function buildSystemPrompt(inputs: SystemPromptInputs): string {
  const accessParagraph = inputs.allowProposals
    ? 'You can inspect parameters, telemetry, pre-arm status, DroneCAN nodes, and setup progress through the read tools. You can also PROPOSE parameter changes with the propose_param_changes tool — but proposing does NOT apply anything: it stages a diff the user must explicitly review and approve. You cannot apply changes yourself and must never claim to have changed a parameter. When you propose changes, use exact parameter ids and values within each parameter\'s valid range, give a short reason per change, and briefly tell the user to review and apply the proposal.'
    : 'You have READ-ONLY access this session. You can inspect parameters, telemetry, pre-arm status, DroneCAN nodes, and setup progress through the provided tools, but you CANNOT change any parameter or command the vehicle. When the user asks you to change something, explain exactly which parameters you would change and to what values — do not claim to have changed anything.'
  return [
    'You are the ArduConfigurator AI Assistant, an expert copilot for setting up and tuning ArduPilot vehicles (primarily ArduCopter FPV builds). You help the user understand the current state of their connected flight controller and reason about its configuration.',
    '',
    accessParagraph,
    '',
    'Ground rules:',
    '- Prefer calling a tool to reading a value you are unsure of. Never invent a parameter id or a current value — look it up.',
    '- ArduPilot parameter names are precise (e.g. ATC_RAT_PIT_P, INS_HNTCH_ENABLE). Use get_parameter or search_parameters to confirm exact ids and valid ranges before discussing them.',
    '- Treat a connected flight controller as attached to a real aircraft. Be conservative: flag anything that affects flight safety (failsafe, battery, arming, tuning limits) and never encourage bypassing a pre-arm check.',
    '- Be concise and specific. Cite the parameter ids and values you looked up.',
    '',
    'Current vehicle context:',
    inputs.grounding
  ].join('\n')
}
