import {
  MAVLINK_MESSAGE_CRCS,
  MAVLINK_MESSAGE_IDS,
  MAVLINK_MIN_PAYLOAD_LENGTHS,
  MAVLINK_PAYLOAD_LENGTHS,
  MAVLINK_PROTOCOL_VERSION,
  MAVLINK_V2_CHECKSUM_LENGTH,
  MAVLINK_V2_HEADER_LENGTH,
  MAVLINK_V2_INCOMPAT_FLAG_SIGNED,
  MAVLINK_V2_SIGNATURE_LENGTH,
  MAVLINK_V2_STX,
} from './constants.js'
import { sha256 } from './sha256.js'
import type { StreamingCodec } from './json-lines-codec.js'
import type {
  AttitudeMessage,
  AutopilotVersionMessage,
  CommandAckMessage,
  CommandLongMessage,
  GpsInputMessage,
  FileTransferProtocolMessage,
  GlobalPositionIntMessage,
  HeartbeatMessage,
  LogDataMessage,
  LogEntryMessage,
  LogRequestDataMessage,
  LogRequestEndMessage,
  LogRequestListMessage,
  MagCalProgressMessage,
  MagCalReportMessage,
  MavlinkEnvelope,
  MavlinkMessage,
  ParamRequestListMessage,
  ParamSetMessage,
  ParamValueMessage,
  CanFrameMessage,
  OpticalFlowMessage,
  RcChannelsMessage,
  SetupSigningMessage,
  StatusTextMessage,
  SysStatusMessage,
  UavcanNodeInfoMessage,
  UavcanNodeStatusMessage,
} from './messages.js'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// A complete MAVLink v2 frame is at most HEADER(10) + payload(255) +
// CHECKSUM(2) + SIGNATURE(13) = 280 bytes. Bound the resync buffer so a
// stream that never forms a decodable frame (wrong baud / non-MAVLink
// device) can't grow unbounded; trimming to the last RETAINED_TAIL_BYTES
// is lossless for valid traffic since older bytes can't start a real frame.
const MAX_BUFFER_BYTES = 4096
const RETAINED_TAIL_BYTES = 512

// --- MAVLink v2 message signing (spec: https://mavlink.io/en/guide/message_signing.html) ---

/** A signed-frame secret key is always exactly 32 bytes. */
export const MAVLINK_V2_SIGNING_KEY_LENGTH = 32

/**
 * MAVLink signing timestamps count 10-microsecond units since
 * 2015-01-01 00:00:00 UTC (the unix epoch + 1420070400 s). They are 48-bit
 * little-endian on the wire.
 */
export const MAVLINK_V2_SIGNING_EPOCH_UNIX_SECONDS = 1_420_070_400
/** Max value of the 48-bit little-endian timestamp field. */
const MAVLINK_V2_SIGNING_TIMESTAMP_MAX = 2 ** 48 - 1
/**
 * Frames whose timestamp is more than this many 10us units (== 1 minute)
 * behind our local clock are rejected as stale/replayed. 6_000_000 units *
 * 10us = 60 s.
 */
export const MAVLINK_V2_SIGNING_MAX_AGE_UNITS = 6_000_000

/** Injectable timestamp source: returns 10us-since-2015 as a JS number. */
export type MavlinkSigningClock = () => number

/**
 * Derive the 32-byte MAVLink signing key from a user passphrase.
 *
 * This matches the de-facto GCS convention (Mission Planner / QGC): the
 * key is the SHA-256 of the UTF-8 bytes of the passphrase. SHA-256 already
 * produces exactly 32 bytes, so no truncation/padding is needed. The same
 * passphrase therefore derives the same key on any GCS, and the FC ends up
 * with the same key once provisioned via SETUP_SIGNING — which is the whole
 * point: GCS and FC must hold an identical 32-byte secret.
 *
 * Reference: MAVLink message-signing guide ("A user-entered string that is
 * then run through SHA-256") and Mission Planner's MAVLinkInterface.cs
 * (`SHA256.ComputeHash(Encoding.UTF8.GetBytes(userseed))`, resized to 32).
 */
export function deriveSigningKeyFromPassphrase(passphrase: string): Uint8Array {
  return sha256(textEncoder.encode(passphrase))
}

/**
 * Current MAVLink signing timestamp as a bigint (10us units since
 * 2015-01-01 UTC). Used to seed SETUP_SIGNING.initial_timestamp so the FC
 * starts its replay window aligned with our clock. Mirrors Mission Planner's
 * `(DateTime.UtcNow - 2015-01-01).TotalMilliseconds * 100`.
 */
export function currentSigningTimestamp(): bigint {
  const ms = Date.now() - MAVLINK_V2_SIGNING_EPOCH_UNIX_SECONDS * 1000
  if (ms <= 0) {
    return 0n
  }
  return BigInt(Math.floor(ms)) * 100n
}

/** Signing configuration applied to a codec. */
export interface MavlinkV2SigningConfig {
  /** 32-byte shared secret. */
  secretKey: Uint8Array
  /** Link id (0..255) stamped into the trailer; defaults to 0. */
  linkId?: number
  /** When false, encode() emits unsigned frames and decode() does not verify. */
  enabled?: boolean
  /**
   * Override the timestamp source (10us-since-2015). Used for deterministic
   * tests; defaults to a real monotonic clock. The codec still enforces
   * per-stream monotonicity on top of whatever this returns.
   */
  clock?: MavlinkSigningClock
}

/** Why a signed frame was dropped on decode. */
export type MavlinkSignatureRejectionReason =
  | 'bad-signature'
  | 'replay-timestamp'
  | 'timestamp-too-old'

export interface MavlinkSignatureRejection {
  reason: MavlinkSignatureRejectionReason
  systemId: number
  componentId: number
  linkId: number
}

/** Real 10us-since-2015 clock, monotonic-guarded by the codec on top. */
function defaultSigningClock(): number {
  const unitsSinceEpoch = (Date.now() - MAVLINK_V2_SIGNING_EPOCH_UNIX_SECONDS * 1000) * 100
  // Clamp into the valid 48-bit range. Before 2015 (clock skew / fake test
  // clocks) this would go negative; never emit a negative timestamp.
  if (unitsSinceEpoch < 0) {
    return 0
  }
  if (unitsSinceEpoch > MAVLINK_V2_SIGNING_TIMESTAMP_MAX) {
    return MAVLINK_V2_SIGNING_TIMESTAMP_MAX
  }
  return Math.floor(unitsSinceEpoch)
}

/** Per-(sysId,compId,linkId) stream key for replay tracking. */
function streamKey(systemId: number, componentId: number, linkId: number): string {
  return `${systemId & 0xff}:${componentId & 0xff}:${linkId & 0xff}`
}

/**
 * Write a 48-bit value little-endian into `out` at `offset`. JS bitwise ops
 * are 32-bit, so the high 16 bits are handled with division, not shifts.
 */
function writeUint48LE(out: Uint8Array, offset: number, value: number): void {
  let remaining = value
  for (let i = 0; i < 6; i += 1) {
    out[offset + i] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }
}

/** Read a 48-bit little-endian value as a JS number (exact up to 2^53). */
function readUint48LE(bytes: Uint8Array, offset: number): number {
  let value = 0
  let scale = 1
  for (let i = 0; i < 6; i += 1) {
    value += bytes[offset + i] * scale
    scale *= 256
  }
  return value
}

/**
 * Compute the 6-byte MAVLink v2 signature.
 *
 * signature = first 6 bytes of SHA-256(
 *   secretKey[32] ++ completeFrame ++ linkId(1) ++ timestamp(6 LE)
 * )
 *
 * `completeFrame` MUST be the full v2 frame (magic .. 2-byte CRC) with the
 * SIGNED incompat flag already set, but WITHOUT the 13-byte signature
 * trailer. Hash-input byte order, exactly: secretKey, then the frame bytes,
 * then the single linkId byte, then the 6 little-endian timestamp bytes.
 */
