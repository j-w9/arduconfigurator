// Deterministic mock provider — the offline test seam.
//
// Mirrors how the demo transport lets the whole app run with no hardware: the
// mock provider lets the AI Assistant run with no API key and no network, so
// unit tests and Playwright e2e can exercise the full send loop (user turn ->
// tool call -> app executes the read-only tool -> tool result -> assistant
// text) with a stable, assertable script.

import type { ChatEvent, ChatProvider, ChatRequest } from './provider.js'

const TOOL_CALL_ID = 'mock-call-1'

/** Prompt marker that makes the mock keep requesting a tool forever as long as
 *  tools are on offer — the e2e seam for exercising the hook's tool-iteration
 *  cap and its forced, tool-free wrap-up turn deterministically. */
const LOOP_FOREVER_MARKER = 'LOOP_TEST_MARKER'

export function createMockProvider(): ChatProvider {
  return {
    id: 'mock',
    async *send(request: ChatRequest): AsyncIterable<ChatEvent> {
      const last = request.messages[request.messages.length - 1]

      // No tools on offer — this is the hook's forced wrap-up turn after
      // hitting its tool-call budget (or any tool-free call). A real provider
      // physically cannot request a tool here, so the mock must answer in
      // prose too, exercising the same "synthesize from what's gathered" path.
      if (request.tools.length === 0) {
        yield { type: 'text-delta', text: 'Summarizing from everything gathered so far.' }
        yield { type: 'done', stopReason: 'end' }
        return
      }

      // Deterministic infinite-tool-use seam: keeps requesting the same
      // read-only tool on every turn for as long as tools remain on offer, so
      // e2e can drive the hook into its iteration cap without depending on
      // real model behavior.
      if (request.messages.some((message) => message.role === 'user' && message.content.includes(LOOP_FOREVER_MARKER))) {
        yield { type: 'tool-call', call: { id: `mock-loop-${request.messages.length}`, name: 'get_vehicle_info', arguments: {} } }
        yield { type: 'done', stopReason: 'tool-use' }
        return
      }

      // A write-intent prompt (and the propose tool is on offer) → stage a
      // proposal. Used by e2e to exercise the propose→approve→apply flow.
      const proposeOffered = request.tools.some((tool) => tool.name === 'propose_param_changes')
      if (
        last?.role === 'user' &&
        // Ignore synthetic bracketed system notes (e.g. the post-apply outcome
        // the hook injects) so we only propose in response to a real prompt.
        !last.content.startsWith('[') &&
        proposeOffered &&
        /propose|raise|increase|bump|tune/i.test(last.content)
      ) {
        yield { type: 'text-delta', text: 'Here is a proposed change for you to review. ' }
        yield {
          type: 'tool-call',
          call: {
            id: 'mock-propose-1',
            name: 'propose_param_changes',
            arguments: {
              summary: 'Nudge pitch-axis rate P gain up slightly.',
              changes: [
                { paramId: 'ATC_RAT_PIT_P', value: 0.145, reason: 'Small increase for crisper pitch response.' }
              ]
            }
          }
        }
        yield { type: 'done', stopReason: 'tool-use' }
        return
      }

      // After a tool result comes back, produce a final text answer.
      if (last?.role === 'tool') {
        let vehicle = 'the connected vehicle'
        try {
          const parsed = JSON.parse(last.content) as { data?: { vehicle?: string } }
          if (parsed.data?.vehicle) vehicle = parsed.data.vehicle
        } catch {
          // Non-JSON tool result — fall back to the generic phrasing.
        }
        for (const chunk of ['Based on ', 'get_vehicle_info, this is ', `${vehicle}.`]) {
          yield { type: 'text-delta', text: chunk }
        }
        yield { type: 'done', stopReason: 'end' }
        return
      }

      // First assistant turn: call a read-only tool to demonstrate the loop.
      yield { type: 'text-delta', text: 'Let me check the vehicle. ' }
      yield {
        type: 'tool-call',
        call: { id: TOOL_CALL_ID, name: 'get_vehicle_info', arguments: {} }
      }
      yield { type: 'done', stopReason: 'tool-use' }
    }
  }
}
