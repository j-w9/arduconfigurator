import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createToolExecutor,
  AI_ASSISTANT_TOOLS,
  buildVehicleGroundingSummary,
  buildSystemPrompt,
  createProvider,
  isConnectionReady,
  loadProviderConfig,
  saveProviderConfig,
  loadPersistedApiKey,
  persistApiKey,
  clearPersistedApiKey,
  toolsFor,
  parseProposedChanges,
  PROPOSE_PARAM_CHANGES_TOOL,
  MAX_PROPOSED_CHANGES
} from '../packages/ai-assistant/dist/index.js'

// A minimal ConfiguratorSnapshot with just the fields the read-only tools read.
function makeSnapshot(overrides = {}) {
  return {
    connection: { kind: 'connected' },
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      armed: false,
      flightMode: 'STABILIZE',
      systemStatus: 'standby'
    },
    hardware: { board: { firmwareVersion: '4.5.7 (official)', boardType: 9 }, uartsFile: {} },
    parameterStats: { downloaded: 3, total: 3, duplicateFrames: 0, status: 'complete', progress: 1 },
    parameters: [
      { id: 'ATC_RAT_PIT_P', value: 0.135, index: 0, count: 3, definition: { id: 'ATC_RAT_PIT_P', label: 'Pitch axis rate controller P gain', description: 'Pitch P', category: 'tuning', minimum: 0, maximum: 0.6 } },
      { id: 'BATT_LOW_VOLT', value: 14.0, index: 1, count: 3, definition: { id: 'BATT_LOW_VOLT', label: 'Low battery voltage', description: 'Failsafe low voltage', category: 'power', unit: 'V' } },
      { id: 'ATC_MIR', value: 5, index: 2, count: 3, aliasedFrom: 'ATC_RAT_PIT_P' }
    ],
    setupSections: [
      { id: 'radio', title: 'Radio', description: '', status: 'complete', notes: [], actions: [], parameters: [] }
    ],
    guidedActions: {
      'calibrate-compass': { actionId: 'calibrate-compass', status: 'idle', summary: 'Compass', instructions: [], statusTexts: [] }
    },
    motorTest: {},
    liveVerification: {
      satisfiedSignals: [],
      rcInput: { verified: true, channelCount: 8, channels: [1500, 1500, 1000, 1500, 1000, 1000, 1000, 1000] },
      batteryTelemetry: { verified: true, voltageV: 16.4, currentA: 2.1, remainingPercent: 88 },
      attitudeTelemetry: { verified: true, rollDeg: 0.2, pitchDeg: -0.1, yawDeg: 90 },
      globalPosition: { verified: false },
      baroSensor: { verified: true, present: true, healthy: true },
      gyroSensor: { verified: true, present: true, healthy: true },
      accelSensor: { verified: true, present: true, healthy: true },
      magSensor: { verified: false, present: true, healthy: false },
      gpsSensor: { verified: false, present: false, healthy: false },
      opticalFlow: { verified: false }
    },
    preArmStatus: { healthy: false, issues: [{ text: 'Compass not calibrated', severity: 'error', firstSeenAtMs: 0, lastSeenAtMs: 0 }] },
    statusTexts: [],
    canNodes: [
      { componentId: 125, name: 'org.ardupilot.gps', health: 'ok', mode: 'operational', uptimeSec: 42, firstSeenAtMs: 0, lastSeenAtMs: 0, lastSeenSource: 'uavcan-node-status' }
    ],
    canBus: { status: 'active', bus: 1, framesReceived: 10, nodes: [], escTelemetry: [] },
    ...overrides
  }
}

const accessorFor = (snapshot) => ({ getSnapshot: () => snapshot })

test('tool definitions expose only read-only tools', () => {
  const names = AI_ASSISTANT_TOOLS.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'get_can_nodes',
    'get_parameter',
    'get_prearm_status',
    'get_setup_status',
    'get_telemetry',
    'get_vehicle_info',
    'list_parameters',
    'search_parameters'
  ])
  // Every tool name starts with a read verb — none implies a mutation.
  for (const name of names) {
    assert.ok(/^(get|list|search)_/.test(name), `${name} must be a read-only accessor`)
  }
})

test('get_vehicle_info returns identity and status', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const result = execute('get_vehicle_info', {})
  assert.equal(result.ok, true)
  assert.equal(result.data.vehicle, 'ArduCopter')
  assert.equal(result.data.armed, false)
  assert.equal(result.data.firmwareVersion, '4.5.7 (official)')
})

test('list_parameters is compact, prefix-filtered, and excludes alias mirrors', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const all = execute('list_parameters', {})
  // ATC_MIR is an alias mirror -> excluded; 2 real params remain.
  assert.equal(all.data.total, 2)
  assert.deepEqual(all.data.parameters, [
    { id: 'ATC_RAT_PIT_P', value: 0.135 },
    { id: 'BATT_LOW_VOLT', value: 14 }
  ])
  const scoped = execute('list_parameters', { prefix: 'batt' })
  assert.equal(scoped.data.total, 1)
  assert.equal(scoped.data.parameters[0].id, 'BATT_LOW_VOLT')
})

