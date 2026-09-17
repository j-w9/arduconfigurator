// Decoders for the MSP replies this app reads.
//
// Payload layouts are Betaflight's. Where a field is variable-length the length
// byte precedes it, which is why these are read sequentially rather than at
// fixed offsets.

export interface MspApiVersion {
  protocolVersion: number
  apiMajor: number
  apiMinor: number
}

export interface MspBoardInfo {
  /** 4-char board identifier, e.g. "S405". */
  boardIdentifier: string
  hardwareRevision: number
  /** Target MCU name, e.g. "STM32F405". */
  targetName?: string
  /** Board name, e.g. "OMNIBUSF4". */
  boardName?: string
  /** Manufacturer id, e.g. "AIRB". */
  manufacturerId?: string
}

export interface MspSerialPortConfig {
  identifier: number
  functionMask: number
  mspBaudIndex: number
  gpsBaudIndex: number
  telemetryBaudIndex: number
  blackboxBaudIndex: number
}

function ascii(bytes: Uint8Array): string {
  // Trim trailing NULs: Betaflight pads fixed-width name fields with them.
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1
  }
  return String.fromCharCode(...bytes.subarray(0, end))
}

export function decodeApiVersion(payload: Uint8Array): MspApiVersion | undefined {
  if (payload.length < 3) return undefined
  return { protocolVersion: payload[0], apiMajor: payload[1], apiMinor: payload[2] }
}

/** MSP_FC_VARIANT: exactly 4 ASCII characters. "BTFL" is Betaflight. */
export function decodeFcVariant(payload: Uint8Array): string | undefined {
  return payload.length >= 4 ? ascii(payload.subarray(0, 4)) : undefined
}

export function decodeFcVersion(payload: Uint8Array): string | undefined {
  return payload.length >= 3 ? `${payload[0]}.${payload[1]}.${payload[2]}` : undefined
}

/**
 * MSP_BOARD_INFO.
 *
 * Verified byte-for-byte against a captured frame in ExpressLRS's own test
 * suite (test_msp2crsf2msp.cpp), which decodes to board "S405", target
 * "STM32F405", board name "OMNIBUSF4", manufacturer "AIRB".
 *
 * The tail (target/board/manufacturer names, signature) was added over
 * successive API versions, so everything past the hardware revision is optional
 * and absence is not an error.
 */
export function decodeBoardInfo(payload: Uint8Array): MspBoardInfo | undefined {
  if (payload.length < 6) return undefined
  const info: MspBoardInfo = {
    boardIdentifier: ascii(payload.subarray(0, 4)),
    hardwareRevision: payload[4] | (payload[5] << 8)
  }

  // Older firmware stops here. Newer adds: type, capabilities, then three
  // length-prefixed strings.
  let cursor = 8
  const readPrefixed = (): string | undefined => {
    if (cursor >= payload.length) return undefined
    const length = payload[cursor]
    cursor += 1
    if (length === 0 || cursor + length > payload.length) return undefined
    const value = ascii(payload.subarray(cursor, cursor + length))
    cursor += length
    return value
  }

  info.targetName = readPrefixed()
  info.boardName = readPrefixed()
  info.manufacturerId = readPrefixed()
  return info
}

/**
 * MSP_CF_SERIAL_CONFIG: repeating 8-byte records, one per UART.
 *
 * identifier(1) functionMask(2) mspBaud(1) gpsBaud(1) telemetryBaud(1)
 * blackboxBaud(1) — plus one trailing byte per record in the layout Betaflight
 * writes. Records are read while a whole one remains, so a firmware that adds
 * fields yields fewer ports rather than garbage.
 */
export function decodeSerialConfig(payload: Uint8Array): MspSerialPortConfig[] {
  const RECORD = 7
  const ports: MspSerialPortConfig[] = []
  for (let offset = 0; offset + RECORD <= payload.length; offset += RECORD) {
    ports.push({
      identifier: payload[offset],
      functionMask: payload[offset + 1] | (payload[offset + 2] << 8),
      mspBaudIndex: payload[offset + 3],
      gpsBaudIndex: payload[offset + 4],
      telemetryBaudIndex: payload[offset + 5],
      blackboxBaudIndex: payload[offset + 6]
    })
  }
  return ports
}
