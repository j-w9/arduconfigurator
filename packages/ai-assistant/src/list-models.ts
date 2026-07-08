// Fetch the models available to a configured provider/key, for the model picker.
//
// Each provider exposes a list endpoint: Anthropic GET /v1/models, OpenAI (and
// OpenAI-compatible gateways) GET /v1/models, Ollama GET /api/tags. Returns a
// sorted list of model ids; throws ChatProviderError on failure so the UI can
// fall back to a free-text model field.

import type { ProviderConnection } from './provider.js'
import { ChatProviderError } from './provider.js'

const ANTHROPIC_DEFAULT = 'https://api.anthropic.com'
const OPENAI_DEFAULT = 'https://api.openai.com'
const OLLAMA_DEFAULT = 'http://localhost:11434'
const ANTHROPIC_VERSION = '2023-06-01'

function trimBase(url: string | undefined, fallback: string): string {
  return (url ?? fallback).replace(/\/$/, '')
}

export async function listModels(connection: ProviderConnection): Promise<string[]> {
  switch (connection.providerId) {
    case 'anthropic':
      return listAnthropicModels(connection)
    case 'openai':
      return listOpenAiModels(connection)
    case 'ollama':
      return listOllamaModels(connection)
    case 'mock':
      return ['mock']
    default:
      return []
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  providerId: ProviderConnection['providerId']
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    throw new ChatProviderError(`Could not reach the model list: ${(error as Error).message}`, providerId)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ChatProviderError(
      `Model list error ${response.status}: ${detail.slice(0, 200)}`,
      providerId,
      response.status
    )
  }
  return response.json()
}

async function listAnthropicModels(connection: ProviderConnection): Promise<string[]> {
  if (!connection.apiKey) throw new ChatProviderError('An Anthropic API key is required.', 'anthropic')
  const base = trimBase(connection.baseUrl, ANTHROPIC_DEFAULT)
  const body = (await fetchJson(
    `${base}/v1/models?limit=100`,
    {
      'x-api-key': connection.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    'anthropic'
  )) as { data?: Array<{ id?: string }> }
  return sortIds((body.data ?? []).map((entry) => entry.id).filter(isNonEmpty))
}

async function listOpenAiModels(connection: ProviderConnection): Promise<string[]> {
  if (!connection.apiKey) throw new ChatProviderError('An OpenAI API key is required.', 'openai')
  const base = trimBase(connection.baseUrl, OPENAI_DEFAULT)
  const body = (await fetchJson(
    `${base}/v1/models`,
    { authorization: `Bearer ${connection.apiKey}` },
    'openai'
  )) as { data?: Array<{ id?: string }> }
  const ids = (body.data ?? []).map((entry) => entry.id).filter(isNonEmpty)
  // Prefer chat-capable models when the endpoint is real OpenAI (it also lists
  // embeddings/tts/whisper); keep everything if the filter would empty the list
  // (OpenAI-compatible gateways name models differently).
  const chat = ids.filter((id) => /gpt|^o\d|chatgpt/i.test(id))
  return sortIds(chat.length > 0 ? chat : ids)
}

async function listOllamaModels(connection: ProviderConnection): Promise<string[]> {
  const base = trimBase(connection.baseUrl, OLLAMA_DEFAULT)
  const body = (await fetchJson(`${base}/api/tags`, {}, 'ollama')) as {
    models?: Array<{ name?: string }>
  }
  return sortIds((body.models ?? []).map((entry) => entry.name).filter(isNonEmpty))
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function sortIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
