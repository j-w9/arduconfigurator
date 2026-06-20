import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildAppViews, type AppViewsInputs } from './app-views'

type ViewMeta = { id: string; label: string; description: string }

const NO_DRAFTS: ParameterDraftEntry[] = []
const draft = (id: string): ParameterDraftEntry => ({ id }) as unknown as ParameterDraftEntry

// A complete all-clean baseline; tests inject the appViews list to render and
// override only the counts/flags they exercise. The builder reads each object
// field shallowly, so minimal casts are enough.
function inputs(appViews: ViewMeta[], overrides: Partial<AppViewsInputs> = {}): AppViewsInputs {
  return {
    completedSetupSectionCount: 0,
    configInvalidDrafts: NO_DRAFTS,
    configSections: [],
    configStagedDrafts: NO_DRAFTS,
    configuredOutputs: [] as unknown as AppViewsInputs['configuredOutputs'],
    guidedSetupComplete: false,
    isCopterVehicle: true,
    isPlaneVehicle: false,
    isRoverVehicle: false,
    isSubVehicle: false,
    metadataCatalog: { appViews } as unknown as AppViewsInputs['metadataCatalog'],
    osdInvalidDrafts: NO_DRAFTS,
    osdLinkPorts: [] as unknown as AppViewsInputs['osdLinkPorts'],
    osdStagedDrafts: NO_DRAFTS,
    outputMapping: { motorOutputs: [], configuredAuxOutputs: [] } as unknown as AppViewsInputs['outputMapping'],
    planeTuningControlCount: 0,
    planeTuningInvalidDrafts: NO_DRAFTS,
    planeTuningStagedDrafts: NO_DRAFTS,
    portsAdditionalInvalidDrafts: NO_DRAFTS,
    portsAdditionalStagedDrafts: NO_DRAFTS,
    portsInvalidDrafts: NO_DRAFTS,
    portsStagedDrafts: NO_DRAFTS,
    powerAdditionalInvalidDrafts: NO_DRAFTS,
    powerAdditionalStagedDrafts: NO_DRAFTS,
    powerInvalidDrafts: NO_DRAFTS,
    powerStagedDrafts: NO_DRAFTS,
    presetDefinitions: [] as unknown as AppViewsInputs['presetDefinitions'],
    receiverAdditionalInvalidDrafts: NO_DRAFTS,
    receiverAdditionalStagedDrafts: NO_DRAFTS,
    receiverInvalidDrafts: NO_DRAFTS,
    receiverStagedDrafts: NO_DRAFTS,
    roverTuningControlCount: 0,
    roverTuningInvalidDrafts: NO_DRAFTS,
    roverTuningStagedDrafts: NO_DRAFTS,
    savedSnapshots: [],
    selectedPresetApplicability: { status: 'ready' } as unknown as AppViewsInputs['selectedPresetApplicability'],
    selectedPresetChangedEntries: NO_DRAFTS,
    selectedPresetInvalidEntries: NO_DRAFTS,
    selectedSnapshotChangedEntries: NO_DRAFTS,
    selectedSnapshotInvalidEntries: NO_DRAFTS,
    serialPortViewModels: [] as unknown as AppViewsInputs['serialPortViewModels'],
    setupFlowSections: [],
    snapshot: {
      parameters: [],
      liveVerification: { rcInput: { verified: false }, batteryTelemetry: { verified: false } },
      preArmStatus: { healthy: true, issues: [] }
    } as unknown as AppViewsInputs['snapshot'],
    stagedParameterDrafts: NO_DRAFTS,
    subTuningControlCount: 0,
    subTuningInvalidDrafts: NO_DRAFTS,
    subTuningStagedDrafts: NO_DRAFTS,
    totalOutputInvalidDrafts: 0,
    totalOutputStagedDrafts: 0,
    tuningInvalidDrafts: NO_DRAFTS,
    tuningParameters: [],
    tuningStagedDrafts: NO_DRAFTS,
    vtxInvalidDrafts: NO_DRAFTS,
    vtxLinkPorts: [] as unknown as AppViewsInputs['vtxLinkPorts'],
    vtxStagedDrafts: NO_DRAFTS,
    ...overrides
  }
}

