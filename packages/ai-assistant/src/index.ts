// @arduconfig/ai-assistant — provider-agnostic, UI-agnostic tool-calling layer
// for the AI Assistant tab. Read-only (slice 1): exposes the live vehicle state
// to a chat model through MCP-style tools; the model cannot change anything.

export * from './provider.js'
export * from './tools.js'
export * from './system-prompt.js'
export * from './storage.js'
export * from './create-provider.js'
export { createAnthropicProvider } from './anthropic-provider.js'
export { createOpenAiProvider } from './openai-provider.js'
export { createOllamaProvider } from './ollama-provider.js'
export { createMockProvider } from './mock-provider.js'