test('list_parameters caps limit and honors offset', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const page = execute('list_parameters', { limit: 1, offset: 1 })
  assert.equal(page.data.returned, 1)
  assert.equal(page.data.offset, 1)
  assert.equal(page.data.parameters[0].id, 'BATT_LOW_VOLT')
})

test('get_parameter returns full metadata and errors on unknown id', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const ok = execute('get_parameter', { id: 'atc_rat_pit_p' })
  assert.equal(ok.ok, true)
  assert.equal(ok.data.label, 'Pitch axis rate controller P gain')
  assert.equal(ok.data.maximum, 0.6)
  const missing = execute('get_parameter', { id: 'NOPE' })
  assert.equal(missing.ok, false)
})

test('search_parameters matches across id/label/description', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const hits = execute('search_parameters', { query: 'battery voltage' })
  assert.equal(hits.ok, true)
  assert.equal(hits.data.parameters[0].id, 'BATT_LOW_VOLT')
})

test('get_telemetry summarizes sensor health bits', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const t = execute('get_telemetry', {})
  assert.equal(t.data.sensors.baro, 'healthy')
  assert.equal(t.data.sensors.mag, 'present-unhealthy')
  assert.equal(t.data.sensors.gps, 'absent')
  assert.equal(t.data.battery.voltageV, 16.4)
})

test('get_prearm_status surfaces outstanding issues', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const p = execute('get_prearm_status', {})
  assert.equal(p.data.healthy, false)
  assert.equal(p.data.issues[0].text, 'Compass not calibrated')
})

test('unknown tool returns an error result, never throws', () => {
  const { execute } = createToolExecutor(accessorFor(makeSnapshot()))
  const r = execute('do_something_dangerous', {})
  assert.equal(r.ok, false)
})

test('grounding summary reflects connected vs disconnected', () => {
  assert.match(buildVehicleGroundingSummary(makeSnapshot()), /ArduCopter/)
  assert.match(buildVehicleGroundingSummary(makeSnapshot()), /1 outstanding issue/)
  const offline = buildVehicleGroundingSummary(makeSnapshot({ connection: { kind: 'disconnected' } }))
  assert.match(offline, /No flight controller/)
})

test('system prompt states the read-only constraint and embeds grounding', () => {
  const prompt = buildSystemPrompt({ grounding: 'GROUNDING-MARKER' })
  assert.match(prompt, /READ-ONLY/)
  assert.match(prompt, /cannot/i)
  assert.match(prompt, /GROUNDING-MARKER/)
})

