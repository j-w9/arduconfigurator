import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BootloaderClient,
  parseApj,
  decodeApjImage,
  decodeApjExtfImage,
  checkBoardMatch,
  checkImageFitsFlash,
  formatBoardId,
  type BoardIdentity,
  type FlashProgress
} from '@arduconfig/firmware-flash'
import type { WebSerialPortLike } from '@arduconfig/transport'

import { WebSerialBootloaderSerial, inflateZlib } from './web-serial-bootloader'
import { DfuHexFlasher } from './DfuHexFlasher'

export interface FirmwareBrowseEntry {
  boardId: number
  vehicletype: string
  releaseType: string
  version: string
  url: string
  latest: boolean
}

/** Desktop main-process firmware fetch bridge (window.arduconfigDesktop.firmware) —
 *  reaches firmware.ardupilot.org without the browser's CORS limit. */
export interface DesktopFirmwareBridge {
  list(boardId: number, vehicletype?: string): Promise<{ releaseTypes: string[]; entries: FirmwareBrowseEntry[] }>
  download(url: string): Promise<Uint8Array>
}

export interface FirmwareFlasherProps {
  /** When provided, renders a Close button that calls back to the host.
   *  The dedicated Flash tab passes `undefined` to suppress the modal-style
   *  Close affordance — the tab is the surface. */
  onClose?: () => void
  /** DI for tests; defaults to the real Web Serial picker. */
  requestPort?: () => Promise<WebSerialPortLike>
  /** Already-authorized Web Serial ports; polled to catch the
   * bootloader during the brief post-power-up window after a replug. */
  listPorts?: () => Promise<WebSerialPortLike[]>
  inflate?: (zlibBytes: Uint8Array) => Promise<Uint8Array>
  /** Optional: send MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN param1=3 (reboot to
   *  bootloader) to a currently-connected vehicle. When omitted the DFU
   *  button hides — the modal landing path can't issue MAVLink commands
   *  but the connected-app Flash tab can. */
  onEnterDfu?: () => Promise<void>
  /** When `onEnterDfu` is wired but the vehicle is disarmed/disconnected,
   *  the host passes the disabled reason here so the DFU button can
   *  surface a useful tooltip. */
  enterDfuDisabledReason?: string
  /** Optional: send a normal reboot (MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN
   *  param1=1). Surfaces a "Request Reboot" button above the DFU control;
   *  hidden when omitted (e.g. the disconnected modal landing path). */
  onReboot?: () => Promise<void>
  /** Disabled reason for the reboot button, same contract as the DFU one. */
  rebootDisabledReason?: string
  /** Desktop firmware fetch bridge. DI for tests; defaults to the global
   *  window.arduconfigDesktop.firmware exposed by the Electron preload. */
  firmwareBridge?: DesktopFirmwareBridge
  /** The currently-connected vehicle (e.g. "ArduCopter"), used to pre-select
   *  the firmware Vehicle dropdown so it matches what's plugged in. */
  connectedVehicle?: string
}

// A no-DFU board's serial bootloader (Cube etc.) only runs for a few
// seconds at power-up. Catch it by polling the authorized ports across a
// generous replug window.
const REPLUG_WINDOW_MS = 30_000
// Kept tight: the ChibiOS bootloader stays USB-enumerated for only ~5s on
// most boards, so the getPorts() fallback poll must run frequently to catch
// it (the navigator.serial 'connect' event is the faster primary path).
const REPLUG_POLL_INTERVAL_MS = 100
// GET_SYNC budget for the pre-scan over already-authorized ports. A real
// bootloader answers in single-digit milliseconds; the short budget fails
// fast on the user's other (firmware/MAVLink) ports, which never reply.
const PRESCAN_SYNC_TIMEOUT_MS = 800

// firmware.ardupilot.org sends no CORS headers, so a pure browser page
// cannot fetch it — the user downloads the .apj from the site (a normal
// browser download, no proxy) and drops it in. These map the picker to
// the published download folders.
const VEHICLE_DIRS = ['Copter', 'Plane', 'Rover', 'Sub', 'Blimp', 'AntennaTracker'] as const

/** Map a detected vehicle identity ("ArduCopter" / "ArduPlane" / …) to its
 *  firmware.ardupilot.org top-level folder so the Vehicle picker pre-selects
 *  what's plugged in. Falls back to Copter (the primary target) when unknown. */
function vehicleDirForVehicle(vehicle: string | undefined): (typeof VEHICLE_DIRS)[number] {
  switch (vehicle) {
    case 'ArduPlane':
      return 'Plane'
    case 'ArduRover':
      return 'Rover'
    case 'ArduSub':
      return 'Sub'
    case 'ArduCopter':
    default:
      return 'Copter'
  }
}
const RELEASE_DIRS = [
  { value: 'stable', label: 'Stable (recommended)' },
  { value: 'beta', label: 'Beta' },
  { value: 'latest', label: 'Latest (dev)' }
] as const

type Phase =
  | 'idle'
  | 'pre-scan'         // Checking whether a bootloader is ALREADY connected
  | 'prompt-unplug'   // "Unplug, then Continue" — Continue opens the picker
  | 'prompt-replug'   // Picker open, listening: "unplug, replug, pick the new port"
  | 'detecting'        // Trying identify() on a candidate port
  | 'flashing'
  | 'done'
  | 'error'

interface LoadedFirmware {
  boardId: number
  imageSize: number
  image: Uint8Array
  /**
   * Optional extflash image for dual-image boards (CubeOrange+, Pixhawk6X,
   * Pixhawk6C, Holybro Durandal H7, Hex Here4). Undefined for single-image
   * boards. Without it, those boards boot but the runtime code section
   * (in external QSPI flash) is left stale.
   */
  extfImage: Uint8Array | undefined
  name: string
  /**
   * Whether the .apj carries the `signed_firmware: true` flag. The
   * upload protocol is signature-blind; this is surfaced only as an
   * informational badge so users know the board's OTP keys must match.
   */
  signedFirmware: boolean
}

function defaultRequestPort(): Promise<WebSerialPortLike> {
  const serial = (navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPortLike> } }).serial
  if (!serial) {
    return Promise.reject(new Error('Web Serial is not available in this browser. Use Chrome/Edge or the desktop app.'))
  }
  return serial.requestPort()
}