function computeSignature(
  secretKey: Uint8Array,
  completeFrame: Uint8Array,
  linkId: number,
  timestamp: number
): Uint8Array {
  const input = new Uint8Array(secretKey.length + completeFrame.length + 1 + 6)
  let offset = 0
  input.set(secretKey, offset)
  offset += secretKey.length
  input.set(completeFrame, offset)
  offset += completeFrame.length
  input[offset] = linkId & 0xff
  offset += 1
  writeUint48LE(input, offset, timestamp)
  return sha256(input).subarray(0, MAVLINK_V2_SIGNATURE_LENGTH - 7)
  // MAVLINK_V2_SIGNATURE_LENGTH (13) = link_id(1) + timestamp(6) + sig(6),
  // so the signature itself is 6 bytes; 13 - 7 == 6.
}

export class MavlinkV2Codec implements StreamingCodec<MavlinkEnvelope> {
  private buffer: Uint8Array = new Uint8Array(0)

  private signing?: Required<MavlinkV2SigningConfig>

  /** Largest signing timestamp we have emitted, kept monotonic per stream. */
  private lastSentTimestamp = new Map<string, number>()

  /** Largest accepted RX timestamp per (sysId,compId,linkId) — replay guard. */
  private lastSeenTimestamp = new Map<string, number>()

  private signatureRejections = 0

  private onSignatureRejection?: (rejection: MavlinkSignatureRejection) => void

  /**
   * Enable MAVLink v2 message signing/verification. When configured and
   * enabled, encode() emits signed frames and decode() verifies the SIGNED
   * frames it receives (dropping any that fail). Passing `undefined` (or an
   * object with `enabled: false`) restores the default unsigned behaviour.
   */
  setSigningConfig(config: MavlinkV2SigningConfig | undefined): void {
    if (!config) {
      this.signing = undefined
      return
    }
    if (config.secretKey.length !== MAVLINK_V2_SIGNING_KEY_LENGTH) {
      throw new Error(
        `MAVLink signing secret key must be ${MAVLINK_V2_SIGNING_KEY_LENGTH} bytes, got ${config.secretKey.length}.`
      )
    }
    this.signing = {
      secretKey: config.secretKey,
      linkId: (config.linkId ?? 0) & 0xff,
      enabled: config.enabled ?? true,
      clock: config.clock ?? defaultSigningClock
    }
  }

  /** Register a callback invoked whenever a signed frame is dropped. */
  setSignatureRejectionHandler(
    handler: ((rejection: MavlinkSignatureRejection) => void) | undefined
  ): void {
    this.onSignatureRejection = handler
  }

  /** Total number of signed frames dropped by verification so far. */
  getSignatureRejectionCount(): number {
    return this.signatureRejections
  }

  /** Next monotonic timestamp for an outbound frame on the given stream. */
  private nextSendTimestamp(streamId: string): number {
    const now = this.signing!.clock()
    const last = this.lastSentTimestamp.get(streamId) ?? -1
    // Monotonic-per-stream: strictly increase by >= 1 even if the clock
    // didn't advance (or went backwards) between two encodes.
    const next = now > last ? now : last + 1
    const clamped = Math.min(next, MAVLINK_V2_SIGNING_TIMESTAMP_MAX)
    this.lastSentTimestamp.set(streamId, clamped)
    return clamped
  }

  /**
   * Verify a received signed frame: recompute the 6-byte signature over the
   * frame-minus-trailer and compare, then enforce the replay/staleness
   * rules. Returns true to accept, false to drop. `frame` includes the full
   * 13-byte signature trailer; `payloadLength` is the LEN byte.
   */
  private verifySignedFrame(frame: Uint8Array, payloadLength: number): boolean {
    const signing = this.signing!
    const baseLength = MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH
    const trailerOffset = baseLength
    const linkId = frame[trailerOffset]
    const timestamp = readUint48LE(frame, trailerOffset + 1)
    const systemId = frame[5]
    const componentId = frame[6]

    // The signature covers the frame WITHOUT its trailer (header+payload+CRC,
    // with the SIGNED flag set — which it already is on the wire), then the
    // link_id byte and the 6 timestamp bytes. Recompute and compare the 6
    // signature bytes.
    const baseFrame = frame.subarray(0, baseLength)
    const expected = computeSignature(signing.secretKey, baseFrame, linkId, timestamp)
    const received = frame.subarray(trailerOffset + 7, trailerOffset + 13)

    const reject = (reason: MavlinkSignatureRejectionReason): false => {
      this.signatureRejections += 1
      this.onSignatureRejection?.({ reason, systemId, componentId, linkId })
      return false
    }

    let signatureMatches = expected.length === received.length
    // Constant-time-ish compare: never short-circuit on the first mismatch.
    let diff = 0
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected[i] ^ received[i]
    }
    if (diff !== 0) {
      signatureMatches = false
    }
    if (!signatureMatches) {
      return reject('bad-signature')
    }

    const key = streamKey(systemId, componentId, linkId)
    const lastSeen = this.lastSeenTimestamp.get(key)
    // Replay: timestamp must STRICTLY exceed the last accepted one.
    if (lastSeen !== undefined && timestamp <= lastSeen) {
      return reject('replay-timestamp')
    }
    // Staleness: more than 1 minute behind our local clock is rejected.
    const localNow = signing.clock()
    if (timestamp < localNow - MAVLINK_V2_SIGNING_MAX_AGE_UNITS) {
      return reject('timestamp-too-old')
    }

