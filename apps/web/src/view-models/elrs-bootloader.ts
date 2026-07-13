// Byte sequences that put a running ExpressLRS receiver into its ESP ROM
// bootloader over the (now transparent) CRSF UART, mirroring ExpressLRS's
// BFinitPassthrough / bootloader.get_init_seq. Once the FC's SERIAL_PASS bridge
// is open and the port reopened at the flashing baud, sending the CRSF command
// below makes the RX firmware jump to the ROM bootloader; esptool then syncs.
//
// Verified against ExpressLRS src/python/bootloader.py:
//   INIT_SEQ = [0xEC, 0x04, 0x32, ord('b'), ord('l')]
//   get_init_seq() = get_telemetry_seq(INIT_SEQ, key) — sets payload length at
//   [1], appends the optional key, then a CRC8 (poly 0xD5) over bytes[2:].

/** CRSF sync/address byte for the receiver. */
const CRSF_RX_ADDRESS = 0xec
/** CRSF frame type "command". */
const CRSF_FRAMETYPE_COMMAND = 0x32
/** The "bl" (bootloader) command payload. */
const BOOTLOADER_COMMAND = [0x62, 0x6c] // 'b', 'l'

/**
 * CRSF's CRC8 (DVB-S2, polynomial 0xD5, init 0x00) over `data`. This is the
 * checksum ExpressLRS/CRSF appends to every frame.
 */
export function crsfCrc8(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff
    }
  }
  return crc
}

/**
 * The CRSF "enter bootloader" command frame. Chip-agnostic (same for
 * ESP8266/8285/ESP32). `key` is the optional bind-derived key bytes for a bound
 * receiver — omit for an unbound/default RX. Frame layout:
 *   [0xEC][len][0x32]['b']['l'][...key][crc8]
 * where len counts the type byte through the CRC, and crc8 covers bytes[2:].
 */
export function buildElrsBootloaderCommand(key: Uint8Array = new Uint8Array(0)): Uint8Array {
  const payload = [CRSF_FRAMETYPE_COMMAND, ...BOOTLOADER_COMMAND, ...key]
  const length = payload.length + 1 // payload (incl. type) + the CRC byte
  const crc = crsfCrc8(Uint8Array.from(payload))
  return Uint8Array.from([CRSF_RX_ADDRESS, length, ...payload, crc])
}

/**
 * The ESP ROM bootloader auto-baud training sequence esptool prefixes to its
 * sync: 0x07 0x07 0x12 0x20 then 32×0x55. Sent right after the bootloader jump
 * so the ROM locks onto the flashing baud.
 */
export function espSyncTraining(): Uint8Array {
  return Uint8Array.from([0x07, 0x07, 0x12, 0x20, ...new Array(32).fill(0x55)])
}