/**
 * Compact diagnostic shape for a Web Serial port — pulls VID/PID via
 * port.getInfo() when available so each [flash] log line can show
 * which port is being attempted instead of an opaque "candidate
 * port." Returns plain strings so console.info renders inline rather
 * than collapsing the object.
 */
function describePortForLog(port: WebSerialPortLike): { vid: string; pid: string } {
  try {
    const info = (port as unknown as { getInfo?: () => { usbVendorId?: number; usbProductId?: number } }).getInfo?.()
    return {
      vid: info?.usbVendorId !== undefined ? `0x${info.usbVendorId.toString(16).padStart(4, '0')}` : 'unknown',
      pid: info?.usbProductId !== undefined ? `0x${info.usbProductId.toString(16).padStart(4, '0')}` : 'unknown'
    }
  } catch {
    return { vid: 'getInfo-threw', pid: 'getInfo-threw' }
  }
}

function defaultListPorts(): Promise<WebSerialPortLike[]> {
  const serial = (navigator as unknown as { serial?: { getPorts?(): Promise<WebSerialPortLike[]> } }).serial
  if (!serial?.getPorts) {
    return Promise.resolve([])
  }
  return serial.getPorts()
}

// Persisted custom firmware server config. The user-typed URL is saved
// in localStorage so the next session remembers it; the optional
// password is NOT persisted (kept in memory only) so it doesn't leak
// into browser-profile sync.
const CUSTOM_SERVER_STORAGE_KEY = 'arduconfig:firmware-custom-server-url'
const DEFAULT_AP_SERVER = 'https://firmware.ardupilot.org'

