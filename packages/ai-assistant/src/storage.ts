// Persistence for the AI Assistant provider config.
//
// Split by sensitivity, mirroring the FirmwareFlasher precedent (persist the
// non-secret connection config; keep the secret in memory unless the user
// explicitly opts in):
//   - Non-secret config (provider, model, base URL, rememberKey flag) is always
//     persisted so the tab reopens preconfigured.
//   - The API key is written ONLY when rememberKey is true, under its own key,
//     with a visible XSS-risk warning in the UI. By default it stays in memory
//     and is gone on reload.
//
// Storage is injectable (Pick<Storage,...>) so tests run without a real DOM,
// and every access is try/catch-guarded — storage can throw in private-mode /
// embedded contexts and must never crash the app.

import type { ChatProviderId } from './provider.js'

export type WritableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const CONFIG_KEY = 'arduconfig:ai-assistant:config'
const API_KEY_KEY = 'arduconfig:ai-assistant:key'
const SCHEMA_VERSION = 1

export interface PersistedProviderConfig {
  providerId: ChatProviderId
  model: string
  baseUrl?: string
  /** When true, the API key is persisted alongside this config (opt-in). */
  rememberKey: boolean
  /** When true (default), the model is offered the propose_param_changes tool.
   *  Off = read-only Q&A. Optional for backward compatibility with slice-1
   *  configs that predate it. */
  allowProposals?: boolean
}

interface StoredConfigEnvelope {
  version: number
  config: PersistedProviderConfig
}

const VALID_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'ollama', 'mock'])

function isPersistedConfig(value: unknown): value is PersistedProviderConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.providerId === 'string' &&
    VALID_PROVIDERS.has(candidate.providerId) &&
    typeof candidate.model === 'string' &&
    (candidate.baseUrl === undefined || typeof candidate.baseUrl === 'string') &&
    typeof candidate.rememberKey === 'boolean' &&
    (candidate.allowProposals === undefined || typeof candidate.allowProposals === 'boolean')
  )
}

/** Load persisted non-secret config, or undefined if absent/corrupt. */
export function loadProviderConfig(storage: WritableStorage): PersistedProviderConfig | undefined {
  try {
    const raw = storage.getItem(CONFIG_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as StoredConfigEnvelope
    if (parsed.version !== SCHEMA_VERSION || !isPersistedConfig(parsed.config)) {
      return undefined
    }
    return parsed.config
  } catch {
    return undefined
  }
}

/** Persist non-secret config. Never writes the API key — see persistApiKey. */
export function saveProviderConfig(storage: WritableStorage, config: PersistedProviderConfig): void {
  try {
    const envelope: StoredConfigEnvelope = { version: SCHEMA_VERSION, config }
    storage.setItem(CONFIG_KEY, JSON.stringify(envelope))
  } catch {
    // Storage unavailable (private mode / embedded) — config just won't persist.
  }
}

/** Load a persisted API key, if the user opted into remembering it. */
export function loadPersistedApiKey(storage: WritableStorage): string | undefined {
  try {
    return storage.getItem(API_KEY_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** Persist the API key (only ever call this when rememberKey is true). */
export function persistApiKey(storage: WritableStorage, apiKey: string): void {
  try {
    storage.setItem(API_KEY_KEY, apiKey)
  } catch {
    // Ignore — key simply stays in memory only.
  }
}

/** Remove any persisted API key (called when the user turns rememberKey off). */
export function clearPersistedApiKey(storage: WritableStorage): void {
  try {
    storage.removeItem(API_KEY_KEY)
  } catch {
    // Ignore.
  }
}
