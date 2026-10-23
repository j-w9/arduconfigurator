// DFU (.hex) flash card for the Flash tab. Parallel to the serial-bootloader
// .apj flow above it: when the board is already in DFU mode (re-enumerated as
// an STM32 system bootloader), this parses an ArduPilot .hex and programs it
// over WebUSB (see ./web-usb-dfu.ts + the firmware-flash DfuSe client). Fully
// self-contained — own file/parse/flash state — so it doesn't entangle the
// large serial-flash wizard.

import { useCallback, useEffect, useRef, useState } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'
import { parseIntelHex, type DfuFlashProgress, type ParsedIntelHex } from '@arduconfig/firmware-flash'

import { describeProtectedSectors } from '@arduconfig/firmware-flash'
import { FirmwareFinder } from './FirmwareFinder'
import type { FirmwareIndexSource } from './firmware-index-source'
import { firmwareBuildKey, type ConnectedBoard, type FirmwareIndexRow, type FirmwareTarget } from '../view-models/firmware-finder'
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
  /** ArduPilot's published *_with_bl.hex builds (the private deploy's index +
   *  relay). When it loads, a finder leads and the file input folds under it. */
  firmwareIndex?: FirmwareIndexSource
  /** The connected flight controller, while it is still connected: the finder
   *  pre-selects its build. A board in DFU mode cannot say what it is. */
  board?: ConnectedBoard
  /** "ArduCopter", "ArduPlane", ... for the finder's Vehicle default. */
  connectedVehicle?: string
  /** A Betaflight board's target name ("MATEKH743"): the finder's search starts with it. */
  betaflightTargetName?: string
  /** The Flash card's debug log: each DFU step and error lands there too. */
  onDebug?: (msg: string, ...args: unknown[]) => void
}

