// Resolve a configured ProviderConnection into a concrete ChatProvider.

import type { ChatProvider, ProviderConnection } from './provider.js'
import { ChatProviderError } from './provider.js'
import { createAnthropicProvider } from './anthropic-provider.js'
import { createOpenAiProvider } from './openai-provider.js'
import { createOllamaProvider } from './ollama-provider.js'
import { createMockProvider } from './mock-provider.js'

export function createProvider(connection: ProviderConnection): ChatProvider {
  switch (connection.providerId) {
    case 'anthropic':
      if (!connection.apiKey) throw new ChatProviderError('An Anthropic API key is required.', 'anthropic')
      return createAnthropicProvider({ apiKey: connection.apiKey, baseUrl: connection.baseUrl })
    case 'openai':
      if (!connection.apiKey) throw new ChatProviderError('An OpenAI API key is required.', 'openai')
      return createOpenAiProvider({ apiKey: connection.apiKey, baseUrl: connection.baseUrl })
    case 'ollama':
      return createOllamaProvider({ baseUrl: connection.baseUrl })
    case 'mock':
      return createMockProvider()
    default:
      throw new ChatProviderError(`Unknown provider "${connection.providerId}".`, connection.providerId)
  }
}

/** Whether a connection has everything it needs to send (used to gate the UI). */
export function isConnectionReady(connection: ProviderConnection): boolean {
  if (!connection.model) return false
  switch (connection.providerId) {
    case 'anthropic':
    case 'openai':
      return Boolean(connection.apiKey)
    case 'ollama':
    case 'mock':
      return true
    default:
      return false
  }
}