    this.lastSeenTimestamp.set(key, timestamp)
    return true
  }

  encode(envelope: MavlinkEnvelope): Uint8Array {
    const messageId = messageIdFor(envelope.message)
    const payload = encodePayload(envelope.message)
    const payloadLength = payload.length

    const signing = this.signing?.enabled ? this.signing : undefined

    const frame = new Uint8Array(MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH)
    frame[0] = MAVLINK_V2_STX
    frame[1] = payloadLength
    // The SIGNED incompat flag must be set BEFORE the CRC is computed and
    // BEFORE the signature is hashed (the signature covers the whole frame
    // with this flag already present).
    frame[2] = signing ? MAVLINK_V2_INCOMPAT_FLAG_SIGNED : 0
    frame[3] = 0
    frame[4] = envelope.header.sequence & 0xff
    frame[5] = envelope.header.systemId & 0xff
    frame[6] = envelope.header.componentId & 0xff
    frame[7] = messageId & 0xff
    frame[8] = (messageId >> 8) & 0xff
    frame[9] = (messageId >> 16) & 0xff
    frame.set(payload, MAVLINK_V2_HEADER_LENGTH)

    const checksum = crcMessage(frame.subarray(1, MAVLINK_V2_HEADER_LENGTH + payloadLength), MAVLINK_MESSAGE_CRCS[messageId])
    frame[MAVLINK_V2_HEADER_LENGTH + payloadLength] = checksum & 0xff
    frame[MAVLINK_V2_HEADER_LENGTH + payloadLength + 1] = (checksum >> 8) & 0xff

    if (!signing) {
      return frame
    }

    // Signed frame: append link_id(1) + timestamp(6 LE) + signature(6).
    // The signature hashes the complete frame (header+payload+CRC, SIGNED
    // flag already set) plus link_id and timestamp.
    const linkId = signing.linkId
    const timestamp = this.nextSendTimestamp(
      streamKey(envelope.header.systemId, envelope.header.componentId, linkId)
    )
    const signature = computeSignature(signing.secretKey, frame, linkId, timestamp)

    const signed = new Uint8Array(frame.length + MAVLINK_V2_SIGNATURE_LENGTH)
    signed.set(frame, 0)
    const trailerOffset = frame.length
    signed[trailerOffset] = linkId
    writeUint48LE(signed, trailerOffset + 1, timestamp)
    signed.set(signature, trailerOffset + 7)
    return signed
  }

  push(chunk: Uint8Array): MavlinkEnvelope[] {
    this.buffer = concatBytes(this.buffer, chunk)
    const envelopes: MavlinkEnvelope[] = []

    while (this.buffer.length >= MAVLINK_V2_HEADER_LENGTH + MAVLINK_V2_CHECKSUM_LENGTH) {
      const stxIndex = this.buffer.indexOf(MAVLINK_V2_STX)
      if (stxIndex === -1) {
        this.buffer = new Uint8Array(0)
        break
      }

      if (stxIndex > 0) {
        this.buffer = this.buffer.slice(stxIndex)
      }

      if (this.buffer.length < MAVLINK_V2_HEADER_LENGTH + MAVLINK_V2_CHECKSUM_LENGTH) {
        break
      }

      const payloadLength = this.buffer[1]
      const incompatFlags = this.buffer[2]
      const signedLength = incompatFlags & MAVLINK_V2_INCOMPAT_FLAG_SIGNED ? MAVLINK_V2_SIGNATURE_LENGTH : 0
      const frameLength = MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH + signedLength

      if (this.buffer.length < frameLength) {
        // The offset-0 frame isn't fully buffered yet. Usually wait for more
        // bytes, but if a later STX already begins a complete CRC-valid frame
        // the offset-0 candidate was a false/corrupt STX — resync to the
        // provable frame. A merely-incomplete real frame can't contain a
        // valid frame as a suffix, so this never drops a slow-arriving frame.
        const resyncIndex = this.findResyncIndex()
        if (resyncIndex > 0) {
          this.buffer = this.buffer.subarray(resyncIndex)
          continue
        }
        break
      }

      const frame = this.buffer.subarray(0, frameLength)

      const messageId = frame[7] | (frame[8] << 8) | (frame[9] << 16)
      const crcExtra = MAVLINK_MESSAGE_CRCS[messageId]

      const expectedChecksum =
        crcExtra !== undefined
          ? crcMessage(frame.subarray(1, MAVLINK_V2_HEADER_LENGTH + payloadLength), crcExtra)
          : undefined
      const receivedChecksum = frame[MAVLINK_V2_HEADER_LENGTH + payloadLength] | (frame[MAVLINK_V2_HEADER_LENGTH + payloadLength + 1] << 8)

      // If the byte after the STX was junk (corrupted payloadLength, random
      // 0xfd mid-stream, etc.) the CRC will fail and the next-frame search
      // must restart inside the bytes this iteration tentatively consumed.
      // Advancing by 1 forces indexOf to find a different (or later) STX
      // rather than re-locking onto this same false start.
      if (crcExtra === undefined || expectedChecksum !== receivedChecksum) {
        this.buffer = this.buffer.subarray(1)
        continue
      }

      // Frame is structurally valid past this point; commit consumption.
      this.buffer = this.buffer.subarray(frameLength)

      // incompat_flags are mandatory-understanding: a receiver MUST discard
      // frames carrying bits it doesn't implement (MAVLink spec;
      // mavlink_helpers.h MAVLINK_IFLAG_MASK 0x01). SIGNED (0x01) is the
      // only flag we implement, so drop any frame with other bits set.
      if ((incompatFlags & ~MAVLINK_V2_INCOMPAT_FLAG_SIGNED) !== 0) {
        continue
      }

      // Verify only when the frame carries the SIGNED flag AND a key is
      // configured; a failed check drops the frame. With no key configured
      // the frame is parsed and the 13-byte trailer skipped.
      if (signedLength > 0 && this.signing?.enabled) {
        if (!this.verifySignedFrame(frame, payloadLength)) {
          continue
        }
      }

      // MAVLink v2 senders truncate trailing zero bytes; a conformant
      // receiver MUST zero-pad back to the message's full payload length
      // before decoding (the CRC was verified over the truncated bytes +
      // crc_extra, so this only restores the implied zeros).
      const declaredLength = MAVLINK_PAYLOAD_LENGTHS[messageId] ?? payloadLength
      const payload = new Uint8Array(Math.max(declaredLength, payloadLength))
      payload.set(frame.subarray(MAVLINK_V2_HEADER_LENGTH, MAVLINK_V2_HEADER_LENGTH + payloadLength))
      const message = decodePayload(messageId, payload)
      if (!message) {
        continue
      }

      envelopes.push({
        header: {
          systemId: frame[5],
          componentId: frame[6],
          sequence: frame[4]
        },
        message,
        timestampMs: Date.now()
      })
    }

    // Cap the buffer after decoding, not before, so a large coalesced read
    // has all its complete frames parsed first. Whatever remains is a
    // partial in-progress frame (<=280B) or accumulated garbage, so trimming
    // is lossless for valid traffic while bounding memory + the resync scan.
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = this.buffer.slice(this.buffer.length - RETAINED_TAIL_BYTES)
    }

    return envelopes
  }

  reset(): void {
    this.buffer = new Uint8Array(0)
  }

  /**
   * Scan for the earliest STX strictly after offset 0 that begins a
   * complete, CRC-valid frame using only the bytes already buffered.
   * Returns its index, or -1 if none — in which case the caller should
   * keep waiting for more bytes for the offset-0 candidate.
   */
  private findResyncIndex(): number {
    for (let index = 1; index < this.buffer.length; index += 1) {
      if (this.buffer[index] !== MAVLINK_V2_STX) {
        continue
      }
      if (frameIsCompleteAndValid(this.buffer, index)) {
        return index
      }
    }
    return -1
  }
}

/**
 * Spec-faithful MAVLink v2 encoder: emits frames with trailing zero payload
 * bytes stripped (matching real ArduPilot's `GCS_MAVLink::send_message`
 * truncation, see `_mav_finalize_message_chan_send` in libraries/mavlink).
 * The base `MavlinkV2Codec.encode()` does not truncate; this subclass is
 * used by the mock scenario so its frames match the real-FC wire layout
 * (LEN < declared length for any payload with trailing zeros), exercising
 * the receiver-side zero-pad path. `push()` is inherited unchanged.
 */
export class TruncatingMavlinkV2Codec extends MavlinkV2Codec {
  override encode(envelope: MavlinkEnvelope): Uint8Array {
    const fullFrame = super.encode(envelope)
    return truncateMavlinkV2Frame(fullFrame)
  }
}

/**
 * Strip trailing zero payload bytes from a fully-encoded MAVLink v2 frame
 * and rebuild it with the new LEN + recomputed CRC. Pure function: the
 * input frame is left untouched; the returned frame is independent. At
 * least one payload byte is kept (`payloadLength >= 1`), matching real
 * ArduPilot behaviour — a fully zero payload still emits LEN=1 with a
 * single zero byte, not LEN=0.
 */
export function truncateMavlinkV2Frame(frame: Uint8Array): Uint8Array {
  if (frame.length < MAVLINK_V2_HEADER_LENGTH + MAVLINK_V2_CHECKSUM_LENGTH) {
    return frame
  }
  if (frame[0] !== MAVLINK_V2_STX) {
    return frame
  }
  const declaredLength = frame[1]
  // Find last non-zero payload byte, walking right-to-left.
  let truncatedLength = declaredLength
  while (truncatedLength > 1 && frame[MAVLINK_V2_HEADER_LENGTH + truncatedLength - 1] === 0) {
    truncatedLength -= 1
  }
  if (truncatedLength === declaredLength) {
    return frame
  }
  const messageId = frame[7] | (frame[8] << 8) | (frame[9] << 16)
  const crcExtra = MAVLINK_MESSAGE_CRCS[messageId]
  if (crcExtra === undefined) {
    // Unknown message id — refuse to truncate, otherwise the receiver's
    // crc_extra lookup would mismatch and the frame would be dropped.
    return frame
  }
  const out = new Uint8Array(MAVLINK_V2_HEADER_LENGTH + truncatedLength + MAVLINK_V2_CHECKSUM_LENGTH)
  out.set(frame.subarray(0, MAVLINK_V2_HEADER_LENGTH))
  out[1] = truncatedLength
  out.set(frame.subarray(MAVLINK_V2_HEADER_LENGTH, MAVLINK_V2_HEADER_LENGTH + truncatedLength), MAVLINK_V2_HEADER_LENGTH)
  const checksum = crcMessage(out.subarray(1, MAVLINK_V2_HEADER_LENGTH + truncatedLength), crcExtra)
  out[MAVLINK_V2_HEADER_LENGTH + truncatedLength] = checksum & 0xff
  out[MAVLINK_V2_HEADER_LENGTH + truncatedLength + 1] = (checksum >> 8) & 0xff
  return out
}

