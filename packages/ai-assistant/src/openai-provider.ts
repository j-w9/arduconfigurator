// OpenAI Chat Completions adapter (browser BYOK).
//
// Uses the streaming chat/completions endpoint with function/tool calling.
// baseUrl is overridable so OpenAI-compatible gateways (Azure/OpenRouter/etc.)
// work by pointing at their /v1.

import type { ChatEvent, ChatMessage, ChatProvider, ChatRequest } from './provider.js'
import { ChatProviderError } from './provider.js'
import type { ToolDefinition } from './tools.js'
import { iterateLines, sseData } from './stream.js'

const DEFAULT_BASE_URL = 'https://api.openai.com'

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls:
          message.toolCalls && message.toolCalls.length > 0
            ? message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) }
              }))
            : undefined
      })
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', content: message.content, tool_call_id: message.toolCallId })
    } else {
      out.push({ role: 'user', content: message.content })
    }
  }
  return out
}

function toOpenAiTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }))
}

interface PendingToolCall {
  id: string
  name: string
  args: string
}

export function createOpenAiProvider(options: { apiKey: string; baseUrl?: string }): ChatProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  return {
    id: 'openai',
    async *send(request: ChatRequest): AsyncIterable<ChatEvent> {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`
          },
          body: JSON.stringify({
            model: request.model,
            messages: toOpenAiMessages(request.system, request.messages),
            tools: toOpenAiTools(request.tools),
            stream: true
          }),
          signal: request.signal
        })
      } catch (error) {
        throw new ChatProviderError(`Could not reach OpenAI: ${(error as Error).message}`, 'openai')
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new ChatProviderError(
          `OpenAI API error ${response.status}: ${detail.slice(0, 300)}`,
          'openai',
          response.status
        )
      }

      const pending = new Map<number, PendingToolCall>()
      let stopReason: 'end' | 'tool-use' = 'end'

      for await (const line of iterateLines(response)) {
        const data = sseData(line)
        if (!data || data === '[DONE]') continue
        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{
                index: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string
          }>
        }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.delta?.content) {
          yield { type: 'text-delta', text: choice.delta.content }
        }
        for (const toolDelta of choice.delta?.tool_calls ?? []) {
          const existing = pending.get(toolDelta.index) ?? { id: '', name: '', args: '' }
          if (toolDelta.id) existing.id = toolDelta.id
          if (toolDelta.function?.name) existing.name = toolDelta.function.name
          if (toolDelta.function?.arguments) existing.args += toolDelta.function.arguments
          pending.set(toolDelta.index, existing)
        }
        if (choice.finish_reason === 'tool_calls') stopReason = 'tool-use'
      }

      if (stopReason === 'tool-use') {
        for (const call of pending.values()) {
          let args: Record<string, unknown> = {}
          try {
            args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {}
          } catch {
            args = {}
          }
          yield { type: 'tool-call', call: { id: call.id, name: call.name, arguments: args } }
        }
      }
      yield { type: 'done', stopReason }
    }
  }
}
