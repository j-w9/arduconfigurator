// Anthropic Messages API adapter (browser BYOK).
//
// Direct-from-browser calls require the anthropic-dangerous-direct-browser-access
// header; the x-api-key is the user's own key, held in memory (or opt-in
// localStorage) and sent only to api.anthropic.com (or a user-set base URL).

import type { ChatEvent, ChatMessage, ChatProvider, ChatRequest } from './provider.js'
import { ChatProviderError } from './provider.js'
import type { ToolDefinition } from './tools.js'
import { iterateLines, sseData } from './stream.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 4096

interface AnthropicBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const content: AnthropicBlock[] = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
      }
      out.push({ role: 'assistant', content })
      continue
    }
    // user + tool both map to a user turn; merge consecutive ones so tool
    // results ride in a single user message, as the API expects.
    const block: AnthropicBlock =
      message.role === 'tool'
        ? { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }
        : { type: 'text', text: message.content }
    const previous = out[out.length - 1]
    if (previous && previous.role === 'user') previous.content.push(block)
    else out.push({ role: 'user', content: [block] })
  }
  return out
}

function toAnthropicTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

export function createAnthropicProvider(options: { apiKey: string; baseUrl?: string }): ChatProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  return {
    id: 'anthropic',
    async *send(request: ChatRequest): AsyncIterable<ChatEvent> {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: MAX_TOKENS,
            system: request.system,
            messages: toAnthropicMessages(request.messages),
            tools: toAnthropicTools(request.tools),
            stream: true
          }),
          signal: request.signal
        })
      } catch (error) {
        throw new ChatProviderError(
          `Could not reach Anthropic: ${(error as Error).message}`,
          'anthropic'
        )
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new ChatProviderError(
          `Anthropic API error ${response.status}: ${detail.slice(0, 300)}`,
          'anthropic',
          response.status
        )
      }

      let stopReason: 'end' | 'tool-use' = 'end'
      let toolId = ''
      let toolName = ''
      let toolJson = ''
      let inToolBlock = false

      for await (const line of iterateLines(response)) {
        const data = sseData(line)
        if (!data) continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(data) as Record<string, unknown>
        } catch {
          continue
        }
        const type = event.type as string
        if (type === 'content_block_start') {
          const block = event.content_block as AnthropicBlock
          if (block?.type === 'tool_use') {
            inToolBlock = true
            toolId = block.id ?? ''
            toolName = block.name ?? ''
            toolJson = ''
          }
        } else if (type === 'content_block_delta') {
          const delta = event.delta as { type?: string; text?: string; partial_json?: string }
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text-delta', text: delta.text }
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            toolJson += delta.partial_json
          }
        } else if (type === 'content_block_stop') {
          if (inToolBlock) {
            inToolBlock = false
            let args: Record<string, unknown> = {}
            try {
              args = toolJson ? (JSON.parse(toolJson) as Record<string, unknown>) : {}
            } catch {
              args = {}
            }
            yield { type: 'tool-call', call: { id: toolId, name: toolName, arguments: args } }
          }
        } else if (type === 'message_delta') {
          const delta = event.delta as { stop_reason?: string }
          if (delta?.stop_reason === 'tool_use') stopReason = 'tool-use'
        } else if (type === 'error') {
          const err = event.error as { message?: string }
          yield { type: 'error', message: err?.message ?? 'Anthropic stream error' }
          return
        }
      }
      yield { type: 'done', stopReason }
    }
  }
}