/**
 * True when a complete, X25-valid frame begins exactly at `offset`. Pure
 * read-only check used by the resync guard; mirrors the structural +
 * checksum validation the main decode loop performs.
 */
function frameIsCompleteAndValid(buffer: Uint8Array, offset: number): boolean {
  if (buffer.length - offset < MAVLINK_V2_HEADER_LENGTH + MAVLINK_V2_CHECKSUM_LENGTH) {
    return false
  }
  const payloadLength = buffer[offset + 1]
  const incompatFlags = buffer[offset + 2]
  const signedLength = incompatFlags & MAVLINK_V2_INCOMPAT_FLAG_SIGNED ? MAVLINK_V2_SIGNATURE_LENGTH : 0
  const frameLength = MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH + signedLength
  if (buffer.length - offset < frameLength) {
    return false
  }
  const messageId = buffer[offset + 7] | (buffer[offset + 8] << 8) | (buffer[offset + 9] << 16)
  const crcExtra = MAVLINK_MESSAGE_CRCS[messageId]
  if (crcExtra === undefined) {
    return false
  }
  const expectedChecksum = crcMessage(
    buffer.subarray(offset + 1, offset + MAVLINK_V2_HEADER_LENGTH + payloadLength),
    crcExtra
  )
  const receivedChecksum =
    buffer[offset + MAVLINK_V2_HEADER_LENGTH + payloadLength] |
    (buffer[offset + MAVLINK_V2_HEADER_LENGTH + payloadLength + 1] << 8)
  return expectedChecksum === receivedChecksum
}

export function decodeSingleV2Envelope(frame: Uint8Array): MavlinkEnvelope {
  const codec = new MavlinkV2Codec()
  const messages = codec.push(frame)
  if (messages.length !== 1) {
    throw new Error(`Expected exactly one MAVLink envelope, got ${messages.length}.`)
  }
  return messages[0]
}

function encodePayload(message: MavlinkMessage): Uint8Array {
  switch (message.type) {
    case 'HEARTBEAT':
      return encodeHeartbeatPayload(message)
    case 'SYS_STATUS':
      return encodeSysStatusPayload(message)
    case 'GLOBAL_POSITION_INT':
      return encodeGlobalPositionIntPayload(message)
    case 'PARAM_REQUEST_LIST':
      return encodeParamRequestListPayload(message)
    case 'PARAM_VALUE':
      return encodeParamValuePayload(message)
    case 'PARAM_SET':
      return encodeParamSetPayload(message)
    case 'ATTITUDE':
      return encodeAttitudePayload(message)
    case 'RC_CHANNELS':
      return encodeRcChannelsPayload(message)
    case 'FILE_TRANSFER_PROTOCOL':
      return encodeFileTransferProtocolPayload(message)
    case 'COMMAND_ACK':
      return encodeCommandAckPayload(message)
    case 'COMMAND_LONG':
      return encodeCommandLongPayload(message)
    case 'GPS_INPUT':
      return encodeGpsInputPayload(message)
    case 'AUTOPILOT_VERSION':
      return encodeAutopilotVersionPayload(message)
    case 'STATUSTEXT':
      return encodeStatusTextPayload(message)
    case 'LOG_REQUEST_LIST':
      return encodeLogRequestListPayload(message)
    case 'LOG_ENTRY':
      return encodeLogEntryPayload(message)
    case 'LOG_REQUEST_DATA':
      return encodeLogRequestDataPayload(message)
    case 'LOG_DATA':
      return encodeLogDataPayload(message)
    case 'LOG_REQUEST_END':
      return encodeLogRequestEndPayload(message)
    case 'MAG_CAL_PROGRESS':
      return encodeMagCalProgressPayload(message)
    case 'MAG_CAL_REPORT':
      return encodeMagCalReportPayload(message)
    case 'UAVCAN_NODE_STATUS':
      return encodeUavcanNodeStatusPayload(message)
    case 'UAVCAN_NODE_INFO':
      return encodeUavcanNodeInfoPayload(message)
    case 'OPTICAL_FLOW':
      return encodeOpticalFlowPayload(message)
    case 'CAN_FRAME':
      return encodeCanFramePayload(message)
    case 'SETUP_SIGNING':
      return encodeSetupSigningPayload(message)
    default:
      throw new Error('Unsupported MAVLink message for encoding.')
  }
}

function decodePayload(messageId: number, payload: Uint8Array): MavlinkMessage | undefined {
  switch (messageId) {
    case MAVLINK_MESSAGE_IDS.HEARTBEAT:
      return decodeHeartbeatPayload(payload)
    case MAVLINK_MESSAGE_IDS.SYS_STATUS:
      return decodeSysStatusPayload(payload)
    case MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT:
      return decodeGlobalPositionIntPayload(payload)
    case MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST:
      return decodeParamRequestListPayload(payload)
    case MAVLINK_MESSAGE_IDS.PARAM_VALUE:
      return decodeParamValuePayload(payload)
    case MAVLINK_MESSAGE_IDS.PARAM_SET:
      return decodeParamSetPayload(payload)
    case MAVLINK_MESSAGE_IDS.ATTITUDE:
      return decodeAttitudePayload(payload)
    case MAVLINK_MESSAGE_IDS.RC_CHANNELS:
      return decodeRcChannelsPayload(payload)
    case MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL:
      return decodeFileTransferProtocolPayload(payload)
    case MAVLINK_MESSAGE_IDS.COMMAND_ACK:
      return decodeCommandAckPayload(payload)
    case MAVLINK_MESSAGE_IDS.COMMAND_LONG:
      return decodeCommandLongPayload(payload)
    case MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION:
      return decodeAutopilotVersionPayload(payload)
    case MAVLINK_MESSAGE_IDS.STATUSTEXT:
      return decodeStatusTextPayload(payload)
    case MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST:
      return decodeLogRequestListPayload(payload)
    case MAVLINK_MESSAGE_IDS.LOG_ENTRY:
      return decodeLogEntryPayload(payload)
    case MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA:
      return decodeLogRequestDataPayload(payload)
    case MAVLINK_MESSAGE_IDS.LOG_DATA:
      return decodeLogDataPayload(payload)
    case MAVLINK_MESSAGE_IDS.LOG_REQUEST_END:
      return decodeLogRequestEndPayload(payload)
    case MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS:
      return decodeMagCalProgressPayload(payload)
    case MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT:
      return decodeMagCalReportPayload(payload)
    case MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS:
      return decodeUavcanNodeStatusPayload(payload)
    case MAVLINK_MESSAGE_IDS.UAVCAN_NODE_INFO:
      return decodeUavcanNodeInfoPayload(payload)
    case MAVLINK_MESSAGE_IDS.OPTICAL_FLOW:
      return decodeOpticalFlowPayload(payload)
    case MAVLINK_MESSAGE_IDS.CAN_FRAME:
      return decodeCanFramePayload(payload)
    default:
      return undefined
  }
}