export function DfuHexFlasher({
  onActivateDfu,
  activateDfuDisabledReason,
  firmwareIndex,
  board,
  connectedVehicle,
  betaflightTargetName,
  onDebug
}: DfuHexFlasherProps) {
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
  // The phase a flash had reached, so a failure can say what state it left the board in.
  const reachedPhaseRef = useRef<DfuFlashProgress['phase'] | null>(null)

  // Closing or reloading the page mid-flash leaves the board half written.
  useEffect(() => {
    if (!busy || typeof window === 'undefined') {
      return undefined
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  // ArduPilot's *_with_bl.hex builds. Undefined rows (no index on this site)
  // hide the finder and leave the file input as it was.
  const [indexRows, setIndexRows] = useState<FirmwareIndexRow[] | undefined>(undefined)
  useEffect(() => {
    if (!firmwareIndex) return
    let cancelled = false
    firmwareIndex
      .loadIndex()
      .then((rows) => {
        if (!cancelled && rows.length > 0) setIndexRows(rows)
      })
      .catch(() => {
        // No index here (public build, desktop bundle): the file input stays.
      })
    return () => {
      cancelled = true
    }
  }, [firmwareIndex])
  // The finder build now parsed (firmwareBuildKey), for its "Downloaded" state.
  const [loadedBuild, setLoadedBuild] = useState<string | undefined>(undefined)

  const handleFinderLoad = useCallback(
    async (target: FirmwareTarget) => {
      if (!firmwareIndex) return
      setError(null)
      setNotice(null)
      const text = await firmwareIndex.download(target.path, target.gitSha)
      const result = parseIntelHex(text)
      if (result.segments.length === 0) {
        throw new Error('The downloaded .hex has no data records to flash.')
      }
      setParsed(result)
      setFileName(`${target.platform} ${target.version} (${target.path.split('/').pop() ?? target.path})`)
      setLoadedBuild(firmwareBuildKey(target))
    },
    [firmwareIndex]
  )

  const handleFile = useCallback(async (file: File | undefined) => {
    setError(null)
    setNotice(null)
    setParsed(null)
    setFileName(null)
    setLoadedBuild(undefined)
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
      onDebug?.('ERROR: dfu hex', caught)
      setError(caught instanceof Error ? caught.message : 'Could not read that .hex file.')
    }
  }, [onDebug])

  const handleFlash = useCallback(async () => {
    if (!parsed || busy) {
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    setProgress(null)
    reachedPhaseRef.current = null
    let lastStep = ''
    const onProgress = (next: DfuFlashProgress) => {
      reachedPhaseRef.current = next.phase
      if (next.label !== lastStep) onDebug?.(`dfu progress: ${next.label}`)
      lastStep = next.label
      setProgress(next)
    }
    onDebug?.(`dfu: start ${fileName ?? '.hex'} ${parsed.totalBytes} bytes fullErase=${fullErase}`)
    try {
      const { deviceName, transferSize } = await flashSegmentsOverDfu(parsed.segments, onProgress, {
        fullErase,
        log: (line) => {
          console.info(line)
          onDebug?.(line)
        },
        // The board says it will refuse part of this write. Put that in front
        // of the operator with the sectors named, rather than starting an erase
        // that fails halfway and takes the working firmware with it. Overriding
        // is allowed — someone who just cleared protection, or who knows the
        // descriptor is lying, should not be stuck — but it has to be chosen.
        confirmProtectedSectors: (protectedSectors) => {
          const detail = describeProtectedSectors(protectedSectors)
          setError(detail)
          return (
            typeof window !== 'undefined' &&
            window.confirm(
              `${detail}\n\nAttempt the flash anyway?\n\n` +
                'If the protection is real this will fail partway through the erase and the board may not boot ' +
                'until it is reflashed with the protection cleared.'
            )
          )
        }
      })
      setError(null)
      onDebug?.(`dfu: done ${deviceName} ${transferSize}-byte blocks`)
      setNotice(
        `Flashed and verified ${formatBytes(parsed.totalBytes)} to ${deviceName} (${transferSize}-byte blocks). Now unplug the flight controller and plug it back in to boot the new firmware, then reconnect.`
      )
      // Leave the completed steps on screen (all done) so the operator can see
      // what ran — the phases otherwise flash by too fast to read. Cleared on
      // the next flash (setProgress(null) above) or on error (below).
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'DFU flash failed.'
      // requestDevice() throwing because the user dismissed the chooser is not
      // an error worth a red banner.
      const phase = reachedPhaseRef.current
      onDebug?.(`ERROR: dfu ${message}`, { phase, lastStep })
      // Which step it stopped on, so a screenshot of the banner says where.
      const where = lastStep ? ` (stopped at: ${lastStep})` : ''
      setError(
        /no device selected|cancelled|the user (did|denied)|chooser/i.test(message)
          ? 'No DFU device selected.'
          : phase === 'erase' || phase === 'program'
            ? `${message}${where} The flash stopped partway; the board will not start the half-written firmware. Flash again now, while it is still in DFU mode. If it was unplugged, use the .apj flash on the Firmware tab, or hold BOOT0 while plugging it in if it does not show up.`
            : `${message}${where}`
      )
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [parsed, busy, fullErase, fileName, onDebug])

  const fileInput = (
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
  )

  return (
    <div className="bf-gui-box dfu-hex-flasher" data-testid="dfu-hex-flasher">
      <div className="bf-gui-box__titlebar">
        <strong>Flash over DFU (.hex)</strong>
        <small>for a board already in DFU mode</small>
      </div>
      <div className="bf-gui-box__body">
        <p className="dfu-hex-flasher__intro">
          For a board in <strong>DFU mode</strong>: hold <strong>BOOT0</strong> while plugging it in, or use Activate DFU
          mode below. Pick the build, then flash.
        </p>

        <p className="bf-note bf-note--warning" data-testid="dfu-hex-flaky-note">
          Activate DFU mode is unreliable on ArduPilot 4.6 and 4.7. If the board does not show up as a DFU device, hold{' '}
          <strong>BOOT0</strong> and re-plug.
        </p>

        <details className="dfu-hex-flasher__help" data-testid="dfu-hex-boot0-help">
          <summary>How do I put the board in DFU mode?</summary>
          <ol>
            <li>Unplug the flight controller from USB.</li>
            <li>Hold the <strong>BOOT0</strong> button (or bridge the BOOT0 pads) on the board.</li>
            <li>While holding BOOT0, plug the FC back into USB — it powers up as the STM32 DFU bootloader.</li>
            <li>Or, if it&rsquo;s connected over MAVLink, use <strong>Activate DFU mode</strong> below to reboot it into DFU.</li>
          </ol>
          <a
            href="https://ardupilot.org/dev/docs/using-DFU-to-load-bootloader.html"
            target="_blank"
            rel="noreferrer"
          >
            ArduPilot DFU guide ↗
          </a>
        </details>

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
            {indexRows && firmwareIndex ? (
              <FirmwareFinder
                rows={indexRows}
                board={board}
                connectedVehicle={connectedVehicle}
                initialQuery={betaflightTargetName}
                disabled={busy}
                loadedBuild={parsed ? loadedBuild : undefined}
                onLoad={handleFinderLoad}
              />
            ) : null}

            {/* The file input: folded under the finder when there is one. */}
            {indexRows ? (
              <details className="firmware-wizard__manual" data-testid="dfu-hex-file-drop">
                <summary>Or drop a .hex file</summary>
                {fileInput}
              </details>
            ) : (
              fileInput
            )}

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
                Full chip erase first (recommended): wipes <strong>all</strong> flash, not only the sectors written.
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

            {busy ? (
              <p className="bf-note" data-testid="dfu-hex-busy-note">
                Keep the board plugged in and the computer awake until it says verified. Other tabs are fine.
              </p>
            ) : null}

            {progress ? (
              <ol className="dfu-hex-flasher__steps" data-testid="dfu-hex-progress">
                {[
                  { phase: 'erase', label: fullErase ? '1. Full chip erase' : '1. Erase' },
                  { phase: 'program', label: '2. Write firmware' },
                  { phase: 'verify', label: '3. Verify (read-back compare)' }
                ].map((step) => {
                  // erase=0, program=1, verify=2; manifest means all three are done.
                  const order = ['erase', 'program', 'verify']
                  const current = progress.phase === 'manifest' ? order.length : order.indexOf(progress.phase)
                  const index = order.indexOf(step.phase)
                  const state = index < current ? 'done' : index === current ? 'active' : 'pending'
                  const pct = state === 'done' ? 100 : state === 'active' ? Math.round(progress.ratio * 100) : 0
                  return (
                    <li key={step.phase} className={`dfu-hex-flasher__step is-${state}`} data-testid={`dfu-hex-step-${step.phase}`}>
                      <span className="dfu-hex-flasher__step-label">{step.label}</span>
                      <span className="dfu-hex-flasher__step-state">
                        {state === 'done' ? '✓ done' : state === 'active' ? `${pct}%` : 'waiting'}
                      </span>
                      <progress value={pct} max={100} aria-label={step.label} />
                    </li>
                  )
                })}
              </ol>
            ) : null}

            {busy && progress ? (
              <p className="dfu-hex-flasher__status" data-testid="dfu-hex-progress-label" aria-live="polite">
                {progress.label}
              </p>
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
                  <strong>DFU flash failed</strong>
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
