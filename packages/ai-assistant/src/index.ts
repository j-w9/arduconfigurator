// @arduconfig/ai-assistant — provider-agnostic, UI-agnostic tool-calling layer
// for the AI Assistant tab. Exposes live vehicle state to a chat model through
// MCP-style read tools, plus a propose_param_changes tool whose changes the
// human reviews and approves. No autonomous writes — the propose tool only
// stages a proposal; a write happens solely on explicit human confirmation.

export * from './provider.js'
export * from './tools.js'
export * from './system-prompt.js'
export * from './storage.js'
export * from './create-provider.js'
export * from './list-models.js'
export { createAnthropicProvider } from './anthropic-provider.js'
export { createOpenAiProvider } from './openai-provider.js'
export { createOllamaProvider } from './ollama-provider.js'
export { createMockProvider } from './mock-provider.js'