function messageIdFor(message: MavlinkMessage): number {
  switch (message.type) {
    case 'HEARTBEAT':
      return MAVLINK_MESSAGE_IDS.HEARTBEAT
    case 'SYS_STATUS':
      return MAVLINK_MESSAGE_IDS.SYS_STATUS
    case 'GLOBAL_POSITION_INT':
      return MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT
    case 'PARAM_REQUEST_LIST':
      return MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST
    case 'PARAM_VALUE':
      return MAVLINK_MESSAGE_IDS.PARAM_VALUE
    case 'PARAM_SET':
      return MAVLINK_MESSAGE_IDS.PARAM_SET
    case 'ATTITUDE':
      return MAVLINK_MESSAGE_IDS.ATTITUDE
    case 'RC_CHANNELS':
      return MAVLINK_MESSAGE_IDS.RC_CHANNELS
    case 'FILE_TRANSFER_PROTOCOL':
      return MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL
    case 'COMMAND_ACK':
      return MAVLINK_MESSAGE_IDS.COMMAND_ACK
    case 'COMMAND_LONG':
      return MAVLINK_MESSAGE_IDS.COMMAND_LONG
    case 'GPS_INPUT':
      return MAVLINK_MESSAGE_IDS.GPS_INPUT
    case 'AUTOPILOT_VERSION':
      return MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION
    case 'STATUSTEXT':
      return MAVLINK_MESSAGE_IDS.STATUSTEXT
    case 'LOG_REQUEST_LIST':
      return MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST
    case 'LOG_ENTRY':
      return MAVLINK_MESSAGE_IDS.LOG_ENTRY
    case 'LOG_REQUEST_DATA':
      return MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA
    case 'LOG_DATA':
      return MAVLINK_MESSAGE_IDS.LOG_DATA
    case 'LOG_REQUEST_END':
      return MAVLINK_MESSAGE_IDS.LOG_REQUEST_END
    case 'MAG_CAL_PROGRESS':
      return MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS
    case 'MAG_CAL_REPORT':
      return MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT
    case 'UAVCAN_NODE_STATUS':
      return MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS
    case 'UAVCAN_NODE_INFO':
      return MAVLINK_MESSAGE_IDS.UAVCAN_NODE_INFO
    case 'OPTICAL_FLOW':
      return MAVLINK_MESSAGE_IDS.OPTICAL_FLOW
    case 'CAN_FRAME':
      return MAVLINK_MESSAGE_IDS.CAN_FRAME
    case 'SETUP_SIGNING':
      return MAVLINK_MESSAGE_IDS.SETUP_SIGNING
    default:
      throw new Error('Unsupported MAVLink message.')
  }
}

/**
 * Encode the SETUP_SIGNING (msgid 256) payload. Field byte order follows the
 * MAVLink size-sorted wire layout from the packed C struct:
 *   initial_timestamp (uint64 LE) @0, target_system @8, target_component @9,
 *   secret_key[32] @10. Total 42 bytes.
 */
function encodeSetupSigningPayload(message: SetupSigningMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.SETUP_SIGNING])
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, message.initialTimestamp, true)
  view.setUint8(8, message.targetSystem & 0xff)
  view.setUint8(9, message.targetComponent & 0xff)
  // secret_key is exactly 32 bytes; a short key zero-pads, an over-long one
  // is truncated (the codec separately enforces 32-byte keys on the signing
  // config path, so this is defensive).
  payload.set(message.secretKey.subarray(0, 32), 10)
  return payload
}

function encodeHeartbeatPayload(message: HeartbeatMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.HEARTBEAT])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.customMode, true)
  view.setUint8(4, message.vehicleType)
  view.setUint8(5, message.autopilot)
  view.setUint8(6, message.baseMode)
  view.setUint8(7, message.systemStatus)
  view.setUint8(8, message.mavlinkVersion || MAVLINK_PROTOCOL_VERSION)
  return payload
}

function decodeHeartbeatPayload(payload: Uint8Array): HeartbeatMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'HEARTBEAT',
    customMode: view.getUint32(0, true),
    vehicleType: view.getUint8(4),
    autopilot: view.getUint8(5),
    baseMode: view.getUint8(6),
    systemStatus: view.getUint8(7),
    mavlinkVersion: view.getUint8(8)
  }
}

function encodeSysStatusPayload(message: SysStatusMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.SYS_STATUS])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.sensorsPresent, true)
  view.setUint32(4, message.sensorsEnabled, true)
  view.setUint32(8, message.sensorsHealth, true)
  view.setUint16(12, message.load, true)
  view.setUint16(14, message.voltageBatteryMv, true)
  view.setInt16(16, message.currentBatteryCa, true)
  view.setUint16(18, message.dropRateComm, true)
  view.setUint16(20, message.errorsComm, true)
  view.setUint16(22, message.errorsCount1, true)
  view.setUint16(24, message.errorsCount2, true)
  view.setUint16(26, message.errorsCount3, true)
  view.setUint16(28, message.errorsCount4, true)
  view.setInt8(30, message.batteryRemaining)
  view.setUint32(31, message.sensorsPresentExtended, true)
  view.setUint32(35, message.sensorsEnabledExtended, true)
  view.setUint32(39, message.sensorsHealthExtended, true)
  return payload
}

function encodeAttitudePayload(message: AttitudeMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.ATTITUDE])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.timeBootMs, true)
  view.setFloat32(4, message.rollRad, true)
  view.setFloat32(8, message.pitchRad, true)
  view.setFloat32(12, message.yawRad, true)
  view.setFloat32(16, message.rollSpeedRadS, true)
  view.setFloat32(20, message.pitchSpeedRadS, true)
  view.setFloat32(24, message.yawSpeedRadS, true)
  return payload
}

function encodeGlobalPositionIntPayload(message: GlobalPositionIntMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.timeBootMs, true)
  view.setInt32(4, message.latitudeE7, true)
  view.setInt32(8, message.longitudeE7, true)
  view.setInt32(12, message.altitudeMm, true)
  view.setInt32(16, message.relativeAltitudeMm, true)
  view.setInt16(20, message.velocityXcms, true)
  view.setInt16(22, message.velocityYcms, true)
  view.setInt16(24, message.velocityZcms, true)
  view.setUint16(26, message.headingCdeg, true)
  return payload
}

function decodeAttitudePayload(payload: Uint8Array): AttitudeMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'ATTITUDE',
    timeBootMs: view.getUint32(0, true),
    rollRad: view.getFloat32(4, true),
    pitchRad: view.getFloat32(8, true),
    yawRad: view.getFloat32(12, true),
    rollSpeedRadS: view.getFloat32(16, true),
    pitchSpeedRadS: view.getFloat32(20, true),
    yawSpeedRadS: view.getFloat32(24, true)
  }
}

function decodeSysStatusPayload(payload: Uint8Array): SysStatusMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'SYS_STATUS',
    sensorsPresent: view.getUint32(0, true),
    sensorsEnabled: view.getUint32(4, true),
    sensorsHealth: view.getUint32(8, true),
    load: view.getUint16(12, true),
    voltageBatteryMv: view.getUint16(14, true),
    currentBatteryCa: view.getInt16(16, true),
    dropRateComm: view.getUint16(18, true),
    errorsComm: view.getUint16(20, true),
    errorsCount1: view.getUint16(22, true),
    errorsCount2: view.getUint16(24, true),
    errorsCount3: view.getUint16(26, true),
    errorsCount4: view.getUint16(28, true),
    batteryRemaining: view.getInt8(30),
    sensorsPresentExtended: payload.byteLength >= 35 ? view.getUint32(31, true) : 0,
    sensorsEnabledExtended: payload.byteLength >= 39 ? view.getUint32(35, true) : 0,
    sensorsHealthExtended: payload.byteLength >= 43 ? view.getUint32(39, true) : 0
  }
}

