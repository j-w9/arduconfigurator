// MSP v1 frame encode/decode.
//
// Layout, from Betaflight src/main/msp/msp_serial.c:
//
//   '$' 'M' <dir> <size> <cmd> <payload...> <checksum>
//
// The checksum is an XOR from V1_CHECKSUM_STARTPOS (3) — that is, over the size
// byte, the command byte and the payload, excluding the three header bytes.
// Not a CRC: crc8_dvb_s2 belongs to MSP v2 ('$X'), which this does not speak.

import { MSP_DIRECTION, MSP_V1_MAGIC, MSP_V1_MAX_PAYLOAD } from './constants.js'

export interface MspFrame {
  command: number
  payload: Uint8Array
  /** True when the FC replied with '!' — it understood the framing and refused. */
  isError: boolean
}

/** XOR over size + command + payload, as msp_serial.c computes it. */
export function mspV1Checksum(command: number, payload: Uint8Array): number {
  let checksum = payload.length ^ command
  for (const byte of payload) {
    checksum ^= byte
  }
  return checksum & 0xff
}

export function encodeMspV1Request(command: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  if (payload.length > MSP_V1_MAX_PAYLOAD) {
    // v1 carries the length in a single byte, so this cannot be framed at all.
    throw new Error(`MSP v1 payload too large: ${payload.length} > ${MSP_V1_MAX_PAYLOAD}`)
  }
  const frame = new Uint8Array(6 + payload.length)
  frame[0] = MSP_V1_MAGIC[0]
  frame[1] = MSP_V1_MAGIC[1]
  frame[2] = MSP_DIRECTION.REQUEST
  frame[3] = payload.length
  frame[4] = command
  frame.set(payload, 5)
  frame[5 + payload.length] = mspV1Checksum(command, payload)
  return frame
}

/**
 * Incremental decoder.
 *
 * A serial transport hands over arbitrary chunks, so frames arrive split and
 * several can share one chunk. This keeps a rolling buffer and yields whole
 * frames only.
 */
export class MspV1Decoder {
  private buffer: number[] = []

  push(chunk: Uint8Array): MspFrame[] {
    for (const byte of chunk) {
      this.buffer.push(byte)
    }

    const frames: MspFrame[] = []
    for (;;) {
      // Resynchronise on '$','M': a board mid-boot emits console text on the
      // same wire, and a decoder that trusted position would never recover.
      let start = 0
      while (
        start + 1 < this.buffer.length &&
        !(this.buffer[start] === MSP_V1_MAGIC[0] && this.buffer[start + 1] === MSP_V1_MAGIC[1])
      ) {
        start += 1
      }
      if (start > 0) {
        this.buffer = this.buffer.slice(start)
      }
      if (this.buffer.length < 6) {
        return frames
      }

      const size = this.buffer[3]
      const total = 6 + size
      if (this.buffer.length < total) {
        return frames
      }

      const direction = this.buffer[2]
      const command = this.buffer[4]
      const payload = Uint8Array.from(this.buffer.slice(5, 5 + size))
      const checksum = this.buffer[total - 1]

      if (mspV1Checksum(command, payload) === checksum) {
        frames.push({ command, payload, isError: direction === MSP_DIRECTION.ERROR })
        this.buffer = this.buffer.slice(total)
      } else {
        // Bad checksum: drop the magic and rescan rather than the whole frame,
        // because the length byte that framed it is itself suspect.
        this.buffer = this.buffer.slice(2)
      }
    }
  }

  reset(): void {
    this.buffer = []
  }
}
