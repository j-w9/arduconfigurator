import { describe, expect, it } from 'vitest'

import { buildVisibleAppViews, type VisibleAppViewsInputs } from './visible-app-views'
import type { AppViewDescriptor } from '../app-types'

function view(id: string, overrides: Partial<AppViewDescriptor> = {}): AppViewDescriptor {
  return {
    id: id as AppViewDescriptor['id'],
    label: id,
    description: `${id} description`,
    badge: '',
    tone: 'neutral',
    ...overrides
  }
}

function baseInputs(overrides: Partial<VisibleAppViewsInputs> = {}): VisibleAppViewsInputs {
  return {
    appViews: [view('setup'), view('modes'), view('parameters')],
    isExpertMode: true,
    canBusStatus: 'idle',
    canBusBus: 0,
    connectionKind: 'disconnected',
    ...overrides
  }
}

const ids = (views: AppViewDescriptor[]): string[] => views.map((v) => v.id)
const byId = (views: AppViewDescriptor[], id: string): AppViewDescriptor => {
  const found = views.find((v) => v.id === id)
  if (!found) {
    throw new Error(`missing view ${id}`)
  }
  return found
}

describe('buildVisibleAppViews', () => {
  it('appends the non-metadata descriptors (calibration, can, flash, files)', () => {
    const result = ids(buildVisibleAppViews(baseInputs()))
    for (const extra of ['calibration', 'can', 'flash', 'files']) {
      expect(result).toContain(extra)
    }
  })

  it('gates the RC Mixer view behind Expert mode', () => {
    expect(ids(buildVisibleAppViews(baseInputs({ isExpertMode: false })))).not.toContain('rc-mixer')
    expect(ids(buildVisibleAppViews(baseInputs({ isExpertMode: true })))).toContain('rc-mixer')
  })

  it('hides the expert-only Parameters view outside Expert mode and shows it inside', () => {
    expect(ids(buildVisibleAppViews(baseInputs({ isExpertMode: false })))).not.toContain('parameters')
    expect(ids(buildVisibleAppViews(baseInputs({ isExpertMode: true })))).toContain('parameters')
  })

  it('relabels the Setup tab as Status & Info', () => {
    const setup = byId(buildVisibleAppViews(baseInputs()), 'setup')
    expect(setup.label).toBe('Status & Info')
    expect(setup.description).toContain('Vehicle health')
  })

  it('sorts into the canonical tab order, unlisted ids last', () => {
    const result = ids(
      buildVisibleAppViews(baseInputs({ appViews: [view('modes'), view('setup'), view('mystery-view')] }))
    )
    // setup leads, calibration second, modes before the tools cluster, unknown id last.
    expect(result[0]).toBe('setup')
    expect(result[1]).toBe('calibration')
    expect(result.indexOf('modes')).toBeLessThan(result.indexOf('can'))
    expect(result[result.length - 1]).toBe('mystery-view')
  })

  it('derives the CAN badge and tone from the bus status', () => {
    const active = byId(buildVisibleAppViews(baseInputs({ canBusStatus: 'active', canBusBus: 1 })), 'can')
    expect(active.badge).toBe('CAN1 live')
    expect(active.tone).toBe('success')

    const error = byId(buildVisibleAppViews(baseInputs({ canBusStatus: 'error' })), 'can')
    expect(error.badge).toBe('error')
    expect(error.tone).toBe('danger')

    const idle = byId(buildVisibleAppViews(baseInputs({ canBusStatus: 'idle' })), 'can')
    expect(idle.badge).toBe('idle')
    expect(idle.tone).toBe('neutral')

    expect(byId(buildVisibleAppViews(baseInputs({ canBusStatus: 'requesting' })), 'can').badge).toBe('connecting')
  })

  it('reflects connection state in the Files and Calibration badges', () => {
    const connected = buildVisibleAppViews(baseInputs({ connectionKind: 'connected' }))
    expect(byId(connected, 'files').badge).toBe('live')
    expect(byId(connected, 'calibration').badge).toBe('ready')

    const disconnected = buildVisibleAppViews(baseInputs({ connectionKind: 'disconnected' }))
    expect(byId(disconnected, 'files').badge).toBe('idle')
    expect(byId(disconnected, 'calibration').badge).toBe('idle')
  })
})
