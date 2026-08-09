import { describe, expect, it } from 'vitest'

import { canZeroCurrentOffset } from './battery-zero-offset-guard'

describe('canZeroCurrentOffset', () => {
  it('allows the offset on USB power with no pack attached', () => {
    // The only condition under which the sample actually means "zero amps".
    expect(canZeroCurrentOffset({ voltageV: 0.02, currentA: 0.01, telemetryVerified: true })).toEqual({
      allowed: true
    })
  })

  it('refuses while a flight pack is connected', () => {
    // The bug this exists to prevent: zeroing against a live pack records the
    // aircraft's idle draw as zero, so every later reading is low by that much.
    const verdict = canZeroCurrentOffset({ voltageV: 16.8, currentA: 0.9, telemetryVerified: true })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toMatch(/flight pack appears to be connected/i)
    expect(verdict.allowed === false && verdict.reason).toMatch(/16\.8 V/)
  })

  it('refuses on a real current draw even when the sense voltage reads low', () => {
    // Sense lines are divided differently board to board, so current is an
    // independent reason to refuse rather than a redundant one.
    const verdict = canZeroCurrentOffset({ voltageV: 0.1, currentA: 1.4, telemetryVerified: true })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toMatch(/drawing current/i)
  })

  it('tolerates the small non-zero current a bare board reads on USB', () => {
    // Refusing on sensor noise would make the button permanently unusable on
    // exactly the setup it is meant for.
    expect(canZeroCurrentOffset({ voltageV: 0.05, currentA: 0.2, telemetryVerified: true }).allowed).toBe(true)
  })

  it('refuses when there is no live telemetry to zero against', () => {
    expect(canZeroCurrentOffset({ telemetryVerified: false }).allowed).toBe(false)
  })

  it('explains itself rather than just going grey', () => {
    // A disabled control with no reason is indistinguishable from a broken one.
    const verdict = canZeroCurrentOffset({ voltageV: 22.2, telemetryVerified: true })
    expect(verdict.allowed === false && verdict.reason.length).toBeGreaterThan(40)
    expect(verdict.allowed === false && verdict.reason).toMatch(/disconnect the pack/i)
  })
})
