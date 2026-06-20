import type { MavlinkEnvelope } from './messages.js'

export interface StreamingCodec<TMessage> {
  encode(message: TMessage): Uint8Array
  push(chunk: Uint8Array): TMessage[]
  reset(): void
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class JsonLinesMavlinkCodec implements StreamingCodec<MavlinkEnvelope> {
  private buffer = ''

  encode(message: MavlinkEnvelope): Uint8Array {
    return textEncoder.encode(`${JSON.stringify(message)}\n`)
  }

  push(chunk: Uint8Array): MavlinkEnvelope[] {
    this.buffer += textDecoder.decode(chunk, { stream: true })
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    const envelopes: MavlinkEnvelope[] = []
    for (const raw of lines) {
      const line = raw.trim()
      if (line.length === 0) {
        continue
      }
      try {
        envelopes.push(JSON.parse(line) as MavlinkEnvelope)
      } catch {
        // One corrupt line must not throw out of push() and drop every
        // other (good) envelope in this chunk, nor wedge the session.
      }
    }
    return envelopes
  }

  reset(): void {
    this.buffer = ''
  }
}

export function decodeSingleJsonEnvelope(frame: Uint8Array): MavlinkEnvelope {
  const decoded = textDecoder.decode(frame).trim()
  return JSON.parse(decoded) as MavlinkEnvelope
}
