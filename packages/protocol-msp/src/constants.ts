// MSP command ids and enums.
//
// Every value here is quoted from Betaflight's own source rather than recalled:
// src/main/msp/msp_protocol.h for the command ids, src/main/msp/msp.c for the
// reboot modes. Getting one wrong is not a cosmetic bug — MSP has no
// per-command handshake, so an FC receiving an unexpected id acts on whatever
// that id actually means on its build.

/** Commands this app sends. Betaflight msp_protocol.h. */
export const MSP_COMMANDS = {
  /** `#define MSP_API_VERSION 1` — protocol + API major/minor. */
  API_VERSION: 1,
  /** `#define MSP_FC_VARIANT 2` — 4 ASCII chars, "BTFL" / "INAV" / "ARDU". */
  FC_VARIANT: 2,
  /** `#define MSP_FC_VERSION 3` — major, minor, patch. */
  FC_VERSION: 3,
  /** `#define MSP_BOARD_INFO 4` — board id, target, board and manufacturer names. */
  BOARD_INFO: 4,
  /** `#define MSP_BUILD_INFO 5` — build date, time, git revision. */
  BUILD_INFO: 5,
  /** `#define MSP_CF_SERIAL_CONFIG 54` — one record per UART. */
  CF_SERIAL_CONFIG: 54,
  /**
   * `#define MSP_REBOOT 68`.
   *
   * NOT "MSP_SET_REBOOT" — that name does not exist in Betaflight. With a
   * payload byte it selects a reboot mode; with none it reboots to firmware.
   */
  REBOOT: 68,
  /** `#define MSP_UID 160` — the MCU's unique id. */
  UID: 160,
  /**
   * `#define MSP_SET_PASSTHROUGH 245`.
   *
   * Hands the serial link to a sub-device and stops interpreting MSP on it.
   * With no payload Betaflight defaults to the ESC 4-way interface, and its
   * reply carries ONE byte: the number of ESC outputs it will bridge to
   * (src/main/msp/msp.c, `mspProcessInCommand` MSP_SET_PASSTHROUGH →
   * `esc4wayInit()`, whose return value is that count).
   *
   * After the reply the port is NOT speaking MSP any more, so whatever drives
   * the sub-device must own the raw bytes. Do not leave an MSP decoder
   * subscribed to the link across this call.
   */
  SET_PASSTHROUGH: 245
} as const

/**
 * MSP_REBOOT payload, from the anonymous enum in msp.c.
 *
 * BOOTLOADER_ROM is the STM32 ROM DFU device — the "software DFU" route a
 * Betaflight user knows, and the one that hands the board to a DFU flasher.
 * The FC echoes the mode back in its reply before it actually reboots, so a
 * reply is confirmation the command was understood, not that it has rebooted.
 */
export const MSP_REBOOT_MODES = {
  FIRMWARE: 0,
  BOOTLOADER_ROM: 1,
  MSC: 2,
  MSC_UTC: 3,
  BOOTLOADER_FLASH: 4
} as const

/** `$M` v1 framing. v2 is `$X` with a crc8-dvb-s2 and is not needed here. */
export const MSP_V1_MAGIC = [0x24, 0x4d] as const // '$', 'M'

/** Direction characters, msp_serial.c: request, response, error response. */
export const MSP_DIRECTION = {
  REQUEST: 0x3c, // '<'
  RESPONSE: 0x3e, // '>'
  ERROR: 0x21 // '!'
} as const

/** MSP v1 caps the payload length at one byte. */
export const MSP_V1_MAX_PAYLOAD = 255
