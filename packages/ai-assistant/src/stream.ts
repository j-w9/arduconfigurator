// Shared streaming helpers for the HTTP provider adapters.
//
// All three real backends stream line-oriented bodies — Anthropic and OpenAI
// as Server-Sent Events (`data: {json}` lines), Ollama as NDJSON (one JSON
// object per line). `iterateLines` turns a fetch Response body into an async
// line iterator; each adapter parses those lines per its own wire format.

/** Yield the response body as decoded, newline-delimited lines (no trailing
 *  empties). Works for both SSE and NDJSON since both are line-based. */
export async function* iterateLines(response: Response): AsyncGenerator<string> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length > 0) yield line
        newlineIndex = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail.length > 0) yield tail
  } finally {
    reader.releaseLock()
  }
}

/** Strip the leading `data:` (and optional space) from an SSE data line. */
export function sseData(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined
  return line.slice(5).trimStart()
}