function decodeGlobalPositionIntPayload(payload: Uint8Array): GlobalPositionIntMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'GLOBAL_POSITION_INT',
    timeBootMs: view.getUint32(0, true),
    latitudeE7: view.getInt32(4, true),
    longitudeE7: view.getInt32(8, true),
    altitudeMm: view.getInt32(12, true),
    relativeAltitudeMm: view.getInt32(16, true),
    velocityXcms: view.getInt16(20, true),
    velocityYcms: view.getInt16(22, true),
    velocityZcms: view.getInt16(24, true),
    headingCdeg: view.getUint16(26, true)
  }
}

function encodeParamRequestListPayload(message: ParamRequestListMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST])
  payload[0] = message.targetSystem & 0xff
  payload[1] = message.targetComponent & 0xff
  return payload
}

function decodeParamRequestListPayload(payload: Uint8Array): ParamRequestListMessage {
  return {
    type: 'PARAM_REQUEST_LIST',
    targetSystem: payload[0],
    targetComponent: payload[1]
  }
}

function encodeParamValuePayload(message: ParamValueMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.PARAM_VALUE])
  const view = new DataView(payload.buffer)
  view.setFloat32(0, message.paramValue, true)
  view.setUint16(4, message.paramCount, true)
  view.setUint16(6, message.paramIndex, true)
  payload.set(encodeFixedString(message.paramId, 16), 8)
  view.setUint8(24, message.paramType)
  return payload
}

function decodeParamValuePayload(payload: Uint8Array): ParamValueMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'PARAM_VALUE',
    paramValue: view.getFloat32(0, true),
    paramCount: view.getUint16(4, true),
    paramIndex: view.getUint16(6, true),
    paramId: decodeFixedString(payload.subarray(8, 24)),
    paramType: view.getUint8(24)
  }
}

function encodeParamSetPayload(message: ParamSetMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.PARAM_SET])
  const view = new DataView(payload.buffer)
  view.setFloat32(0, message.paramValue, true)
  view.setUint8(4, message.targetSystem)
  view.setUint8(5, message.targetComponent)
  payload.set(encodeFixedString(message.paramId, 16), 6)
  view.setUint8(22, message.paramType)
  return payload
}

function decodeParamSetPayload(payload: Uint8Array): ParamSetMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'PARAM_SET',
    paramValue: view.getFloat32(0, true),
    targetSystem: view.getUint8(4),
    targetComponent: view.getUint8(5),
    paramId: decodeFixedString(payload.subarray(6, 22)),
    paramType: view.getUint8(22)
  }
}

function encodeRcChannelsPayload(message: RcChannelsMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.RC_CHANNELS])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.timeBootMs, true)

  for (let index = 0; index < 18; index += 1) {
    view.setUint16(4 + index * 2, message.channels[index] ?? 0xffff, true)
  }

  view.setUint8(40, message.channelCount)
  view.setUint8(41, message.rssi)
  return payload
}

function decodeRcChannelsPayload(payload: Uint8Array): RcChannelsMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const channels: number[] = []

  for (let index = 0; index < 18; index += 1) {
    channels.push(view.getUint16(4 + index * 2, true))
  }

  return {
    type: 'RC_CHANNELS',
    timeBootMs: view.getUint32(0, true),
    channelCount: view.getUint8(40),
    channels,
    rssi: view.getUint8(41)
  }
}

function encodeFileTransferProtocolPayload(message: FileTransferProtocolMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL])
  payload[0] = message.targetNetwork & 0xff
  payload[1] = message.targetSystem & 0xff
  payload[2] = message.targetComponent & 0xff
  payload.set(message.payload.slice(0, payload.length - 3), 3)
  return payload
}

function decodeFileTransferProtocolPayload(payload: Uint8Array): FileTransferProtocolMessage {
  return {
    type: 'FILE_TRANSFER_PROTOCOL',
    targetNetwork: payload[0] ?? 0,
    targetSystem: payload[1] ?? 0,
    targetComponent: payload[2] ?? 0,
    payload: payload.slice(3)
  }
}

// LOG_* dataflash-log retrieval messages. Payload byte order below is the
// MAVLink wire order (fields sorted by descending type size, ties keeping
// XML declaration order), matching the convention every encoder/decoder in
// this file already follows.

function encodeLogRequestListPayload(message: LogRequestListMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST])
  const view = new DataView(payload.buffer)
  view.setUint16(0, message.start, true)
  view.setUint16(2, message.end, true)
  view.setUint8(4, message.targetSystem)
  view.setUint8(5, message.targetComponent)
  return payload
}

function decodeLogRequestListPayload(payload: Uint8Array): LogRequestListMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'LOG_REQUEST_LIST',
    start: view.getUint16(0, true),
    end: view.getUint16(2, true),
    targetSystem: view.getUint8(4),
    targetComponent: view.getUint8(5)
  }
}

function encodeLogEntryPayload(message: LogEntryMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_ENTRY])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.timeUtc, true)
  view.setUint32(4, message.size, true)
  view.setUint16(8, message.id, true)
  view.setUint16(10, message.numLogs, true)
  view.setUint16(12, message.lastLogNum, true)
  return payload
}

function decodeLogEntryPayload(payload: Uint8Array): LogEntryMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'LOG_ENTRY',
    timeUtc: view.getUint32(0, true),
    size: view.getUint32(4, true),
    id: view.getUint16(8, true),
    numLogs: view.getUint16(10, true),
    lastLogNum: view.getUint16(12, true)
  }
}

function encodeLogRequestDataPayload(message: LogRequestDataMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.ofs, true)
  view.setUint32(4, message.count, true)
  view.setUint16(8, message.id, true)
  view.setUint8(10, message.targetSystem)
  view.setUint8(11, message.targetComponent)
  return payload
}

function decodeLogRequestDataPayload(payload: Uint8Array): LogRequestDataMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'LOG_REQUEST_DATA',
    ofs: view.getUint32(0, true),
    count: view.getUint32(4, true),
    id: view.getUint16(8, true),
    targetSystem: view.getUint8(10),
    targetComponent: view.getUint8(11)
  }
}

function encodeLogDataPayload(message: LogDataMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_DATA])
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.ofs, true)
  view.setUint16(4, message.id, true)
  view.setUint8(6, message.count)
  payload.set(message.data.slice(0, 90), 7)
  return payload
}

function decodeLogDataPayload(payload: Uint8Array): LogDataMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'LOG_DATA',
    ofs: view.getUint32(0, true),
    id: view.getUint16(4, true),
    count: view.getUint8(6),
    data: payload.slice(7, 97)
  }
}

function encodeLogRequestEndPayload(message: LogRequestEndMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_REQUEST_END])
  payload[0] = message.targetSystem & 0xff
  payload[1] = message.targetComponent & 0xff
  return payload
}

function decodeLogRequestEndPayload(payload: Uint8Array): LogRequestEndMessage {
  return {
    type: 'LOG_REQUEST_END',
    targetSystem: payload[0] ?? 0,
    targetComponent: payload[1] ?? 0
  }
}

// MAG_CAL_* onboard magnetometer-calibration messages. Wire order is the
// MAVLink convention (fields by descending type size, ties keeping XML
// order), matching every other encoder/decoder in this file.

function encodeMagCalProgressPayload(message: MagCalProgressMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS])
  const view = new DataView(payload.buffer)
  view.setFloat32(0, message.directionX, true)
  view.setFloat32(4, message.directionY, true)
  view.setFloat32(8, message.directionZ, true)
  view.setUint8(12, message.compassId)
  view.setUint8(13, message.calMask)
  view.setUint8(14, message.calStatus)
  view.setUint8(15, message.attempt)
  view.setUint8(16, message.completionPct)
  payload.set(message.completionMask.slice(0, 10), 17)
  return payload
}

