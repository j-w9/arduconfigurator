// Thin browser binding over @arduconfig/ai-assistant's pure storage module.
//
// Splits persistence by sensitivity (the FirmwareFlasher precedent): the
// non-secret provider config always persists; the API key is written only when
// the user opts into "remember on this device". Everything is guarded so a
// storage-less / private-mode context degrades to in-memory-only, never a crash.

import {
  loadProviderConfig,
  saveProviderConfig,
  loadPersistedApiKey,
  persistApiKey,
  clearPersistedApiKey,
  type PersistedProviderConfig
} from '@arduconfig/ai-assistant'

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function loadAiAssistantConfig(): PersistedProviderConfig | undefined {
  const store = storage()
  return store ? loadProviderConfig(store) : undefined
}

export function saveAiAssistantConfig(config: PersistedProviderConfig): void {
  const store = storage()
  if (store) saveProviderConfig(store, config)
}

export function loadAiAssistantKey(): string | undefined {
  const store = storage()
  return store ? loadPersistedApiKey(store) : undefined
}

export function persistAiAssistantKey(apiKey: string): void {
  const store = storage()
  if (store) persistApiKey(store, apiKey)
}

export function clearAiAssistantKey(): void {
  const store = storage()
  if (store) clearPersistedApiKey(store)
}
