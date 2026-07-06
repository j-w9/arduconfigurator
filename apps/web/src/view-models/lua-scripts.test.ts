import { describe, expect, it } from 'vitest'

import {
  buildLuaScriptsViewModel,
  evaluateAppletSanity,
  evaluateScriptingCapability,
  LUA_APPLET_CATALOG,
  LUA_MIN_SAFE_HEAP_BYTES,
  LUA_RECOMMENDED_HEAP_BYTES,
  validateLuaUpload,
  type LuaAppletMeta
} from './lua-scripts'

const params = (entries: Record<string, number>) =>
  Object.entries(entries).map(([id, value]) => ({ id, value }))

describe('evaluateScriptingCapability', () => {
  it('reports unsupported when SCR_ENABLE is absent', () => {
    const result = evaluateScriptingCapability(params({ RCL_ENABLE: 1 }))
    expect(result.capability).toBe('unsupported')
    expect(result.scrEnablePresent).toBe(false)
  })

  it('reports disabled when SCR_ENABLE is present but 0', () => {
    const result = evaluateScriptingCapability(params({ SCR_ENABLE: 0 }))
    expect(result.capability).toBe('disabled')
    expect(result.scrEnableValue).toBe(0)
  })

  it('reports enabled when SCR_ENABLE is non-zero', () => {
    const result = evaluateScriptingCapability(params({ SCR_ENABLE: 1 }))
    expect(result.capability).toBe('enabled')
  })

  it('flags a low heap below the safe floor and recommends a bump', () => {
    const low = evaluateScriptingCapability(params({ SCR_ENABLE: 1, SCR_HEAP_SIZE: LUA_MIN_SAFE_HEAP_BYTES - 1 }))
    expect(low.heapLow).toBe(true)
    expect(low.recommendedHeapBytes).toBe(LUA_RECOMMENDED_HEAP_BYTES)

    const ok = evaluateScriptingCapability(params({ SCR_ENABLE: 1, SCR_HEAP_SIZE: LUA_RECOMMENDED_HEAP_BYTES }))
    expect(ok.heapLow).toBe(false)
  })

  it('does not flag heap as low when SCR_HEAP_SIZE is absent (unknown, not low)', () => {
    const result = evaluateScriptingCapability(params({ SCR_ENABLE: 1 }))
    expect(result.heapSizePresent).toBe(false)
    expect(result.heapLow).toBe(false)
  })
})

describe('LUA_APPLET_CATALOG provenance', () => {
  it('has a unique id + filename and GPL provenance on every entry', () => {
    const ids = new Set<string>()
    const files = new Set<string>()
    for (const applet of LUA_APPLET_CATALOG) {
      expect(ids.has(applet.id)).toBe(false)
      expect(files.has(applet.filename)).toBe(false)
      ids.add(applet.id)
      files.add(applet.filename)
      expect(applet.filename).toMatch(/\.lua$/)
      expect(applet.source).toContain('AP_Scripting/applets')
      expect(applet.license).toContain('GPL')
      expect(applet.summary.length).toBeGreaterThan(0)
      expect(applet.description.length).toBeGreaterThan(0)
    }
  })

  it('includes the newly-added common Copter applets', () => {
    const byId = new Map(LUA_APPLET_CATALOG.map((applet) => [applet.id, applet]))
    for (const id of ['deadreckon-home', 'terrain-brake', 'revert-param', 'motor-failure-test', 'advance-wp']) {
      expect(byId.has(id)).toBe(true)
    }
    // 7 original + 5 new.
    expect(LUA_APPLET_CATALOG).toHaveLength(12)
  })

  it('gates terrain-brake on the terrain database and motor-failure-test on the motor PWM range', () => {
    const terrain = LUA_APPLET_CATALOG.find((applet) => applet.id === 'terrain-brake') as LuaAppletMeta
    expect(evaluateAppletSanity(terrain, params({ TERRAIN_ENABLE: 0 })).hasWarnings).toBe(true)
    expect(evaluateAppletSanity(terrain, params({ TERRAIN_ENABLE: 1 })).hasWarnings).toBe(false)

    const motorTest = LUA_APPLET_CATALOG.find((applet) => applet.id === 'motor-failure-test') as LuaAppletMeta
    expect(evaluateAppletSanity(motorTest, params({})).hasWarnings).toBe(true)
    expect(evaluateAppletSanity(motorTest, params({ MOT_PWM_MIN: 1000 })).hasWarnings).toBe(false)
  })

  it('keeps revert-param and advance-wp warning-free (info-only prerequisites)', () => {
    for (const id of ['revert-param', 'advance-wp']) {
      const applet = LUA_APPLET_CATALOG.find((entry) => entry.id === id) as LuaAppletMeta
      expect(evaluateAppletSanity(applet, params({})).hasWarnings).toBe(false)
    }
  })
})

describe('evaluateAppletSanity', () => {
  const smartAudio = LUA_APPLET_CATALOG.find((applet) => applet.id === 'smartaudio') as LuaAppletMeta

  it('warns when the SmartAudio serial (protocol 28) prereq is missing', () => {
    const sanity = evaluateAppletSanity(smartAudio, params({ SERIAL1_PROTOCOL: 2 }))
    expect(sanity.hasWarnings).toBe(true)
    expect(sanity.unmet.some((u) => /Scripting/.test(u.label))).toBe(true)
  })

  it('clears the serial prereq when a port is set to Scripting (28)', () => {
    const sanity = evaluateAppletSanity(smartAudio, params({ SERIAL4_PROTOCOL: 28 }))
    expect(sanity.unmet.some((u) => /Scripting/.test(u.label))).toBe(false)
  })

  it('treats a non-zero param requirement correctly (winch needs WINCH_TYPE != 0)', () => {
    const winch = LUA_APPLET_CATALOG.find((applet) => applet.id === 'winch-control') as LuaAppletMeta
    expect(evaluateAppletSanity(winch, params({ WINCH_TYPE: 0 })).hasWarnings).toBe(true)
    expect(evaluateAppletSanity(winch, params({ WINCH_TYPE: 1 })).hasWarnings).toBe(false)
  })

  it('never surfaces info-only prerequisites as warnings', () => {
    const selector = LUA_APPLET_CATALOG.find((applet) => applet.id === 'script-controller') as LuaAppletMeta
    // All of Script_Controller's prereqs are info — never a warning.
    expect(evaluateAppletSanity(selector, params({})).unmet).toHaveLength(0)
  })
})

describe('buildLuaScriptsViewModel', () => {
  it('marks a card installed by matching the on-SD filename case-insensitively', () => {
    const vm = buildLuaScriptsViewModel({
      params: params({ SCR_ENABLE: 1 }),
      installedNames: ['smartaudio.lua', 'unrelated.lua']
    })
    expect(vm.capability.capability).toBe('enabled')
    expect(vm.cards).toHaveLength(LUA_APPLET_CATALOG.length)
    expect(vm.cards.find((card) => card.meta.id === 'smartaudio')?.installed).toBe(true)
    expect(vm.cards.find((card) => card.meta.id === 'leds-on-switch')?.installed).toBe(false)
  })
})

describe('validateLuaUpload', () => {
  it('rejects non-.lua, empty, and oversized files; accepts a small .lua', () => {
    expect(validateLuaUpload('foo.txt', 10)).toMatch(/\.lua/)
    expect(validateLuaUpload('foo.lua', 0)).toMatch(/empty/)
    expect(validateLuaUpload('foo.lua', 1024 * 1024)).toMatch(/larger/)
    expect(validateLuaUpload('MyScript.LUA', 200)).toBeNull()
  })
})
