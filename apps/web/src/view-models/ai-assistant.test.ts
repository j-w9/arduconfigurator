import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@arduconfig/ai-assistant'
import {
  buildTranscript,
  defaultModelFor,
  providerMetadata,
  resolveComposerState,
  PROVIDER_METADATA
} from './ai-assistant'

describe('provider metadata', () => {
  it('exposes the three user-facing providers and no mock', () => {
    const ids = PROVIDER_METADATA.map((entry) => entry.id)
    expect(ids).toEqual(['anthropic', 'openai', 'ollama'])
    expect(ids).not.toContain('mock')
  })

  it('marks cloud providers as needing a key and ollama as not', () => {
    expect(providerMetadata('anthropic')?.needsApiKey).toBe(true)
    expect(providerMetadata('openai')?.needsApiKey).toBe(true)
    expect(providerMetadata('ollama')?.needsApiKey).toBe(false)
  })

  it('provides a default model per provider', () => {
    expect(defaultModelFor('anthropic')).toBe('claude-sonnet-5')
    expect(defaultModelFor('ollama')).toBe('llama3.1')
  })
})

describe('resolveComposerState', () => {
  it('blocks when config is not ready', () => {
    const state = resolveComposerState({ connected: true, configReady: false, streaming: false, draftIsEmpty: false })
    expect(state.canSend).toBe(false)
    expect(state.hint).toMatch(/Settings/)
  })

  it('blocks while streaming', () => {
    const state = resolveComposerState({ connected: true, configReady: true, streaming: true, draftIsEmpty: false })
    expect(state.canSend).toBe(false)
  })

  it('allows sending offline but hints to connect', () => {
    const state = resolveComposerState({ connected: false, configReady: true, streaming: false, draftIsEmpty: false })
    expect(state.canSend).toBe(true)
    expect(state.hint).toMatch(/connect a vehicle/i)
  })

  it('is ready with no hint when connected and configured', () => {
    const state = resolveComposerState({ connected: true, configReady: true, streaming: false, draftIsEmpty: false })
    expect(state).toEqual({ canSend: true, hint: '' })
  })

  it('cannot send an empty draft', () => {
    const state = resolveComposerState({ connected: true, configReady: true, streaming: false, draftIsEmpty: true })
    expect(state.canSend).toBe(false)
  })
})

describe('buildTranscript', () => {
  it('folds tool results into their assistant turn and marks calls done', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What am I connected to?' },
      { role: 'assistant', content: 'Let me check.', toolCalls: [{ id: 'c1', name: 'get_vehicle_info', arguments: {} }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1' },
      { role: 'assistant', content: 'You are on an ArduCopter.' }
    ]
    const turns = buildTranscript(messages)
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(turns[1].toolCalls).toEqual([{ id: 'c1', name: 'get_vehicle_info', done: true }])
    expect(turns[2].text).toMatch(/ArduCopter/)
  })

  it('marks an unresolved tool call as not done', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'pending', name: 'get_telemetry', arguments: {} }] }
    ]
    const turns = buildTranscript(messages)
    expect(turns[1].toolCalls[0].done).toBe(false)
  })
})
