// DFU (.hex) flash card for the Flash tab. Parallel to the serial-bootloader
// .apj flow above it: when the board is already in DFU mode (re-enumerated as
// an STM32 system bootloader), this parses an ArduPilot .hex and programs it
// over WebUSB (see ./web-usb-dfu.ts + the firmware-flash DfuSe client). Fully
// self-contained — own file/parse/flash state — so it doesn't entangle the
// large serial-flash wizard.

import { useCallback, useState } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'
import { parseIntelHex, type DfuFlashProgress, type ParsedIntelHex } from '@arduconfig/firmware-flash'

import { flashSegmentsOverDfu, isWebUsbSupported } from './web-usb-dfu'

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} bytes`
}

function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`
}

export interface DfuHexFlasherProps {
  /** Reboot the connected FC into its DFU bootloader (two-step, gated here).
   *  Omitted when there's no live MAVLink link to command. */
  onActivateDfu?: () => Promise<void>
  /** Why the activate button is disabled (e.g. not connected / armed). */
  activateDfuDisabledReason?: string
}

export function DfuHexFlasher({ onActivateDfu, activateDfuDisabledReason }: DfuHexFlasherProps) {
  const supported = isWebUsbSupported()
  const [dfuArmed, setDfuArmed] = useState(false)
  const [activateBusy, setActivateBusy] = useState(false)
  const [activateNotice, setActivateNotice] = useState<string | null>(null)

  const handleActivateDfu = useCallback(async () => {
    if (!onActivateDfu) {
      return
    }
    setDfuArmed(false)
    setActivateBusy(true)
    setActivateNotice('Sending reboot-to-bootloader command…')
    try {
      await onActivateDfu()
      setActivateNotice('Reboot to DFU sent. Once the board re-enumerates as a DFU device, load the .hex and flash below.')
    } catch (caught) {
      setActivateNotice(caught instanceof Error ? caught.message : 'Failed to enter DFU mode.')
    } finally {
      setActivateBusy(false)
    }
  }, [onActivateDfu])
  const [parsed, setParsed] = useState<ParsedIntelHex | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<DfuFlashProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Default ON: a full chip erase wipes all flash (sized per FC) before
  // programming — the safe default for a clean reflash.
  const [fullErase, setFullErase] = useState(true)

  const handleFile = useCallback(async (file: File | undefined) => {
    setError(null)
    setNotice(null)
    setParsed(null)
    setFileName(null)
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const result = parseIntelHex(text)
      if (result.segments.length === 0) {
        throw new Error('That .hex file has no data records to flash.')
      }
      setParsed(result)
      setFileName(file.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that .hex file.')
    }
  }, [])

  const handleFlash = useCallback(async () => {
    if (!parsed || busy) {
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    setProgress(null)
    try {
      const { deviceName } = await flashSegmentsOverDfu(parsed.segments, setProgress, { fullErase })
      setNotice(
        `Flashed ${formatBytes(parsed.totalBytes)} to ${deviceName}. The board is rebooting into the new firmware — reconnect once it re-enumerates.`
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'DFU flash failed.'
      // requestDevice() throwing because the user dismissed the chooser is not
      // an error worth a red banner.
      setError(/no device selected|cancelled|the user (did|denied)|chooser/i.test(message) ? 'No DFU device selected.' : message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [parsed, busy, fullErase])

  return (
    <div className="bf-gui-box dfu-hex-flasher" data-testid="dfu-hex-flasher">
      <div className="bf-gui-box__titlebar">
        <strong>Flash over DFU (.hex)</strong>
        <small>for a board already in DFU mode</small>
      </div>
      <div className="bf-gui-box__body">
        <p className="dfu-hex-flasher__intro">
          Use this when the flight controller is in <strong>DFU mode</strong> — re-plug it while holding the
          BOOT/DFU button, or use “Enter DFU mode”, so it re-enumerates as an STM32 bootloader. Then load the
          ArduPilot <code>.hex</code> for your board and flash it directly over USB.
        </p>

        <p className="bf-note bf-note--warning" data-testid="dfu-hex-flaky-note">
          Heads up: entering/booting DFU is known to be flaky on ArduPilot 4.6 and current 4.7. If the board
          doesn&rsquo;t show up as a DFU device, re-plug while holding BOOT (or retry &ldquo;Activate DFU mode&rdquo;) and try again.
        </p>

        {onActivateDfu ? (
          <div className="dfu-hex-flasher__activate" data-testid="dfu-hex-activate-row">
            {dfuArmed ? (
              <>
                <button
                  type="button"
                  style={buttonStyle('secondary')}
                  data-testid="dfu-hex-activate-confirm"
                  disabled={activateBusy}
                  onClick={() => void handleActivateDfu()}
                >
                  {activateBusy ? 'Rebooting…' : 'Confirm: reboot to DFU'}
                </button>
                <button type="button" style={buttonStyle()} disabled={activateBusy} onClick={() => setDfuArmed(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                style={buttonStyle('secondary')}
                data-testid="dfu-hex-activate"
                disabled={activateBusy || Boolean(activateDfuDisabledReason)}
                title={activateDfuDisabledReason}
                onClick={() => setDfuArmed(true)}
              >
                Activate DFU mode
              </button>
            )}
          </div>
        ) : null}

        {dfuArmed ? (
          <p className="bf-note bf-note--warning">
            DFU drops the MAVLink link and re-enumerates over USB. Only proceed if you intend to reflash.
          </p>
        ) : null}

        {activateNotice ? (
          <p className="bf-note" data-testid="dfu-hex-activate-notice">
            {activateNotice}
          </p>
        ) : null}

        {!supported ? (
          <div className="firmware-error-banner" role="alert" data-testid="dfu-hex-unsupported">
            <span className="firmware-error-banner__badge" aria-hidden="true">!</span>
            <div className="firmware-error-banner__body">
              <strong>WebUSB unavailable</strong>
              <p>DFU flashing needs WebUSB. Use Chrome or Edge (desktop) to flash over DFU.</p>
            </div>
          </div>
        ) : (
          <>
            <label className="scoped-editor-field">
              <span>Firmware (.hex)</span>
              <input
                type="file"
                accept=".hex"
                data-testid="dfu-hex-file"
                disabled={busy}
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
            </label>

            {parsed && fileName ? (
              <dl className="dfu-hex-flasher__summary" data-testid="dfu-hex-summary">
                <div>
                  <dt>File</dt>
                  <dd>{fileName}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(parsed.totalBytes)}</dd>
                </div>
                <div>
                  <dt>Flash range</dt>
                  <dd>
                    {formatAddress(parsed.minAddress)}–{formatAddress(parsed.endAddress)}
                  </dd>
                </div>
              </dl>
            ) : null}

            <label className="dfu-hex-flasher__full-erase" data-testid="dfu-hex-full-erase">
              <input type="checkbox" checked={fullErase} disabled={busy} onChange={(event) => setFullErase(event.target.checked)} />
              <span>
                Full chip erase before flashing — wipes <strong>all</strong> flash (sized to this board), not just the
                programmed sectors. Recommended for a clean reflash.
              </span>
            </label>

            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="dfu-hex-flash"
              disabled={!parsed || busy}
              onClick={() => void handleFlash()}
            >
              {busy ? 'Flashing over DFU…' : 'Flash via DFU'}
            </button>

            {progress ? (
              <div className="firmware-progress" data-testid="dfu-hex-progress">
                <span>
                  {progress.label} {Math.round(progress.ratio * 100)}%
                </span>
                <progress value={progress.ratio} max={1} aria-label="DFU flash progress" />
              </div>
            ) : null}

            {notice ? (
              <p className="bf-note" data-testid="dfu-hex-notice">
                {notice}
              </p>
            ) : null}

            {error ? (
              <div className="firmware-error-banner" role="alert" data-testid="dfu-hex-error">
                <span className="firmware-error-banner__badge" aria-hidden="true">!</span>
                <div className="firmware-error-banner__body">
                  <strong>DFU flash refused</strong>
                  <p>{error}</p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