function readPersistedCustomServer(): string {
  try {
    if (typeof window === 'undefined') return ''
    return window.localStorage?.getItem(CUSTOM_SERVER_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistCustomServer(value: string): void {
  try {
    if (typeof window === 'undefined') return
    if (value) {
      window.localStorage?.setItem(CUSTOM_SERVER_STORAGE_KEY, value)
    } else {
      window.localStorage?.removeItem(CUSTOM_SERVER_STORAGE_KEY)
    }
  } catch {
    // localStorage may be unavailable in some embedded contexts — silently
    // fall through; the in-memory state still works for the current session.
  }
}

export function FirmwareFlasher(props: FirmwareFlasherProps) {
  const { onClose, onEnterDfu, enterDfuDisabledReason, onReboot, rebootDisabledReason } = props
  const requestPort = props.requestPort ?? defaultRequestPort
  const listPorts = props.listPorts ?? defaultListPorts
  const inflate = props.inflate ?? inflateZlib
  // Desktop firmware fetch bridge (Electron only). When present, the wizard
  // can detect the board over DFU and pull the matching .apj from
  // firmware.ardupilot.org in-app instead of the manual download + drop.
  const firmwareBridge = useMemo<DesktopFirmwareBridge | undefined>(
    () =>
      props.firmwareBridge ??
      (typeof window !== 'undefined'
        ? (window as { arduconfigDesktop?: { firmware?: DesktopFirmwareBridge } }).arduconfigDesktop?.firmware
        : undefined),
    [props.firmwareBridge]
  )

  const [phase, setPhase] = useState<Phase>('idle')
  const [browseEntries, setBrowseEntries] = useState<FirmwareBrowseEntry[] | null>(null)
  const [browseBusy, setBrowseBusy] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [manualBoardId, setManualBoardId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [identity, setIdentity] = useState<BoardIdentity | null>(null)
  const [firmware, setFirmware] = useState<LoadedFirmware | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState<{ label: string; ratio: number } | null>(null)
  const [replugInfo, setReplugInfo] = useState<string | null>(null)
  const [vehicleDir, setVehicleDir] = useState<(typeof VEHICLE_DIRS)[number]>(
    () => vehicleDirForVehicle(props.connectedVehicle)
  )
  const [releaseDir, setReleaseDir] = useState<(typeof RELEASE_DIRS)[number]['value']>('stable')
  // Custom build server (e.g. a self-hosted ArduPilot CI mirror). When
  // set, the "Open downloads" link points here instead of
  // firmware.ardupilot.org. CORS still applies to any direct fetch
  // attempts — the server admin has to allow this origin.
  const [customServer, setCustomServer] = useState<string>(() => readPersistedCustomServer())
  const [customServerToken, setCustomServerToken] = useState<string>('')
  const [showCustomServer, setShowCustomServer] = useState<boolean>(() => readPersistedCustomServer().length > 0)
  const [dfuBusy, setDfuBusy] = useState(false)
  const [dfuNotice, setDfuNotice] = useState<string | null>(null)
  // DFU is more disruptive than a normal reboot (drops the MAVLink link and
  // requires a USB replug), so the button is two-step: the first click arms
  // a confirm/cancel pair, the confirm actually sends the command.
  const [dfuConfirmArmed, setDfuConfirmArmed] = useState(false)
  const [rebootBusy, setRebootBusy] = useState(false)

  const serialRef = useRef<WebSerialBootloaderSerial | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const replugAbortRef = useRef(false)
  // Parks catchBootloader on the "Unplug, then Continue" step; the
  // Continue click opens the picker (its own user gesture) and resolves.
  const unplugContinueResolveRef = useRef<(() => void) | null>(null)
  // Synchronous re-entrancy guard: the canFlash/disabled gate is
  // async-state-based, so a double-click runs handleFlash twice before
  // React commits the disable — two concurrent catchBootloader poll
  // loops would fight over the same port (one can close the live serial
  // mid-identify). This blocks the second invocation synchronously.
  const flashingRef = useRef(false)
  // Queue of candidate ports the poll loop will try. Fed from THREE
  // sources during prompt-replug: (1) getPorts() poll diff vs the
  // post-unplug snapshot, (2) navigator.serial 'connect' event for
  // ports the user has previously authorized, (3) the manual "Find my
  // flight controller" button which invokes navigator.serial.requestPort()
  // — needed when the bootloader's USB device has a different
  // VID/PID than the firmware port (most ChibiOS boards) and
  // getPorts() doesn't expose it.
  const candidatePortsRef = useRef<WebSerialPortLike[]>([])
  // Ports already attempted identify() on in this catchBootloader session, so
  // the getPorts() poll doesn't re-queue them. Cleared at the start of each
  // catchBootloader invocation.
  const triedPortsRef = useRef<WeakSet<WebSerialPortLike>>(new WeakSet())
  // Count of identify failures during the current prompt-replug
  // window. After ~3 the UI promotes the manual-pick CTA so the user
  // (whose auto-detect ports all turn out to be the firmware) knows
  // to use the picker.
  const triedPortCountRef = useRef(0)

  const downloadUrl = useMemo(() => {
    const base = customServer.trim() || DEFAULT_AP_SERVER
    // Strip a trailing slash so the joined path is consistent.
    const normalized = base.endsWith('/') ? base.slice(0, -1) : base
    return `${normalized}/${vehicleDir}/${releaseDir}/`
  }, [customServer, vehicleDir, releaseDir])

  const handleCustomServerChange = useCallback((value: string) => {
    setCustomServer(value)
    persistCustomServer(value.trim())
  }, [])

  const handleEnterDfu = useCallback(async () => {
    if (!onEnterDfu) return
    setDfuConfirmArmed(false)
    setDfuBusy(true)
    setDfuNotice('Sending reboot-to-bootloader command…')
    try {
      await onEnterDfu()
      setDfuNotice(
        'Reboot to bootloader sent. The board stays in its bootloader until power-off — no rush. Click Flash firmware and do not unplug.'
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enter DFU mode.'
      setDfuNotice(message)
    } finally {
      setDfuBusy(false)
    }
  }, [onEnterDfu])

  const handleReboot = useCallback(async () => {
    if (!onReboot) return
    setRebootBusy(true)
    setDfuNotice('Sending reboot command…')
    try {
      await onReboot()
      setDfuNotice('Reboot requested. The vehicle will drop the link and reconnect.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to request reboot.'
      setDfuNotice(message)
    } finally {
      setRebootBusy(false)
    }
  }, [onReboot])

  useEffect(
    () => () => {
      replugAbortRef.current = true
      // Unblock catchBootloader if it's parked on the unplug step so its
      // async path can exit cleanly on unmount.
      unplugContinueResolveRef.current?.()
      candidatePortsRef.current = []
      void serialRef.current?.close()
    },
    []
  )

  // Conditionally rendered, so mount === open / unmount === close. Move
  // focus into the dialog on open, restore it to the trigger on close.
  useEffect(() => {
    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    closeButtonRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [])

  const fail = useCallback((message: string) => {
    setReplugInfo(null)
    setError(message)
    setPhase('error')
  }, [])

  // Shared .apj loader (used by the file drop and the desktop browse path).
  // Parses + decodes the image and stages it as the firmware to flash.
  const loadFirmwareApj = useCallback(
    async (apjText: string, name: string) => {
      setError(null)
      try {
        const parsed = parseApj(apjText)
        const image = await decodeApjImage(parsed, inflate)
        // Decode the extflash image too, if present. Dual-image boards must
        // have both halves flashed or the board boots into a stale code
        // section.
        const extfImage = await decodeApjExtfImage(parsed, inflate)
        // The decoded image length is the true firmware size and is
        // always known; the .apj's declared image_size is advisory and
        // may be absent (uploader.py derives size the same way).
        setFirmware({
          boardId: parsed.boardId,
          imageSize: image.length,
          image,
          extfImage,
          name,
          signedFirmware: parsed.signedFirmware
        })
        if (phase === 'error' || phase === 'done') {
          setPhase('idle')
        }
      } catch (e) {
        setFirmware(null)
        fail(e instanceof Error ? `Invalid firmware file: ${e.message}` : 'Invalid firmware file.')
      }
    },
    [inflate, phase, fail]
  )

  const onFile = useCallback(
    async (file: File) => {
      await loadFirmwareApj(await file.text(), file.name)
    },
    [loadFirmwareApj]
  )

  // Desktop browse: fetch the board's firmware list via the main-process
  // bridge (no CORS) for the selected vehicle, filtered to the chosen release.
  const releaseTypeForDir = useCallback((dir: string): string => {
    if (dir === 'stable') return 'OFFICIAL'
    if (dir === 'beta') return 'BETA'
    // The /latest/ folder's dev builds are typed "DEV" in
    // mav-firmware-version-type ("LATEST" never occurs), so mapping
    // the Latest filter to anything else matches nothing.
    return 'DEV'
  }, [])

  const handleFetchReleases = useCallback(async () => {
    if (!firmwareBridge) return
    const boardId = identity?.boardId ?? (manualBoardId.trim() ? Number(manualBoardId.trim()) : Number.NaN)
    if (!Number.isInteger(boardId) || boardId <= 0) {
      setBrowseError('Detect the board (DFU) first, or enter a board id.')
      return
    }
    setBrowseBusy(true)
    setBrowseError(null)
    setBrowseEntries(null)
    try {
      const result = await firmwareBridge.list(boardId, vehicleDir)
      const wanted = releaseTypeForDir(releaseDir)
      const filtered = result.entries.filter((entry) => entry.releaseType === wanted)
      setBrowseEntries(filtered.length > 0 ? filtered : result.entries)
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : 'Failed to fetch firmware list.')
    } finally {
      setBrowseBusy(false)
    }
  }, [firmwareBridge, identity, manualBoardId, vehicleDir, releaseDir, releaseTypeForDir])

  const handleUseBuild = useCallback(
    async (entry: FirmwareBrowseEntry) => {
      if (!firmwareBridge) return
      setBrowseBusy(true)
      setBrowseError(null)
      try {
        const bytes = await firmwareBridge.download(entry.url)
        const name = entry.url.split('/').slice(-2).join('/')
        await loadFirmwareApj(new TextDecoder().decode(bytes), name)
      } catch (e) {
        setBrowseError(e instanceof Error ? e.message : 'Failed to download firmware.')
      } finally {
        setBrowseBusy(false)
      }
    },
    [firmwareBridge, loadFirmwareApj]
  )

  // Catch the serial bootloader, which only runs for a few seconds at
  // power-up on no-DFU boards. Snapshot the authorized ports, prompt the
  // replug, then listen in parallel via three sources: the navigator.serial
  // 'connect' event (fires for previously-authorized VID/PIDs), a getPorts()
  // poll diff against the snapshot, and the manual picker (requestPort, the
  // only path that can authorize a new VID/PID — the ChibiOS bootloader
  // case, where the bootloader's USB device differs from the firmware's).
  const catchBootloader = useCallback(async (): Promise<BoardIdentity | null> => {
    // Each step logs a `[flash]` line at info level (visible without verbose
    // mode) so the console pinpoints which phase failed.
    const log = (msg: string, ...args: unknown[]): void => console.info('[flash]', msg, ...args)

    replugAbortRef.current = false
    candidatePortsRef.current = []
    triedPortsRef.current = new WeakSet()
    triedPortCountRef.current = 0
    setIdentity(null)
    log('catchBootloader: start')
    await serialRef.current?.close()
    serialRef.current = null

    // Baseline snapshot (board typically still plugged in): any port
    // that appears AFTER this is an auto-catch candidate for the poll
    // diff. Handle identity is stable across getPorts() calls per the
    // Web Serial spec, so Set/reference comparison is safe.
    let preExistingPorts: ReadonlySet<WebSerialPortLike>
    try {
      preExistingPorts = new Set(await listPorts())
    } catch {
      preExistingPorts = new Set()
    }
    log('baseline snapshot: %d authorized ports', preExistingPorts.size)

    // PRE-SCAN the baseline ports — the board may ALREADY be in
    // bootloader mode: "Reboot into bootloader" holds it there until
    // power-off, and a bootloader port authorized in a past session is
    // sitting in getPorts() right now. Short identify per port so the
    // user's firmware/MAVLink ports fail fast. Deliberately NOT added
    // to triedPortsRef — the same physical board legitimately reappears
    // (as its bootloader) after a replug and must still get an attempt.
    setPhase('pre-scan')
    setReplugInfo(null)
    for (const port of preExistingPorts) {
      if (replugAbortRef.current) {
        log('aborted during pre-scan')
        return null
      }
      const info = describePortForLog(port)
      log('pre-scan: trying short identify', info)
      const result = await tryIdentifyPortDiagnostic(port, { quickSync: true })
      if (result.ok) {
        log('PRE-SCAN IDENTIFY SUCCESS (board was already in bootloader mode)', result.identity, info)
        return result.identity
      }
      log('pre-scan: not a bootloader', { error: result.errorMessage, ...info })
    }

    // Tell the operator to unplug BEFORE the picker covers the screen:
    // if the picker opens first, the unplug instruction is hidden behind
    // it. The picker opens on the Continue click — a fresh user gesture,
    // so requestPort() never races the original Flash click's activation
    // window.
    setPhase('prompt-unplug')
    log('prompt-unplug: waiting for Continue (opens the picker)')
    await new Promise<void>((resolve) => {
      unplugContinueResolveRef.current = resolve
    })
    unplugContinueResolveRef.current = null
    if (replugAbortRef.current) {
      log('aborted during prompt-unplug')
      return null
    }

    // Catch phase: the picker is now on screen, the listeners run in
    // parallel. Replug catches granted-VID/PID bootloaders automatically;
    // everything else arrives via the picker.
    setPhase('prompt-replug')
    log('listening (picker + connect-event + 100ms poll)')

    // Subscribe to the 'connect' event — fires when a granted device shows
    // up, faster than the getPorts() poll. TypeScript's DOM lib types it as
    // a generic Event, so cast through unknown to read the port.
    const serial = (navigator as unknown as {
      serial?: { addEventListener?: (type: string, listener: (event: Event) => void) => void; removeEventListener?: (type: string, listener: (event: Event) => void) => void }
    }).serial
    const connectListener = (event: Event): void => {
      // The W3C SerialConnectionEvent spec puts the port on `.port`; some
      // Chromium versions put it on `.target` instead, so read both.
      const eventAny = event as unknown as { port?: WebSerialPortLike; target?: WebSerialPortLike }
      const port = eventAny.port ?? eventAny.target
      log('navigator.serial connect event', {
        hasPortField: Boolean(eventAny.port),
        hasTargetPort: Boolean(eventAny.target && typeof (eventAny.target as { getInfo?: unknown }).getInfo === 'function'),
        resolved: Boolean(port)
      })
      if (port && !candidatePortsRef.current.includes(port) && !triedPortsRef.current.has(port)) {
        candidatePortsRef.current.push(port)
      }
    }
    try {
      serial?.addEventListener?.('connect', connectListener)
    } catch {
      /* old browsers may not support; the poll path still works */
    }

    const deadlineMs = Date.now() + REPLUG_WINDOW_MS
    try {
      while (Date.now() < deadlineMs && !replugAbortRef.current) {
        // Drain the candidate queue first (manual picks + connect-event
        // ports). Each candidate gets one identify() attempt — failures
        // are silently swallowed (the user may have picked the wrong
        // port; we'll try the next candidate).
        while (candidatePortsRef.current.length > 0) {
          if (replugAbortRef.current) return null
          const candidate = candidatePortsRef.current.shift()!
          // Mark BEFORE attempt — even if identify throws unexpectedly
          // we don't want this port re-queued on the next poll. Marker
          // is removed only via "session reset" (start of next
          // catchBootloader); not removed if the port disappears mid-
          // session (rare; the user can hit Cancel + Flash again).
          triedPortsRef.current.add(candidate)
          triedPortCountRef.current += 1
          const info = describePortForLog(candidate)
          log('trying identify on candidate port', info)
          setPhase('detecting')
          const startedAtMs = Date.now()
          const result = await tryIdentifyPortDiagnostic(candidate)
          if (result.ok) {
            log('IDENTIFY SUCCESS', result.identity, info)
            return result.identity
          }
          log('identify failed', {
            elapsedMs: Date.now() - startedAtMs,
            error: result.errorMessage,
            ...info
          })
          setPhase('prompt-replug')
          // Promote the manual-picker CTA after the first failed identify —
          // a separate-VID/PID bootloader is only reachable via requestPort().
          if (triedPortCountRef.current >= 1) {
            const tried = triedPortCountRef.current
            setReplugInfo(
              `${tried} port${tried === 1 ? '' : 's'} checked — no bootloader yet. Pick the newest port in the picker (Reopen port picker if it closed).`
            )
          }
        }

        // Poll authorized ports — diff against the post-unplug snapshot
        // AND the already-tried set. New, never-tried ports go to the
        // candidate queue so the next loop iteration drains them.
        let ports: WebSerialPortLike[] = []
        try {
          ports = await listPorts()
        } catch {
          ports = []
        }
        for (const port of ports) {
          if (
            !preExistingPorts.has(port) &&
            !candidatePortsRef.current.includes(port) &&
            !triedPortsRef.current.has(port)
          ) {
            log('getPorts poll: queueing new port', describePortForLog(port))
            candidatePortsRef.current.push(port)
          }
        }

        await new Promise((resolve) => setTimeout(resolve, REPLUG_POLL_INTERVAL_MS))
      }
    } finally {
      try {
        serial?.removeEventListener?.('connect', connectListener)
      } catch {
        /* nothing to clean up */
      }
    }

    if (!replugAbortRef.current) {
      fail(
        'No bootloader found within 30 seconds. Click Flash again and pick the new port in the picker the moment it appears. On a connected board, "Reboot into bootloader" first is easier. Make sure the cable is a USB data cable.'
      )
    }
    return null
  }, [listPorts, fail])

  // Identify one port — open() + BootloaderClient.identify(). Returns
  // {ok:true, identity} on success (and commits serialRef to the live
  // handle); {ok:false, errorMessage} on any failure (port open
  // refused, identify timed out, wrong protocol). The catchBootloader
  // poll uses the failure path to surface WHY each port didn't take
  // in the diagnostic log instead of swallowing the reason.
  const tryIdentifyPortDiagnostic = useCallback(
    async (
      port: WebSerialPortLike,
      options: { quickSync?: boolean } = {}
    ): Promise<
      { ok: true; identity: BoardIdentity } | { ok: false; errorMessage: string }
    > => {
      let serial: WebSerialBootloaderSerial | undefined
      try {
        serial = await WebSerialBootloaderSerial.open(port)
      } catch (error) {
        await serial?.close().catch(() => undefined)
        return {
          ok: false,
          errorMessage: `open() refused: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      try {
        // quickSync: pre-scan probes ports that are usually NOT
        // bootloaders (the user's firmware/MAVLink ports) — fail fast
        // instead of burning the full sync timeout on each.
        const identity = await new BootloaderClient(serial).identify(
          options.quickSync ? { syncTimeoutMs: PRESCAN_SYNC_TIMEOUT_MS } : {}
        )
        if (replugAbortRef.current) {
          await serial.close().catch(() => undefined)
          return { ok: false, errorMessage: 'aborted by user mid-identify' }
        }
        serialRef.current = serial
        setIdentity(identity)
        setReplugInfo(null)
        return { ok: true, identity }
      } catch (error) {
        await serial.close().catch(() => undefined)
        return {
          ok: false,
          errorMessage: `identify(): ${error instanceof Error ? error.message : String(error)}`
        }
      }
    },
    []
  )

  // Manual-pick button → invoke requestPort() under a valid user
  // gesture and feed the chosen port into the candidate queue.
  // Critical for the separate-VID/PID-bootloader case where the
  // device wouldn't otherwise appear in getPorts() at all.
  const handleManualPick = useCallback(async () => {
    try {
      const port = await requestPort()
      if (port && !candidatePortsRef.current.includes(port)) {
        candidatePortsRef.current.push(port)
      }
    } catch {
      /* user dismissed the picker — keep listening passively */
    }
  }, [requestPort])

  // "Unplug, then Continue" → open the picker under THIS click's user
  // gesture and let catchBootloader proceed into the listen loop.
  const handleUnplugContinue = useCallback(() => {
    void handleManualPick()
    unplugContinueResolveRef.current?.()
  }, [handleManualPick])

  // Cancel mid-replug — used by the modal's Cancel button.
  const handleReplugCancel = useCallback(() => {
    replugAbortRef.current = true
    // Unblock catchBootloader if it's parked on the unplug step.
    unplugContinueResolveRef.current?.()
    candidatePortsRef.current = []
    setReplugInfo(null)
    setPhase('idle')
  }, [])

  const writeFirmware = useCallback(
    async (loaded: LoadedFirmware, board: BoardIdentity) => {
      if (!serialRef.current) {
        return
      }
      // Board-id guard at the point of no return — refuse a mismatched
      // image even though the user picked it. Pass bootloader rev + flash
      // size so the FMUv3-on-FMUv2 compat case (corrected-bootloader +
      // large flash) is recognised.
      const match = checkBoardMatch(
        loaded.boardId,
        board.boardId,
        board.bootloaderRevision,
        board.flashSize
      )
      if (!match.ok) {
        fail(match.reason ?? 'Refusing to flash: board id mismatch.')
        return
      }
      // A compat-table hit emits an INFO note (mirrors uploader.py
      // "INFO: …compatible…" log line). Surface it as a
      // setReplugInfo-style banner so the operator sees the cross-id
      // exception they're proceeding under, not silent assent.
      if (match.note) {
        setReplugInfo(match.note)
      }
      // Second point-of-no-return guard: refuse an image too large for
      // this board's flash BEFORE erase, so the refusal copy is honest
      // (board still intact) rather than the post-erase "no valid
      // firmware" path. flash() enforces this too as the package-level
      // net; checking here keeps the UI message pre-erase-accurate.
      const fits = checkImageFitsFlash(loaded.image.length, board.flashSize)
      if (!fits.ok) {
        fail(fits.reason ?? 'Refusing to flash: image too large for this board.')
        return
      }
      // Skip-if-same-firmware: issue GET_CRC before erase (no write, no
      // destructive side-effect) and prompt the operator when the
      // on-disk image matches what's staged. Mirrors Mission Planner's
      // NoNeedToUpload behavior — saves a full erase+program cycle on the
      // common "wrong download" path. Try/catch because rev-2 bootloaders
      // have no GET_CRC; a thrown error here must not block the actual
      // flash.
      const liveSerial = serialRef.current
      if (!liveSerial) {
        return
      }
      // Re-arm the bootloader session on the live connection right before we
      // touch it. ArduPilot's bl_protocol rejects CHIP_ERASE *and* GET_CRC with
      // PROTO_INVALID unless GET_SYNC + the GET_DEVICE queries (BL_REV /
      // BOARD_ID / FW_SIZE) ran THIS bootloader session
      // (CHECK_GET_DEVICE_FINISHED). A cached identity from an earlier detect
      // isn't enough: if the bootloader timed out its protocol state or the
      // board re-enumerated since, those flags are cleared and the erase is
      // refused ("INVALID OPERATION during chip erase"). Re-identifying here
      // mirrors uploader.py's identify-immediately-before-erase sequence.
      //
      // STRICTLY BEST-EFFORT: a successful re-identify re-arms the flags; a
      // failure must NOT abort, or we'd break a board whose flags were still
      // valid (flashing that already worked). If the link is genuinely gone,
      // the GET_CRC / erase below surfaces the real error.
      try {
        await new BootloaderClient(liveSerial).identify()
      } catch {
        // Ignore — proceed to the flash the operator asked for.
      }
      try {
        const alreadyCurrent = await new BootloaderClient(liveSerial).currentMatches(
          loaded.image,
          board.flashSize
        )
        if (alreadyCurrent) {
          const proceed =
            typeof window !== 'undefined' && typeof window.confirm === 'function'
              ? window.confirm(
                  `This board already has ${loaded.name} (firmware CRC matches). ` +
                    `Click OK to re-flash anyway, Cancel to skip.`
                )
              : true
          if (!proceed) {
            setReplugInfo(`Skipped: the board already has ${loaded.name}.`)
            setPhase('done')
            await serialRef.current?.close().catch(() => undefined)
            serialRef.current = null
            setIdentity(null)
            return
          }
        }
      } catch {
        // GET_CRC unavailable (rev-2) or transient failure — fall
        // through to the normal flash path the operator asked for.
      }
      setPhase('flashing')
      setError(null)
      const onProgress: FlashProgress = (p, ratio) => {
        const label =
          p === 'erase'
            ? 'Erasing'
            : p === 'program'
              ? 'Writing'
              : p === 'verify'
                ? 'Verifying'
                : p === 'extf-erase'
                  ? 'Erasing extflash'
                  : p === 'extf-program'
                    ? 'Writing extflash'
                    : 'Verifying extflash'
        setProgress({ label, ratio })
      }
      try {
        // Reuse the const captured above the GET_CRC await — after an
        // await, TypeScript can no longer narrow the mutable
        // serialRef.current property to non-null on its own. extfImage is
        // forwarded so dual-image boards flash both halves;
        // bootloaderRevision is forwarded so rev-2 boards take the
        // CHIP_VERIFY+READ_MULTI byte-compare verify path.
        await new BootloaderClient(liveSerial).flash(
          loaded.image,
          board.flashSize,
          onProgress,
          loaded.extfImage,
          board.bootloaderRevision
        )
        setProgress({ label: 'Done', ratio: 1 })
        setPhase('done')
        // flash() rebooted the board into the new firmware, so the bootloader
        // port is gone. Invalidate the cached serial/identity so a second
        // Flash click re-runs catchBootloader instead of writing to a dead
        // handle.
        await serialRef.current?.close().catch(() => undefined)
        serialRef.current = null
        setIdentity(null)
      } catch (e) {
        // Invalidate the connection so a retry re-runs catchBootloader and
        // re-guards the live board rather than a cached identity (the board
        // often re-enumerates on a failed flash). Staged firmware/confirm are
        // kept so the user just clicks Flash again.
        await serialRef.current?.close().catch(() => undefined)
        serialRef.current = null
        setIdentity(null)
        const message = e instanceof Error ? e.message : ''
        // PROTO_INVALID on CHIP_ERASE means the bootloader rejected THIS erase
        // at its pre-erase check (it requires GET_SYNC + GET_DEVICE this
        // session). The configurator now re-establishes that handshake before
        // every flash, so a retry should be accepted. Be honest about firmware
        // state: an EARLIER attempt in this session may already have erased the
        // chip, so we can't promise the firmware is intact — only that the
        // reflash needs to complete.
        if (/INVALID OPERATION during chip erase/i.test(message)) {
          fail(
            'Flash refused: the bootloader rejected the erase handshake. The configurator re-establishes it before each flash, so keep the board connected and click Flash again — the reflash should go through. ' +
              'If an earlier attempt already began erasing, the board will not boot until this flash completes.'
          )
        } else {
          // Past the erase precheck, CHIP_ERASE was sent — the old firmware is
          // gone and the board needs a completed flash.
          fail(
            message
              ? `Flash failed: ${message}. The chip erase was already sent, so the board has no valid firmware and will not boot until a flash completes. Keep it connected and click Flash again.`
              : 'Flash failed. The board has no valid firmware and will not boot until a flash completes — keep it connected and click Flash again.'
          )
        }
      }
    },
    [fail]
  )

  // One button: ensure a bootloader (prompting the replug if needed),
  // then write. The user never touches detect / DFU / 1200-touch.
  const handleFlash = useCallback(async () => {
    if (flashingRef.current) {
      return
    }
    if (!firmware) {
      fail('Choose the firmware .apj first (steps 1–2).')
      return
    }
    flashingRef.current = true
    try {
      setError(null)
      let board = identity
      if (!serialRef.current || !board) {
        board = await catchBootloader()
        if (!board) {
          return
        }
      }
      if (!serialRef.current) {
        return
      }
      await writeFirmware(firmware, board)
    } finally {
      flashingRef.current = false
    }
  }, [firmware, identity, catchBootloader, writeFirmware, fail])

  const canFlash =
    !!firmware &&
    confirmed &&
    phase !== 'flashing' &&
    phase !== 'pre-scan' &&
    phase !== 'prompt-unplug' &&
    phase !== 'detecting' &&
    phase !== 'prompt-replug'

  return (
    <section
      className="bf-gui-box firmware-flasher"
      // Tab-mode (no onClose) doesn't need modal semantics — keep the
      // role/aria attrs only when rendered as a popup over the app.
      {...(onClose
        ? ({ role: 'dialog', 'aria-modal': true, 'aria-label': 'Flash firmware' } as const)
        : ({ 'aria-label': 'Flash firmware' } as const))}
      data-testid="firmware-flasher"
    >
      <div className="bf-gui-box__titlebar">
        <strong>Flash Firmware</strong>
        {onClose ? (
          <button type="button" ref={closeButtonRef} onClick={onClose} data-testid="firmware-close">
            Close
          </button>
        ) : null}
      </div>
      <div className="bf-gui-box__body firmware-wizard">
        {/* Pre-wizard helpers — DFU entry (visible only when we have a
          * live MAVLink link) and custom build-server URL (always
          * available). Both fold open from a single row of buttons so
          * the default surface stays the 3-step flash wizard. */}
        <div className="firmware-wizard__quick-actions" data-testid="firmware-quick-actions">
          {onReboot ? (
            <button
              type="button"
              className="firmware-wizard__reboot-button"
              data-testid="firmware-request-reboot"
              disabled={rebootBusy || dfuBusy || Boolean(rebootDisabledReason)}
              title={rebootDisabledReason}
              onClick={() => void handleReboot()}
            >
              {rebootBusy ? 'Rebooting…' : 'Request Reboot'}
            </button>
          ) : null}
          {onEnterDfu ? (
            dfuConfirmArmed ? (
              // Armed confirm/cancel pair — the second deliberate click sends
              // the DFU reboot.
              <span className="firmware-wizard__dfu-confirm" data-testid="firmware-enter-dfu-confirm-row">
                <button
                  type="button"
                  className="firmware-wizard__dfu-button firmware-wizard__dfu-button--danger"
                  data-testid="firmware-enter-dfu-confirm"
                  disabled={dfuBusy}
                  onClick={() => void handleEnterDfu()}
                >
                  {dfuBusy ? 'Rebooting…' : 'Confirm: enter DFU'}
                </button>
                <button
                  type="button"
                  className="firmware-wizard__dfu-cancel"
                  data-testid="firmware-enter-dfu-cancel"
                  disabled={dfuBusy}
                  onClick={() => setDfuConfirmArmed(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="firmware-wizard__dfu-button"
                data-testid="firmware-enter-dfu"
                disabled={dfuBusy || Boolean(enterDfuDisabledReason)}
                title={enterDfuDisabledReason}
                onClick={() => setDfuConfirmArmed(true)}
              >
                Activate Bootloader (DFU)
              </button>
            )
          ) : null}
          <button
            type="button"
            className="firmware-wizard__server-toggle"
            data-testid="firmware-toggle-custom-server"
            onClick={() => setShowCustomServer((open) => !open)}
            aria-expanded={showCustomServer}
          >
            {showCustomServer ? 'Hide custom server' : 'Use custom build server'}
          </button>
        </div>
        {onEnterDfu && dfuConfirmArmed ? (
          <p className="bf-note bf-note--warning" data-testid="firmware-enter-dfu-warning">
            DFU drops the MAVLink link and requires unplugging/replugging USB. Only proceed if you intend to reflash. Click "Confirm: enter DFU" to continue.
          </p>
        ) : null}

        {dfuNotice ? (
          <p className="bf-note" data-testid="firmware-dfu-notice">{dfuNotice}</p>
        ) : null}

        {showCustomServer ? (
          <div className="firmware-wizard__custom-server" data-testid="firmware-custom-server">
            <label className="scoped-editor-field">
              <span>Build server URL</span>
              <input
                type="url"
                placeholder={DEFAULT_AP_SERVER}
                value={customServer}
                onChange={(event) => handleCustomServerChange(event.target.value)}
                data-testid="firmware-custom-server-url"
                inputMode="url"
                spellCheck={false}
              />
            </label>
            <label className="scoped-editor-field">
              <span>Access token (optional)</span>
              <input
                type="password"
                placeholder="Bearer / shared secret"
                value={customServerToken}
                onChange={(event) => setCustomServerToken(event.target.value)}
                data-testid="firmware-custom-server-token"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="firmware-wizard__hint">
              Point this at an internal ArduPilot build mirror (e.g. a per-branch CI). The URL is saved
              for next session; the token stays in memory only. The browser still has to honor the
              server's CORS settings — Jack's branch builds need to allow this origin.
            </p>
          </div>
        ) : null}

        <ol className="firmware-wizard__steps">
          <li>
            <span className="firmware-wizard__step-title">1. Pick the firmware</span>
            <div className="firmware-wizard__row">
              <label className="scoped-editor-field">
                <span>Vehicle</span>
                <select
                  data-testid="firmware-vehicle"
                  value={vehicleDir}
                  onChange={(e) => setVehicleDir(e.target.value as (typeof VEHICLE_DIRS)[number])}
                >
                  {VEHICLE_DIRS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="scoped-editor-field">
                <span>Release</span>
                <select
                  data-testid="firmware-release"
                  value={releaseDir}
                  onChange={(e) => setReleaseDir(e.target.value as (typeof RELEASE_DIRS)[number]['value'])}
                >
                  {RELEASE_DIRS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <a
              className="firmware-wizard__link"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="firmware-download-link"
            >
              Open ArduPilot downloads ↗
            </a>
            <p className="firmware-wizard__hint">
              Opens firmware.ardupilot.org. Find your exact board’s folder and download its{' '}
              <code>.apj</code> (your browser downloads it directly — no proxy).
            </p>

            {firmwareBridge ? (
              <div className="firmware-wizard__browse" data-testid="firmware-browse">
                <div className="firmware-wizard__browse-header">
                  <strong>Or fetch in-app (desktop)</strong>
                  <span>{identity ? `Board id ${identity.boardId} detected` : 'Detect your board, then fetch the matching build.'}</span>
                </div>
                <div className="firmware-wizard__browse-controls">
                  <button
                    type="button"
                    data-testid="firmware-browse-detect"
                    disabled={phase === 'detecting' || phase === 'flashing' || browseBusy}
                    onClick={() => void catchBootloader()}
                  >
                    {phase === 'detecting' ? 'Detecting…' : 'Detect board (DFU)'}
                  </button>
                  <label className="scoped-editor-field scoped-editor-field--compact">
                    <span>or board id</span>
                    <input
                      type="number"
                      data-testid="firmware-browse-board-id"
                      aria-label="Board id"
                      value={manualBoardId}
                      placeholder={identity ? String(identity.boardId) : 'e.g. 1059'}
                      onChange={(event) => setManualBoardId(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="firmware-browse-fetch"
                    disabled={browseBusy}
                    onClick={() => void handleFetchReleases()}
                  >
                    {browseBusy ? 'Fetching…' : 'Fetch releases'}
                  </button>
                </div>
                {browseError ? <p className="firmware-wizard__browse-error" data-testid="firmware-browse-error">{browseError}</p> : null}
                {browseEntries ? (
                  browseEntries.length === 0 ? (
                    <p className="firmware-wizard__hint">No matching firmware for this board / vehicle / release.</p>
                  ) : (
                    <ul className="firmware-wizard__browse-list" data-testid="firmware-browse-list">
                      {browseEntries.slice(0, 12).map((entry) => (
                        <li key={entry.url}>
                          <span>
                            {entry.vehicletype} {entry.version}
                            {entry.latest ? ' (latest)' : ''} · {entry.releaseType}
                          </span>
                          <button
                            type="button"
                            data-testid="firmware-browse-use"
                            disabled={browseBusy}
                            onClick={() => void handleUseBuild(entry)}
                          >
                            Use this build
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ) : null}
          </li>

          <li>
            <span className="firmware-wizard__step-title">2. Drop the file you downloaded</span>
            <label className="scoped-editor-field">
              <span>Firmware (.apj)</span>
              <input
                type="file"
                accept=".apj,application/json"
                data-testid="firmware-file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void onFile(file)
                }}
              />
            </label>
            {firmware ? (
              <div className="config-pills" data-testid="firmware-loaded">
                <span>{firmware.name}</span>
                <span>board id {firmware.boardId}</span>
                <span>{Math.round(firmware.imageSize / 1024)} KiB</span>
                {firmware.signedFirmware ? (
                  <span
                    data-testid="firmware-signed-badge"
                    title="This build was signed at compile time (Tools/ardupilotwaf chibios.py sign_firmware). The bootloader on a secure-boot board verifies the signature at next boot against pre-burned OTP keys; flashing proceeds normally either way."
                  >
                    signed build
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>

          <li>
            <span className="firmware-wizard__step-title">3. Flash</span>
            <p className="firmware-wizard__hint">
              Click Flash and follow the prompts. <strong>Do not unplug while it is flashing.</strong>
            </p>
            {/* Hide the irreversibility checkbox in the error state so its
                confirmation visual doesn't read as "OK" over a refusal. */}
            {phase === 'error' ? null : (
              <label className="scoped-editor-field firmware-wizard__confirm" data-testid="firmware-confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I understand flashing is irreversible and won&rsquo;t unplug until it completes.</span>
              </label>
            )}
            <button
              type="button"
              className="firmware-wizard__flash"
              onClick={() => void handleFlash()}
              disabled={!canFlash}
              data-testid="firmware-flash"
            >
              {phase === 'flashing'
                ? 'Flashing…'
                : phase === 'pre-scan'
                  ? 'Checking ports…'
                  : phase === 'prompt-unplug'
                    ? 'Waiting…'
                    : phase === 'prompt-replug'
                      ? 'Waiting for the bootloader…'
                      : phase === 'detecting'
                        ? 'Detecting board…'
                        : 'Flash firmware'}
            </button>
          </li>
        </ol>

        {identity ? (
          <div className="config-pills" data-testid="firmware-board">
            <span>Board id {formatBoardId(identity.boardId)}</span>
            <span>BL rev {identity.bootloaderRevision}</span>
            <span>{Math.round(identity.flashSize / 1024)} KiB flash</span>
          </div>
        ) : null}

        {phase === 'pre-scan' ? (
          <div className="firmware-replug-prompt" data-testid="firmware-pre-scan" role="alert">
            <strong>Checking for a connected bootloader…</strong>
          </div>
        ) : null}

        {phase === 'prompt-unplug' ? (
          <div className="firmware-replug-prompt" data-testid="firmware-prompt-unplug" role="alert">
            <strong>Unplug the flight controller.</strong>
            <p className="bf-note">Then click Continue, plug it back in, and select the bootloader port.</p>
            <div className="firmware-replug-prompt__buttons">
              <button type="button" onClick={handleUnplugContinue} data-testid="firmware-prompt-unplug-continue">
                Continue
              </button>
              <button type="button" onClick={handleReplugCancel} data-testid="firmware-prompt-cancel">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'prompt-replug' || phase === 'detecting' ? (
          <div className="firmware-replug-prompt" data-testid="firmware-prompt-replug" role="alert">
            <strong>Plug it back in and select the bootloader port.</strong>
            <div className="firmware-replug-prompt__buttons">
              <button
                type="button"
                onClick={() => void handleManualPick()}
                data-testid="firmware-prompt-manual-pick"
              >
                Reopen port picker…
              </button>
              <button
                type="button"
                onClick={handleReplugCancel}
                data-testid="firmware-prompt-cancel"
              >
                Cancel
              </button>
            </div>
            {phase === 'detecting' ? (
              <p className="bf-note" data-testid="firmware-detecting-note">
                Checking the port…
              </p>
            ) : null}
          </div>
        ) : null}

        {replugInfo ? (
          <p className="bf-note" data-testid="firmware-replug-info">
            {replugInfo}
          </p>
        ) : null}

        {phase === 'flashing' && progress ? (
          <div className="firmware-progress" data-testid="firmware-progress">
            <span>
              {progress.label} {Math.round(progress.ratio * 100)}%
            </span>
            <progress value={progress.ratio} max={1} aria-label="Firmware flash progress" />
          </div>
        ) : null}

        {phase === 'done' ? (
          <p className="bf-note" data-testid="firmware-done">
            Firmware written and verified. The board is rebooting — reconnect to configure it.
          </p>
        ) : null}

        {error ? (
          <div className="firmware-error-banner" role="alert" data-testid="firmware-error">
            <span className="firmware-error-banner__badge" aria-hidden="true">!</span>
            <div className="firmware-error-banner__body">
              <strong>Flash refused</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {/* Separate, additive path: flash a .hex over WebUSB DFU. The serial
            bootloader .apj flow above is unchanged. Reuses the same enter-DFU
            action so the operator can reboot-to-DFU right here. */}
        <DfuHexFlasher onActivateDfu={onEnterDfu} activateDfuDisabledReason={enterDfuDisabledReason} />
      </div>
    </section>
  )
}
