import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveDraftValuesFromParameterPreset,
  evaluateParameterPresetApplicability
} from '../packages/ardupilot-core/dist/index.js'
import {
  arducopterMetadata,
  arduplaneMetadata,
  arduroverMetadata,
  ardusubMetadata,
  normalizeFirmwareMetadata
} from '../packages/param-metadata/dist/index.js'

const metadataCatalog = normalizeFirmwareMetadata(arducopterMetadata)

test('metadata catalog exposes grouped presets and a dedicated presets view', () => {
  assert.ok(metadataCatalog.appViews.some((view) => view.id === 'presets'))
  assert.equal(metadataCatalog.presetGroups.length, 3)
  assert.ok(metadataCatalog.presets.length >= 6)
  assert.ok(metadataCatalog.presetsByGroup['starter-config'].length >= 4)
  assert.ok(metadataCatalog.presetsByGroup['flight-feel'].length >= 3)
  assert.ok(metadataCatalog.presetsByGroup['acro-rates'].length >= 3)
})

test('every vehicle bundle ships a frame-selection starter-config preset group', () => {
  const bundles = {
    ArduCopter: arducopterMetadata,
    ArduPlane: arduplaneMetadata,
    ArduRover: arduroverMetadata,
    ArduSub: ardusubMetadata
  }
  for (const [vehicle, bundle] of Object.entries(bundles)) {
    const catalog = normalizeFirmwareMetadata(bundle)
    const starters = catalog.presetsByGroup['starter-config'] ?? []
    assert.ok(starters.length >= 2, `${vehicle} should expose starter-config presets`)
    // The starter group sorts first (order 0) so it heads the Presets tab.
    assert.equal(catalog.presetGroups[0]?.id, 'starter-config', `${vehicle} starter group should sort first`)
    // Starter presets set a frame parameter and carry no frame-class gate.
    for (const preset of starters) {
      assert.ok(preset.values.length >= 1, `${vehicle} ${preset.id} should set at least one frame param`)
      assert.equal(preset.compatibility, undefined, `${vehicle} ${preset.id} must not gate on frame class`)
    }
  }
})

test('preset diffing stages only the changed values', () => {
  const preset = metadataCatalog.presets.find((candidate) => candidate.id === 'flight-feel-balanced')
  assert.ok(preset)

  const snapshot = createSnapshot({
    FRAME_CLASS: 1,
    ATC_INPUT_TC: 0.22,
    ANGLE_MAX: 3500,
    PILOT_Y_RATE: 200,
    PILOT_Y_EXPO: 0.12
  })

  const diff = deriveDraftValuesFromParameterPreset(snapshot.parameters, preset)
  assert.equal(diff.changedCount, 2)
  assert.equal(diff.unchangedCount, 2)
  assert.deepEqual(diff.draftValues, {
    ANGLE_MAX: '4200',
    PILOT_Y_EXPO: '0.1'
  })
})

test('preset applicability blocks unsupported frame classes and allows compatible multirotors', () => {
  const preset = metadataCatalog.presets.find((candidate) => candidate.id === 'acro-rates-balanced')
  assert.ok(preset)

  const supportedSnapshot = createSnapshot({
    FRAME_CLASS: 1,
    ACRO_RP_RATE: 220,
    ACRO_Y_RATE: 180,
    ACRO_RP_EXPO: 0.18,
    ACRO_Y_EXPO: 0.14
  })
  const blockedSnapshot = createSnapshot({
    FRAME_CLASS: 6,
    ACRO_RP_RATE: 220,
    ACRO_Y_RATE: 180,
    ACRO_RP_EXPO: 0.18,
    ACRO_Y_EXPO: 0.14
  })

  assert.equal(evaluateParameterPresetApplicability(supportedSnapshot, preset).status, 'ready')

  const blocked = evaluateParameterPresetApplicability(blockedSnapshot, preset)
  assert.equal(blocked.status, 'blocked')
  assert.match(blocked.reasons[0], /FRAME_CLASS 6/)
})

function createSnapshot(parameterValues) {
  return {
    connection: { kind: 'connected' },
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      armed: false,
      flightMode: 'Stabilize'
    },
    parameterStats: {
      downloaded: Object.keys(parameterValues).length,
      total: Object.keys(parameterValues).length,
      duplicateFrames: 0,
      status: 'complete',
      progress: 1
    },
    parameters: Object.entries(parameterValues).map(([id, value], index, entries) => ({
      id,
      value,
      index,
      count: entries.length,
      definition: arducopterMetadata.parameters[id]
    })),
    setupSections: [],
    guidedActions: {
      'request-parameters': {
        actionId: 'request-parameters',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'calibrate-accelerometer': {
        actionId: 'calibrate-accelerometer',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'calibrate-compass': {
        actionId: 'calibrate-compass',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'reboot-autopilot': {
        actionId: 'reboot-autopilot',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      }
    },
    motorTest: {
      status: 'idle',
      summary: '',
      instructions: []
    },
    liveVerification: {
      satisfiedSignals: [],
      rcInput: {
        verified: false,
        channelCount: 0,
        channels: []
      },
      batteryTelemetry: {
        verified: false
      },
      attitudeTelemetry: {
        verified: false
      }
    },
    preArmStatus: {
      healthy: true,
      issues: []
    },
    statusTexts: []
  }
}