function decodeMagCalProgressPayload(payload: Uint8Array): MagCalProgressMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'MAG_CAL_PROGRESS',
    directionX: view.getFloat32(0, true),
    directionY: view.getFloat32(4, true),
    directionZ: view.getFloat32(8, true),
    compassId: view.getUint8(12),
    calMask: view.getUint8(13),
    calStatus: view.getUint8(14),
    attempt: view.getUint8(15),
    completionPct: view.getUint8(16),
    completionMask: payload.slice(17, 27)
  }
}

function encodeMagCalReportPayload(message: MagCalReportMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT])
  const view = new DataView(payload.buffer)
  view.setFloat32(0, message.fitness, true)
  view.setFloat32(4, message.ofsX, true)
  view.setFloat32(8, message.ofsY, true)
  view.setFloat32(12, message.ofsZ, true)
  view.setFloat32(16, message.diagX, true)
  view.setFloat32(20, message.diagY, true)
  view.setFloat32(24, message.diagZ, true)
  view.setFloat32(28, message.offdiagX, true)
  view.setFloat32(32, message.offdiagY, true)
  view.setFloat32(36, message.offdiagZ, true)
  view.setUint8(40, message.compassId)
  view.setUint8(41, message.calMask)
  view.setUint8(42, message.calStatus)
  view.setUint8(43, message.autosaved)
  // Extension fields (declaration order, not size-reordered).
  view.setFloat32(44, message.orientationConfidence, true)
  view.setUint8(48, message.oldOrientation)
  view.setUint8(49, message.newOrientation)
  view.setFloat32(50, message.scaleFactor, true)
  return payload
}

function decodeMagCalReportPayload(payload: Uint8Array): MagCalReportMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const length = payload.byteLength
  return {
    type: 'MAG_CAL_REPORT',
    fitness: view.getFloat32(0, true),
    ofsX: view.getFloat32(4, true),
    ofsY: view.getFloat32(8, true),
    ofsZ: view.getFloat32(12, true),
    diagX: view.getFloat32(16, true),
    diagY: view.getFloat32(20, true),
    diagZ: view.getFloat32(24, true),
    offdiagX: view.getFloat32(28, true),
    offdiagY: view.getFloat32(32, true),
    offdiagZ: view.getFloat32(36, true),
    compassId: view.getUint8(40),
    calMask: view.getUint8(41),
    calStatus: view.getUint8(42),
    autosaved: view.getUint8(43),
    // Extensions are omitted by older autopilots / v1 frames — default 0.
    orientationConfidence: length >= 48 ? view.getFloat32(44, true) : 0,
    oldOrientation: length >= 49 ? view.getUint8(48) : 0,
    newOrientation: length >= 50 ? view.getUint8(49) : 0,
    scaleFactor: length >= 54 ? view.getFloat32(50, true) : 0
  }
}

function encodeCommandAckPayload(message: CommandAckMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.COMMAND_ACK])
  const view = new DataView(payload.buffer)
  view.setUint16(0, message.command, true)
  view.setUint8(2, message.result)
  view.setUint8(3, message.progress)
  view.setInt32(4, message.resultParam2, true)
  view.setUint8(8, message.targetSystem)
  view.setUint8(9, message.targetComponent)
  return payload
}

function decodeCommandAckPayload(payload: Uint8Array): CommandAckMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'COMMAND_ACK',
    command: view.getUint16(0, true),
    result: view.getUint8(2),
    progress: payload.byteLength >= 4 ? view.getUint8(3) : 0,
    resultParam2: payload.byteLength >= 8 ? view.getInt32(4, true) : 0,
    targetSystem: payload.byteLength >= 9 ? view.getUint8(8) : 0,
    targetComponent: payload.byteLength >= 10 ? view.getUint8(9) : 0
  }
}

function encodeCommandLongPayload(message: CommandLongMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.COMMAND_LONG])
  const view = new DataView(payload.buffer)
  message.params.forEach((value, index) => {
    view.setFloat32(index * 4, value, true)
  })
  view.setUint16(28, message.command, true)
  view.setUint8(30, message.targetSystem)
  view.setUint8(31, message.targetComponent)
  view.setUint8(32, message.confirmation)
  return payload
}

function encodeGpsInputPayload(message: GpsInputMessage): Uint8Array {
  // MAVLink field reordering (largest type first, declaration order within a
  // size); the yaw extension is omitted. Velocity + accuracy fields are left
  // zero and flagged via ignoreFlags by the caller.
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.GPS_INPUT])
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, 0n, true)               // time_usec (0 = autopilot timestamps)
  view.setUint32(8, 0, true)                   // time_week_ms
  view.setInt32(12, message.latitudeE7, true)  // lat (degE7)
  view.setInt32(16, message.longitudeE7, true) // lon (degE7)
  view.setFloat32(20, message.altitudeM, true) // alt (m, MSL)
  view.setFloat32(24, message.hdop, true)
  view.setFloat32(28, message.vdop, true)
  view.setFloat32(32, 0, true)                 // vn
  view.setFloat32(36, 0, true)                 // ve
  view.setFloat32(40, 0, true)                 // vd
  view.setFloat32(44, 0, true)                 // speed_accuracy
  view.setFloat32(48, 5, true)                 // horiz_accuracy (m)
  view.setFloat32(52, 5, true)                 // vert_accuracy (m)
  view.setUint16(56, message.ignoreFlags, true)
  view.setUint16(58, 0, true)                  // time_week
  view.setUint8(60, message.gpsId)
  view.setUint8(61, message.fixType)
  view.setUint8(62, message.satellitesVisible)
  return payload
}

function decodeCommandLongPayload(payload: Uint8Array): CommandLongMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'COMMAND_LONG',
    params: [
      view.getFloat32(0, true),
      view.getFloat32(4, true),
      view.getFloat32(8, true),
      view.getFloat32(12, true),
      view.getFloat32(16, true),
      view.getFloat32(20, true),
      view.getFloat32(24, true)
    ],
    command: view.getUint16(28, true),
    targetSystem: view.getUint8(30),
    targetComponent: view.getUint8(31),
    confirmation: view.getUint8(32)
  }
}

function encodeAutopilotVersionPayload(message: AutopilotVersionMessage): Uint8Array {
  const maxPayloadLength = MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION]
  const hasUid2 = message.uid2 !== undefined && message.uid2.some((byte) => byte !== 0)
  const payload = new Uint8Array(hasUid2 ? maxPayloadLength : MAVLINK_MIN_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION])
  const view = new DataView(payload.buffer)
  // Wire layout per c_library_v2 mavlink_msg_autopilot_version.h —
  // MAVLink sorts fields by base-type size and u8[] arrays sort by
  // ELEMENT size (1), so vendor_id/product_id (u16) precede the three
  // u8[8] custom-version arrays: vendor_id@32, product_id@34,
  // flight/middleware/os custom versions @36/44/52, uid2 (ext) @60.
  view.setBigUint64(0, message.capabilities, true)
  view.setBigUint64(8, message.uid, true)
  view.setUint32(16, message.flightSwVersion, true)
  view.setUint32(20, message.middlewareSwVersion, true)
  view.setUint32(24, message.osSwVersion, true)
  view.setUint32(28, message.boardVersion, true)
  view.setUint16(32, message.vendorId, true)
  view.setUint16(34, message.productId, true)
  payload.set(copyFixedBytes(message.flightCustomVersion, 8), 36)
  payload.set(copyFixedBytes(message.middlewareCustomVersion, 8), 44)
  payload.set(copyFixedBytes(message.osCustomVersion, 8), 52)
  if (hasUid2) {
    payload.set(copyFixedBytes(message.uid2 as Uint8Array, 18), 60)
  }
  return payload
}

