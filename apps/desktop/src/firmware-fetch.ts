// Main-process firmware fetch for the desktop app. The browser can't reach
// firmware.ardupilot.org (no CORS headers, ~64MB uncompressed manifest), but
// the Electron main process can fetch it directly. We fetch + parse + filter
// here and hand the renderer a small, board-specific list — never the raw
// blob.
//
// audit-29: switched from manifest.json (~64 MiB uncompressed) to
// manifest.json.gz (~6 MiB on the wire) and added a Node zlib gunzip step.
// Mission Planner (APFirmware.cs:104) and QGroundControl
// (FirmwareUpgradeController.cc:706) both fetch the gzipped URL.
import { gunzipSync } from 'node:zlib'
import {
  parseManifest,
  firmwaresForBoard,
  availableReleaseTypes,
  type FirmwareEntry,
  type FirmwareManifest,
  type VehicleType
} from '@arduconfig/firmware-flash'

const MANIFEST_URL = 'https://firmware.ardupilot.org/manifest.json.gz'
const ALLOWED_HOST = 'firmware.ardupilot.org'
const CACHE_MS = 60 * 60 * 1000
// Upper bound for a downloaded .apj. Real images are a few MB; this guards
// the main-process buffer against an over-large or unbounded response.
const MAX_FIRMWARE_DOWNLOAD_BYTES = 64 * 1024 * 1024

interface FetchResponseLike {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}
export type FetchLike = (url: string) => Promise<FetchResponseLike>

let cache: { manifest: FirmwareManifest; at: number } | undefined

/** Fetch + gunzip + parse the ArduPilot manifest, cached for an hour
 *  (the gzipped wire form is ~6 MiB; the inflated JSON ~64 MiB). */
export async function loadFirmwareManifest(
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<FirmwareManifest> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.manifest
  }
  const response = await fetchImpl(MANIFEST_URL)
  if (!response.ok) {
    throw new Error(`Firmware manifest fetch failed (HTTP ${response.status}).`)
  }
  // The .gz URL serves a gzip-encoded body as content-octet-stream, NOT
  // an HTTP Content-Encoding: gzip wrapper, so fetch() will not transparently
  // decode it — we must gunzip ourselves. Going via arrayBuffer keeps the
  // byte sequence intact (text() would re-interpret the binary payload as
  // UTF-8 and mangle it).
  const gzipped = new Uint8Array(await response.arrayBuffer())
  const inflated = gunzipSync(gzipped)
  const manifest = parseManifest(inflated.toString('utf-8'))
  cache = { manifest, at: Date.now() }
  return manifest
}

export interface FirmwareListResult {
  releaseTypes: string[]
  entries: FirmwareEntry[]
}

/** Board-specific firmware list (+ available release types) for the picker. */
export async function listBoardFirmware(
  boardId: number,
  vehicletype?: VehicleType,
  fetchImpl?: FetchLike
): Promise<FirmwareListResult> {
  const manifest = await loadFirmwareManifest(fetchImpl)
  return {
    releaseTypes: availableReleaseTypes(manifest, boardId, vehicletype),
    entries: firmwaresForBoard(manifest, boardId, vehicletype)
  }
}

/** Download a .apj. Restricted to https firmware.ardupilot.org so the IPC
 *  bridge can't be coerced into fetching arbitrary URLs. */
export async function downloadFirmwareApj(
  url: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<Uint8Array> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) {
    throw new Error(`Refusing firmware download from ${parsed.protocol}//${parsed.hostname} — only https://${ALLOWED_HOST} is allowed.`)
  }
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Firmware download failed (HTTP ${response.status}).`)
  }
  // Cap the download before buffering the whole body in the main process.
  // A real .apj is a few MB; reject an over-large (or unbounded) response
  // up front rather than after marshalling it across IPC.
  const declaredLength = Number(response.headers?.get?.('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FIRMWARE_DOWNLOAD_BYTES) {
    throw new Error(`Firmware download is too large (${declaredLength} bytes; cap ${MAX_FIRMWARE_DOWNLOAD_BYTES}).`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_FIRMWARE_DOWNLOAD_BYTES) {
    throw new Error(`Firmware download is too large (${bytes.length} bytes; cap ${MAX_FIRMWARE_DOWNLOAD_BYTES}).`)
  }
  return bytes
}

/** Test hook — clears the in-memory manifest cache. */
export function resetFirmwareManifestCache(): void {
  cache = undefined
}
