// Side-by-side identity of the installed bootloader and the one an "Update
// Bootloader" is about to write, shown before the operator commits.
//
// Pure builder (the established view-models pattern) so the interesting part —
// deciding what may honestly be claimed when one side, or both, could not be
// read — is unit-testable without a vehicle.
//
// The rule this file exists to enforce: a verdict is only ever stated when
// BOTH digests are in hand. A missing installed image means "unknown", never
// "different" and never "same". Getting that wrong on a bootloader flash would
// be worse than showing nothing at all.

import type { BootloaderImageIdentity } from '@arduconfig/firmware-flash'

export type BootloaderHashPreviewStatus = 'idle' | 'loading' | 'ready'

export interface BootloaderHashPreviewInput {
  status: BootloaderHashPreviewStatus
  /** Digest of the image the firmware would flash (`@ROMFS/bootloader.bin`). */
  embedded?: BootloaderImageIdentity
  /** Why the incoming image is unavailable. */
  embeddedError?: string
  /** Digest of the bytes currently in the bootloader region. */
  installed?: BootloaderImageIdentity
  /** Why the installed image is unavailable. */
  installedError?: string
}

export interface BootloaderHashPreviewRow {
  label: string
  /** 12-hex short form, or a reason when the side could not be read. */
  value: string
  /** Full digest for the title attribute; undefined when there is no digest. */
  full?: string
  /** `48,128 bytes`, or undefined when unread. */
  size?: string
  /** True when `value` is an explanation rather than a digest. */
  unavailable: boolean
}

export type BootloaderHashVerdict = 'same' | 'different' | 'unknown'

export interface BootloaderHashPreview {
  /** One line stating what is known, suitable as the block's heading. */
  headline: string
  rows: BootloaderHashPreviewRow[]
  verdict: BootloaderHashVerdict
  /**
   * What the verdict means for this flash. Always present — an operator who
   * cannot be told whether the bootloader will change still needs to be told
   * that that is the situation.
   */
  detail: string
}

/** 12 hex characters is enough to compare by eye; the full value stays on hover. */
function shortDigest(identity: BootloaderImageIdentity): string {
  return identity.sha256.slice(0, 12)
}

function formatSize(identity: BootloaderImageIdentity): string {
  return `${identity.byteLength.toLocaleString('en-US')} bytes`
}

function buildRow(
  label: string,
  identity: BootloaderImageIdentity | undefined,
  error: string | undefined,
  status: BootloaderHashPreviewStatus
): BootloaderHashPreviewRow {
  if (identity) {
    return {
      label,
      value: shortDigest(identity),
      full: identity.sha256,
      size: formatSize(identity),
      unavailable: false
    }
  }
  return {
    label,
    // A read still in flight is not a failure; saying so avoids flashing a
    // scary "unavailable" for the second or two the read takes.
    value: error ?? (status === 'ready' ? 'Not available' : 'Reading…'),
    unavailable: true
  }
}

export function buildBootloaderHashPreview(
  input: BootloaderHashPreviewInput
): BootloaderHashPreview {
  const rows = [
    buildRow('Installed now', input.installed, input.installedError, input.status),
    buildRow('Will be written', input.embedded, input.embeddedError, input.status)
  ]

  if (input.status !== 'ready') {
    return {
      headline: 'Reading bootloader images from the vehicle…',
      rows,
      verdict: 'unknown',
      detail: 'SHA-256 of both images, read over MAVFTP.'
    }
  }

  // Both digests present is the ONLY state in which a verdict may be stated.
  if (input.embedded && input.installed) {
    const same = input.embedded.sha256 === input.installed.sha256
    return {
      headline: same
        ? 'Bootloader already up to date'
        : 'The bootloader will change',
      rows,
      verdict: same ? 'same' : 'different',
      detail: same
        ? 'The installed bootloader is byte-identical to the one this firmware carries, so an update would rewrite the same image (the firmware reports this as a success and skips the write).'
        : 'The installed bootloader differs from the one this firmware carries. Updating replaces it.'
    }
  }

  if (input.embedded) {
    return {
      headline: 'Incoming bootloader only — the installed one could not be read',
      rows,
      verdict: 'unknown',
      detail:
        'The image that would be written is shown above. The bootloader currently on the board could not be read, so there is no way to tell here whether this update changes anything.'
    }
  }

  return {
    headline: 'Bootloader images unavailable',
    rows,
    verdict: 'unknown',
    detail:
      'Neither image could be read over MAVFTP, so neither can be identified. This does not block the update — the firmware still flashes the bootloader it was built with.'
  }
}