const view = (id: string): ViewMeta => ({ id, label: id, description: `${id} desc` })
const only = (id: string, overrides: Partial<AppViewsInputs> = {}) => buildAppViews(inputs([view(id)], overrides))[0]

describe('buildAppViews', () => {
  it('maps one descriptor per catalog view, preserving id/label/description', () => {
    const cards = buildAppViews(inputs([view('setup'), view('parameters')]))
    expect(cards.map((card) => card.id)).toEqual(['setup', 'parameters'])
    expect(cards[0]).toMatchObject({ label: 'setup', description: 'setup desc' })
  })

  it('setup: badge is completed/total and tone tracks guidedSetupComplete', () => {
    expect(only('setup', { completedSetupSectionCount: 2, setupFlowSections: [{}, {}, {}] as unknown as AppViewsInputs['setupFlowSections'] })).toMatchObject({
      badge: '2/3',
      tone: 'warning'
    })
    expect(only('setup', { guidedSetupComplete: true }).tone).toBe('success')
  })

  it('receiver: invalid > staged > live > pending', () => {
    expect(only('receiver')).toMatchObject({ badge: 'pending', tone: 'warning' })
    const live = only('receiver', {
      snapshot: {
        parameters: [],
        liveVerification: { rcInput: { verified: true }, batteryTelemetry: { verified: false } },
        preArmStatus: { healthy: true, issues: [] }
      } as unknown as AppViewsInputs['snapshot']
    })
    expect(live).toMatchObject({ badge: 'live', tone: 'success' })
    expect(only('receiver', { receiverStagedDrafts: [draft('RC1_MIN')] })).toMatchObject({ badge: '1 staged', tone: 'warning' })
    expect(only('receiver', { receiverInvalidDrafts: [draft('RC1_MIN'), draft('RC1_MAX')] })).toMatchObject({ badge: '2 invalid', tone: 'danger' })
  })

  it('servos: aux-output count drives the badge and the warn-when-empty tone', () => {
    expect(only('servos')).toMatchObject({ badge: '0 aux', tone: 'warning' })
    expect(
      only('servos', { outputMapping: { motorOutputs: [], configuredAuxOutputs: [{}, {}] } as unknown as AppViewsInputs['outputMapping'] })
    ).toMatchObject({ badge: '2 aux', tone: 'neutral' })
  })

  it('parameters: staged count else total parameter count', () => {
    expect(
      only('parameters', { snapshot: { parameters: [{}, {}, {}], liveVerification: { rcInput: { verified: false }, batteryTelemetry: { verified: false } }, preArmStatus: { healthy: true, issues: [] } } as unknown as AppViewsInputs['snapshot'] })
    ).toMatchObject({ badge: '3', tone: 'neutral' })
    expect(only('parameters', { stagedParameterDrafts: [draft('A'), draft('B')] })).toMatchObject({ badge: '2 staged', tone: 'warning' })
  })

  it('snapshots: diff count else saved count', () => {
    expect(only('snapshots', { savedSnapshots: [{}, {}] as unknown as AppViewsInputs['savedSnapshots'] })).toMatchObject({ badge: '2 saved', tone: 'neutral' })
    expect(only('snapshots', { selectedSnapshotChangedEntries: [draft('A')] })).toMatchObject({ badge: '1 diff', tone: 'warning' })
    expect(only('snapshots', { selectedSnapshotInvalidEntries: [draft('A')], selectedSnapshotChangedEntries: [draft('A')] }).tone).toBe('danger')
  })

  it('an unknown view id falls back to an empty badge / neutral tone', () => {
    expect(only('totally-unknown-view')).toMatchObject({ badge: '', tone: 'neutral' })
  })
})
