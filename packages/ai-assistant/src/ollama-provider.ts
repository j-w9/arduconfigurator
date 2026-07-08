// Ollama adapter — a local model over the /api/chat endpoint (NDJSON stream).
//
// No API key. baseUrl defaults to http://localhost:11434 and is user-editable.
// For the browser to reach a local Ollama across origins the user must start it
// with OLLAMA_ORIGINS set to allow the app origin — the settings UI notes this.

import type { ChatEvent, ChatMessage, ChatProvider, ChatRequest } from './provider.js'
import { ChatProviderError } from './provider.js'
import type { ToolDefinition } from './tools.js'
import { iterateLines } from './stream.js'

const DEFAULT_BASE_URL = 'http://localhost:11434'

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
}

function toOllamaMessages(system: string, messages: ChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content,
        tool_calls:
          message.toolCalls && message.toolCalls.length > 0
            ? message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.arguments }
              }))
            : undefined
      })
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', content: message.content })
    } else {
      out.push({ role: 'user', content: message.content })
    }
  }
  return out
}

function toOllamaTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }))
}

export function createOllamaProvider(options: { baseUrl?: string }): ChatProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  return {
    id: 'ollama',
    async *send(request: ChatRequest): AsyncIterable<ChatEvent> {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            messages: toOllamaMessages(request.system, request.messages),
            tools: toOllamaTools(request.tools),
            stream: true
          }),
          signal: request.signal
        })
      } catch (error) {
        throw new ChatProviderError(
          `Could not reach Ollama at ${baseUrl}: ${(error as Error).message}. Is it running, and is OLLAMA_ORIGINS set to allow this page?`,
          'ollama'
        )
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new ChatProviderError(
          `Ollama error ${response.status}: ${detail.slice(0, 300)}`,
          'ollama',
          response.status
        )
      }

      let stopReason: 'end' | 'tool-use' = 'end'
      let toolIndex = 0

      for await (const line of iterateLines(response)) {
        let frame: {
          message?: {
            content?: string
            tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>
          }
          done?: boolean
          error?: string
        }
        try {
          frame = JSON.parse(line)
        } catch {
          continue
        }
        if (frame.error) {
          yield { type: 'error', message: `Ollama: ${frame.error}` }
          return
        }
        if (frame.message?.content) {
          yield { type: 'text-delta', text: frame.message.content }
        }
        for (const call of frame.message?.tool_calls ?? []) {
          if (!call.function?.name) continue
          stopReason = 'tool-use'
          yield {
            type: 'tool-call',
            call: {
              id: `ollama-tool-${toolIndex++}`,
              name: call.function.name,
              arguments: call.function.arguments ?? {}
            }
          }
        }
      }
      yield { type: 'done', stopReason }
    }
  }
}