test('isConnectionReady gates on key for cloud, not for ollama/mock', () => {
  assert.equal(isConnectionReady({ providerId: 'anthropic', model: 'claude-sonnet-5' }), false)
  assert.equal(isConnectionReady({ providerId: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk' }), true)
  assert.equal(isConnectionReady({ providerId: 'ollama', model: 'llama3.1' }), true)
  assert.equal(isConnectionReady({ providerId: 'mock', model: 'mock' }), true)
  assert.equal(isConnectionReady({ providerId: 'anthropic', model: '' }), false)
})

test('mock provider drives the full tool loop against the executor', async () => {
  const snapshot = makeSnapshot()
  const { execute } = createToolExecutor(accessorFor(snapshot))
  const provider = createProvider({ providerId: 'mock', model: 'mock' })

  const messages = [{ role: 'user', content: 'What am I connected to?' }]
  const request = { system: 'sys', messages, tools: AI_ASSISTANT_TOOLS, model: 'mock' }

  // First pass: expect a tool call.
  let toolCall
  let firstText = ''
  for await (const event of provider.send(request)) {
    if (event.type === 'text-delta') firstText += event.text
    if (event.type === 'tool-call') toolCall = event.call
  }
  assert.ok(firstText.length > 0)
  assert.ok(toolCall)
  assert.equal(toolCall.name, 'get_vehicle_info')

  // Execute the tool and feed the result back.
  const toolResult = execute(toolCall.name, toolCall.arguments)
  messages.push({ role: 'assistant', content: firstText, toolCalls: [toolCall] })
  messages.push({ role: 'tool', content: JSON.stringify(toolResult), toolCallId: toolCall.id })

  // Second pass: expect a final text answer referencing the vehicle.
  let finalText = ''
  for await (const event of provider.send({ ...request, messages })) {
    if (event.type === 'text-delta') finalText += event.text
  }
  assert.match(finalText, /ArduCopter/)
})

test('toolsFor gates the propose tool behind allowProposals', () => {
  const readOnly = toolsFor({ allowProposals: false }).map((t) => t.name)
  assert.ok(!readOnly.includes('propose_param_changes'))
  assert.equal(readOnly.length, AI_ASSISTANT_TOOLS.length)
  const withWrite = toolsFor({ allowProposals: true }).map((t) => t.name)
  assert.ok(withWrite.includes('propose_param_changes'))
})

test('propose tool schema requires changes', () => {
  assert.equal(PROPOSE_PARAM_CHANGES_TOOL.name, 'propose_param_changes')
  assert.deepEqual(PROPOSE_PARAM_CHANGES_TOOL.parameters.required, ['changes'])
})

test('parseProposedChanges normalizes a valid proposal', () => {
  const parsed = parseProposedChanges({
    summary: 'tune pitch',
    changes: [{ paramId: 'ATC_RAT_PIT_P', value: 0.145, reason: 'crisper' }]
  })
  assert.ok('proposal' in parsed)
  assert.equal(parsed.proposal.summary, 'tune pitch')
  assert.deepEqual(parsed.proposal.changes[0], { paramId: 'ATC_RAT_PIT_P', value: 0.145, reason: 'crisper' })
})

test('parseProposedChanges rejects malformed input and enforces the cap', () => {
  assert.ok('error' in parseProposedChanges({ changes: [] }))
  assert.ok('error' in parseProposedChanges({ changes: 'nope' }))
  assert.ok('error' in parseProposedChanges({ changes: [{ paramId: '', value: 1 }] }))
  assert.ok('error' in parseProposedChanges({ changes: [{ paramId: 'X', value: 'high' }] }))
  assert.ok('error' in parseProposedChanges({ changes: [{ paramId: 'X', value: NaN }] }))
  const tooMany = { changes: Array.from({ length: MAX_PROPOSED_CHANGES + 1 }, (_, i) => ({ paramId: `P${i}`, value: i })) }
  assert.ok('error' in parseProposedChanges(tooMany))
})

test('mock provider stages a proposal on a write-intent prompt when the tool is offered', async () => {
  const provider = createProvider({ providerId: 'mock', model: 'mock' })
  const request = {
    system: 'sys',
    messages: [{ role: 'user', content: 'please raise my pitch P a little' }],
    tools: toolsFor({ allowProposals: true }),
    model: 'mock'
  }
  let proposeCall
  for await (const event of provider.send(request)) {
    if (event.type === 'tool-call') proposeCall = event.call
  }
  assert.ok(proposeCall)
  assert.equal(proposeCall.name, 'propose_param_changes')
  assert.equal(proposeCall.arguments.changes[0].paramId, 'ATC_RAT_PIT_P')
})

test('mock provider does NOT propose when the propose tool is not offered', async () => {
  const provider = createProvider({ providerId: 'mock', model: 'mock' })
  const request = {
    system: 'sys',
    messages: [{ role: 'user', content: 'please raise my pitch P a little' }],
    tools: toolsFor({ allowProposals: false }),
    model: 'mock'
  }
  const names = []
  for await (const event of provider.send(request)) {
    if (event.type === 'tool-call') names.push(event.call.name)
  }
  assert.ok(!names.includes('propose_param_changes'))
})

test('system prompt switches framing when proposals are allowed', () => {
  const readOnly = buildSystemPrompt({ grounding: 'g' })
  assert.match(readOnly, /READ-ONLY/)
  const propose = buildSystemPrompt({ grounding: 'g', allowProposals: true })
  assert.match(propose, /propose_param_changes/)
  assert.match(propose, /human|user must|review and approve|review and apply/i)
})

// In-memory Storage double for the persistence tests.
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  }
}

test('provider config round-trips and rejects corrupt data', () => {
  const storage = memoryStorage()
  assert.equal(loadProviderConfig(storage), undefined)
  saveProviderConfig(storage, { providerId: 'openai', model: 'gpt-4o', rememberKey: false })
  const loaded = loadProviderConfig(storage)
  assert.equal(loaded.providerId, 'openai')
  assert.equal(loaded.model, 'gpt-4o')
  assert.equal(loaded.rememberKey, false)
  storage.setItem('arduconfig:ai-assistant:config', '{not json')
  assert.equal(loadProviderConfig(storage), undefined)
})

test('config persistence never writes the api key', () => {
  const storage = memoryStorage()
  saveProviderConfig(storage, { providerId: 'anthropic', model: 'claude-sonnet-5', rememberKey: true })
  const serialized = JSON.stringify([...storage._map.entries()])
  assert.ok(!serialized.includes('sk-'), 'saveProviderConfig must not persist a key')
  // Only the explicit key API writes it.
  assert.equal(loadPersistedApiKey(storage), undefined)
  persistApiKey(storage, 'sk-secret')
  assert.equal(loadPersistedApiKey(storage), 'sk-secret')
  clearPersistedApiKey(storage)
  assert.equal(loadPersistedApiKey(storage), undefined)
})
