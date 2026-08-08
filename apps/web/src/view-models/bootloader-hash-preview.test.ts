import { describe, expect, it } from 'vitest'

import { buildBootloaderHashPreview } from './bootloader-hash-preview'

const INSTALLED = {
  byteLength: 48128,
  sha256: 'aa'.repeat(32)
}
const INCOMING = {
  byteLength: 48128,
  sha256: 'bb'.repeat(32)
}

describe('buildBootloaderHashPreview', () => {
  it('calls the update a change when the two digests differ', () => {
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      installed: INSTALLED,
      embedded: INCOMING
    })

    expect(preview.verdict).toBe('different')
    expect(preview.headline).toBe('The bootloader will change')
    expect(preview.rows.map((row) => row.value)).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
    expect(preview.rows.every((row) => row.unavailable)).toBe(false)
  })

  it('reports an already-current bootloader when the digests match', () => {
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      installed: INSTALLED,
      embedded: { ...INSTALLED }
    })

    expect(preview.verdict).toBe('same')
    expect(preview.headline).toBe('Bootloader already up to date')
  })

  it('keeps the full digest available alongside the short form', () => {
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      installed: INSTALLED,
      embedded: INCOMING
    })

    expect(preview.rows[0]?.full).toBe(INSTALLED.sha256)
    expect(preview.rows[0]?.value).toHaveLength(12)
    expect(preview.rows[0]?.size).toBe('48,128 bytes')
  })

  // The whole point of the builder: never let a missing side become a claim.
  it('refuses to state a verdict when only the incoming image was readable', () => {
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      embedded: INCOMING,
      installedError: 'This firmware does not expose the file over MAVFTP.'
    })

    expect(preview.verdict).toBe('unknown')
    expect(preview.headline).toContain('could not be read')
    expect(preview.rows[0]).toMatchObject({
      unavailable: true,
      value: 'This firmware does not expose the file over MAVFTP.'
    })
    expect(preview.rows[0]?.full).toBeUndefined()
  })

  it('says nothing is identifiable when neither image was readable', () => {
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      embeddedError: 'This firmware does not expose the file over MAVFTP.',
      installedError: 'This firmware does not expose the file over MAVFTP.'
    })

    expect(preview.verdict).toBe('unknown')
    expect(preview.headline).toBe('Bootloader images unavailable')
    // It must be clear this does not stop the operator flashing.
    expect(preview.detail).toContain('does not block the update')
  })

  it('falls back to a plain "Not available" when a side failed without a reason', () => {
    const preview = buildBootloaderHashPreview({ status: 'ready' })

    expect(preview.rows.map((row) => row.value)).toEqual(['Not available', 'Not available'])
  })

  it('shows a read in progress rather than a failure while loading', () => {
    const preview = buildBootloaderHashPreview({ status: 'loading' })

    expect(preview.verdict).toBe('unknown')
    expect(preview.rows.map((row) => row.value)).toEqual(['Reading…', 'Reading…'])
    expect(preview.headline).toContain('Reading')
  })

  it('does not claim a match on a partial read even when the prefix agrees', () => {
    // A short installed read is reported as an error by the runtime, never as
    // a shorter image, so the builder must land in "unknown" here.
    const preview = buildBootloaderHashPreview({
      status: 'ready',
      embedded: INCOMING,
      installedError: 'Only 200 of 48128 bytes of the installed bootloader could be read.'
    })

    expect(preview.verdict).toBe('unknown')
  })
})
