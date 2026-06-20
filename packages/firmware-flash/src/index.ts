export { arduPilotCrc32, firmwareCrc } from './crc.js'
export {
  parseApj,
  decodeApjImage,
  decodeApjExtfImage,
  padTo4,
  MAX_FIRMWARE_IMAGE_BYTES,
  type ParsedApj,
  type Inflate
} from './apj.js'
export { checkBoardMatch, checkImageFitsFlash, type BoardMatchResult } from './board-guard.js'
export { BOARD_NAMES_BY_ID, formatBoardId } from './board-names.js'
export {
  BootloaderClient,
  chipEraseTimeoutMs,
  type BootloaderSerial,
  type BoardIdentity,
  type FlashPhase,
  type FlashProgress
} from './bootloader.js'
export {
  parseManifest,
  fetchManifest,
  firmwaresForBoard,
  availableReleaseTypes,
  selectFirmware,
  type FirmwareManifest,
  type FirmwareEntry,
  type FirmwareQuery,
  type VehicleType,
  type ReleaseType,
  type ManifestFetcher
} from './manifest.js'