function decodeAutopilotVersionPayload(payload: Uint8Array): AutopilotVersionMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'AUTOPILOT_VERSION',
    capabilities: view.getBigUint64(0, true),
    uid: view.getBigUint64(8, true),
    flightSwVersion: view.getUint32(16, true),
    middlewareSwVersion: view.getUint32(20, true),
    osSwVersion: view.getUint32(24, true),
    boardVersion: view.getUint32(28, true),
    vendorId: view.getUint16(32, true),
    productId: view.getUint16(34, true),
    flightCustomVersion: payload.slice(36, 44),
    middlewareCustomVersion: payload.slice(44, 52),
    osCustomVersion: payload.slice(52, 60),
    uid2: payload.byteLength >= 78 ? payload.slice(60, 78) : undefined
  }
}

function encodeStatusTextPayload(message: StatusTextMessage): Uint8Array {
  const payload = new Uint8Array(MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.STATUSTEXT])
  const view = new DataView(payload.buffer)
  view.setUint8(0, message.severity)
  payload.set(encodeFixedString(message.text, 50), 1)
  view.setUint16(51, message.statusId, true)
  view.setUint8(53, message.chunkSequence)
  return payload
}

// CAN_FRAME (msgid 386). Wire layout per c_library_v2's
// mavlink_msg_can_frame.h: id (u32) at 0, target_system (u8) at 4,
// target_component (u8) at 5, bus (u8) at 6, len (u8) at 7, data[8]
// at 8..15. Total 16 bytes. CRC_EXTRA = 132.
function encodeCanFramePayload(message: CanFrameMessage): Uint8Array {
  const payload = new Uint8Array(16)
  const view = new DataView(payload.buffer)
  view.setUint32(0, message.id, true)
  view.setUint8(4, message.targetSystem)
  view.setUint8(5, message.targetComponent)
  view.setUint8(6, message.bus)
  view.setUint8(7, message.len)
  payload.set(copyFixedBytes(message.data, 8), 8)
  return payload
}

function decodeCanFramePayload(payload: Uint8Array): CanFrameMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'CAN_FRAME',
    id: view.getUint32(0, true),
    targetSystem: view.getUint8(4),
    targetComponent: view.getUint8(5),
    bus: view.getUint8(6),
    len: view.getUint8(7),
    data: payload.slice(8, 16)
  }
}

// OPTICAL_FLOW (msgid 100). Wire layout per c_library_v2's
// mavlink_msg_optical_flow.h: time_usec, flow_comp_m_x/y, ground_distance,
// flow_x/y, sensor_id, quality, then two extension floats (flow_rate_x/y)
// that older senders omit. The decoder zero-fills the extension if the
// truncated payload doesn't include them.
function encodeOpticalFlowPayload(message: OpticalFlowMessage): Uint8Array {
  const payload = new Uint8Array(34)
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, message.timeUsec, true)
  view.setFloat32(8, message.flowCompMx, true)
  view.setFloat32(12, message.flowCompMy, true)
  view.setFloat32(16, message.groundDistance, true)
  view.setInt16(20, message.flowX, true)
  view.setInt16(22, message.flowY, true)
  view.setUint8(24, message.sensorId)
  view.setUint8(25, message.quality)
  view.setFloat32(26, message.flowRateX, true)
  view.setFloat32(30, message.flowRateY, true)
  return payload
}

function decodeOpticalFlowPayload(payload: Uint8Array): OpticalFlowMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'OPTICAL_FLOW',
    timeUsec: view.getBigUint64(0, true),
    flowCompMx: view.getFloat32(8, true),
    flowCompMy: view.getFloat32(12, true),
    groundDistance: view.getFloat32(16, true),
    flowX: view.getInt16(20, true),
    flowY: view.getInt16(22, true),
    sensorId: view.getUint8(24),
    quality: view.getUint8(25),
    flowRateX: payload.byteLength >= 30 ? view.getFloat32(26, true) : 0,
    flowRateY: payload.byteLength >= 34 ? view.getFloat32(30, true) : 0
  }
}

function decodeStatusTextPayload(payload: Uint8Array): StatusTextMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'STATUSTEXT',
    severity: view.getUint8(0),
    text: decodeFixedString(payload.subarray(1, 51)),
    statusId: payload.byteLength >= 53 ? view.getUint16(51, true) : 0,
    chunkSequence: payload.byteLength >= 54 ? view.getUint8(53) : 0
  }
}

// UAVCAN_NODE_STATUS / UAVCAN_NODE_INFO: in production the configurator
// only decodes these (the autopilot's MAVLink-UAVCAN bridge originates
// them). Encoders are kept symmetric so tests and recorded replay
// scenarios can synthesise nodes without round-tripping through SITL.
// Wire layout matches MAVLink's reorder-by-size, cross-checked against
// c_library_v2's mavlink_msg_uavcan_node_status.h /
// mavlink_msg_uavcan_node_info.h generated offsets.
function encodeUavcanNodeStatusPayload(message: UavcanNodeStatusMessage): Uint8Array {
  const payload = new Uint8Array(17)
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, message.timeUsec, true)
  view.setUint32(8, message.uptimeSec, true)
  view.setUint16(12, message.vendorSpecificStatusCode, true)
  view.setUint8(14, message.health)
  view.setUint8(15, message.mode)
  view.setUint8(16, message.subMode)
  return payload
}

function encodeUavcanNodeInfoPayload(message: UavcanNodeInfoMessage): Uint8Array {
  const payload = new Uint8Array(116)
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, message.timeUsec, true)
  view.setUint32(8, message.uptimeSec, true)
  view.setUint32(12, message.swVcsCommit, true)
  payload.set(encodeFixedString(message.name, 80), 16)
  view.setUint8(96, message.hwVersionMajor)
  view.setUint8(97, message.hwVersionMinor)
  payload.set(copyFixedBytes(message.hwUniqueId, 16), 98)
  view.setUint8(114, message.swVersionMajor)
  view.setUint8(115, message.swVersionMinor)
  return payload
}

function decodeUavcanNodeStatusPayload(payload: Uint8Array): UavcanNodeStatusMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'UAVCAN_NODE_STATUS',
    timeUsec: view.getBigUint64(0, true),
    uptimeSec: view.getUint32(8, true),
    vendorSpecificStatusCode: view.getUint16(12, true),
    health: view.getUint8(14),
    mode: view.getUint8(15),
    subMode: view.getUint8(16)
  }
}

function decodeUavcanNodeInfoPayload(payload: Uint8Array): UavcanNodeInfoMessage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    type: 'UAVCAN_NODE_INFO',
    timeUsec: view.getBigUint64(0, true),
    uptimeSec: view.getUint32(8, true),
    swVcsCommit: view.getUint32(12, true),
    name: decodeFixedString(payload.subarray(16, 96)),
    hwVersionMajor: view.getUint8(96),
    hwVersionMinor: view.getUint8(97),
    hwUniqueId: payload.slice(98, 114),
    swVersionMajor: view.getUint8(114),
    swVersionMinor: view.getUint8(115)
  }
}

function encodeFixedString(value: string, size: number): Uint8Array {
  const encoded = textEncoder.encode(value)
  const bytes = new Uint8Array(size)
  bytes.set(encoded.slice(0, size))
  return bytes
}

function decodeFixedString(bytes: Uint8Array): string {
  const zeroIndex = bytes.indexOf(0)
  const effective = zeroIndex === -1 ? bytes : bytes.subarray(0, zeroIndex)
  return textDecoder.decode(effective)
}

function copyFixedBytes(value: Uint8Array, size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(value.slice(0, size))
  return bytes
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) {
    return right
  }
  if (right.length === 0) {
    return left
  }
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left, 0)
  combined.set(right, left.length)
  return combined
}

function crcMessage(bytes: Uint8Array, crcExtra: number): number {
  let checksum = 0xffff
  for (const byte of bytes) {
    checksum = crcAccumulate(byte, checksum)
  }
  checksum = crcAccumulate(crcExtra, checksum)
  return checksum
}

function crcAccumulate(byte: number, checksum: number): number {
  let tmp = byte ^ (checksum & 0xff)
  tmp ^= (tmp << 4) & 0xff
  return (
    ((checksum >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
  )
}
