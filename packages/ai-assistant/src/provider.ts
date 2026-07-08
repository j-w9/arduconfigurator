// Normalized chat-provider abstraction for the AI Assistant.
//
// Three real backends (Anthropic Messages, OpenAI Chat Completions, and a
// local Ollama server) plus a deterministic mock all implement one interface,
// so the app-side send loop is provider-agnostic: it feeds a conversation and
// the read-only tool schemas in, and consumes a single normalized event
// stream out. The MCP-style tool *shapes* (see ./tools) are provider-neutral;
// each adapter is the thin translation layer to that vendor's tool-calling
// wire format.
//
// This module is browser-first (adapters call `fetch` directly, BYOK) and has
// no React/runtime/transport dependencies — vehicle state reaches the tools
// through an injected accessor, never through this layer.

import type { ToolDefinition } from './tools.js'

/** Provider identifiers the app can configure. */
export type ChatProviderId = 'anthropic' | 'openai' | 'ollama' | 'mock'

/** One turn in the conversation, normalized across providers. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  /** Assistant/user free text. Empty string for a pure tool-call assistant turn. */
  content: string
  /**
   * Tool calls the assistant requested on this turn (role === 'assistant').
   * The app executes each and appends role === 'tool' messages carrying the
   * matching `toolCallId` + JSON result.
   */
  toolCalls?: ChatToolCall[]
  /** Set on role === 'tool' messages — the id of the call this result answers. */
  toolCallId?: string
}

export interface ChatToolCall {
  /** Provider-assigned id, echoed back on the tool-result message. */
  id: string
  name: string
  /** Parsed JSON arguments; `{}` when the tool takes none. */
  arguments: Record<string, unknown>
}

/**
 * Normalized streaming event. Adapters translate each vendor's SSE/NDJSON
 * frames into this small union so the send loop never sees wire specifics.
 */
export type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ChatToolCall }
  | { type: 'done'; stopReason: 'end' | 'tool-use' }
  | { type: 'error'; message: string }

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  /** Provider model id (e.g. 'claude-sonnet-5', 'gpt-4o', 'llama3.1'). */
  model: string
  signal?: AbortSignal
}

/** The one interface every backend implements. */
export interface ChatProvider {
  readonly id: ChatProviderId
  send(request: ChatRequest): AsyncIterable<ChatEvent>
}

/** Config the app persists (non-secret) + the in-memory key. */
export interface ProviderConnection {
  providerId: ChatProviderId
  model: string
  /** API key (cloud providers). Never persisted unless the user opts in. */
  apiKey?: string
  /** Endpoint override — required for Ollama, optional proxy for cloud. */
  baseUrl?: string
}

/** Thrown by adapters for a non-2xx or transport failure; carries a
 *  human-readable, provider-attributed message the UI surfaces verbatim. */
export class ChatProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: ChatProviderId,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ChatProviderError'
  }
}
