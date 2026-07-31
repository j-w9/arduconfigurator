import { useCallback, useEffect, useRef, useState } from 'react'
import type { MavftpDirectoryEntry } from '@arduconfig/ardupilot-core'

import type { InstalledLuaScript } from '../views/LuaScripts'
import { validateLuaUpload, type LuaAppletMeta } from '../view-models/lua-scripts'

// Minimal structural slice of the runtime the Lua Scripts tab needs: MAVFTP for
// the scripts directory plus a verified param write (SCR_ENABLE / SCR_HEAP_SIZE)
// and reboot for the enable-scripting flow. Keeps the hook decoupled from the
// full runtime surface, exactly like use-mavftp-browser.
export interface LuaScriptsCapableRuntime {
  listRemoteDirectory(path: string): Promise<MavftpDirectoryEntry[]>
  uploadRemoteFile(path: string, bytes: Uint8Array, options?: { overwrite?: boolean }): Promise<void>
  deleteRemotePath(path: string, kind: 'file' | 'directory'): Promise<void>
  setParameter(
    paramId: string,
    paramValue: number,
    options?: { verifyTimeoutMs?: number }
  ): Promise<{ paramId: string; confirmedValue: number }>
  reboot(): Promise<void>
  restartScripting(): Promise<void>
  stopScripting(): Promise<void>
}

export interface LuaScriptsNotice {
  tone: 'success' | 'danger'
  text: string
}

export interface UseLuaScriptsOptions {
  runtime: LuaScriptsCapableRuntime | undefined
  connected: boolean
  isActive: boolean
  scriptsDir: string
  appletContents: Readonly<Record<string, string>>
  catalog: readonly LuaAppletMeta[]
  heapLow: boolean
  recommendedHeapBytes: number
  writeOptions?: { verifyTimeoutMs?: number }
}

export interface LuaScriptsController {
  installed: readonly InstalledLuaScript[] | undefined
  installedLoading: boolean
  installedError: string | undefined
  busyAction: string | undefined
  notice: LuaScriptsNotice | undefined
  refresh: () => void
  install: (appletId: string) => void
  remove: (name: string) => void
  upload: (file: File) => void
  enableScripting: () => void
  reboot: () => void
  restartScripting: () => void
  stopScripting: () => void
}

/**
 * State machine behind the Lua Scripts tab. Owns the installed-file listing,
 * per-action busy state, and the install / upload / remove / enable-scripting /
 * reboot actions. All writes go through the runtime's verified paths.
 */
export function useLuaScripts(options: UseLuaScriptsOptions): LuaScriptsController {
  const {
    runtime,
    connected,
    isActive,
    scriptsDir,
    appletContents,
    catalog,
    heapLow,
    recommendedHeapBytes,
    writeOptions
  } = options

  const [installed, setInstalled] = useState<readonly InstalledLuaScript[] | undefined>(undefined)
  const [installedLoading, setInstalledLoading] = useState(false)
  const [installedError, setInstalledError] = useState<string | undefined>(undefined)
  const [busyAction, setBusyAction] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<LuaScriptsNotice | undefined>(undefined)

  const requestIdRef = useRef(0)
  const load = useCallback(async () => {
    if (!runtime || !connected) {
      return
    }
    const requestId = ++requestIdRef.current
    setInstalledLoading(true)
    setInstalledError(undefined)
    try {
      const listing = await runtime.listRemoteDirectory(scriptsDir)
      if (requestId !== requestIdRef.current) {
        return
      }
      const scripts = listing
        .filter((entry) => entry.kind === 'file' && /\.lua$/i.test(entry.name))
        .map((entry) => ({ name: entry.name, sizeBytes: entry.sizeBytes }))
        .sort((left, right) => left.name.localeCompare(right.name))
      setInstalled(scripts)
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return
      }
      // A missing scripts directory (never created) is not an error — it just
      // means nothing is installed yet.
      const message = error instanceof Error ? error.message : ''
      if (/not found|no such|does not exist/i.test(message)) {
        setInstalled([])
      } else {
        setInstalled(undefined)
        setInstalledError(message || 'Failed to list the scripts directory.')
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setInstalledLoading(false)
      }
    }
  }, [runtime, connected, scriptsDir])

  // Lazy-load on first activation (and on reconnect), like the file browser —
  // listing the directory is a real round-trip to the FC.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!isActive || !connected) {
      if (!connected) {
        loadedRef.current = false
        setInstalled(undefined)
      }
      return
    }
    if (!loadedRef.current) {
      loadedRef.current = true
      void load()
    }
  }, [isActive, connected, load])

  const install = useCallback(
    async (appletId: string) => {
      if (!runtime) return
      const meta = catalog.find((applet) => applet.id === appletId)
      const contents = appletContents[appletId]
      if (!meta || contents === undefined) {
        setNotice({ tone: 'danger', text: 'That script is not in the bundled catalog.' })
        return
      }
      setBusyAction(`lua:install:${appletId}`)
      setNotice(undefined)
      try {
        const bytes = new TextEncoder().encode(contents)
        await runtime.uploadRemoteFile(`${scriptsDir}/${meta.filename}`, bytes, { overwrite: true })
        await load()
        setNotice({ tone: 'success', text: `Installed ${meta.filename}. Reboot to start it.` })
      } catch (error) {
        setNotice({
          tone: 'danger',
          text: error instanceof Error ? `Install failed: ${error.message}` : 'Install failed.'
        })
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, catalog, appletContents, scriptsDir, load]
  )

  const upload = useCallback(
    async (file: File) => {
      if (!runtime) return
      const validationError = validateLuaUpload(file.name, file.size)
      if (validationError) {
        setNotice({ tone: 'danger', text: validationError })
        return
      }
      const exists = (installed ?? []).some((script) => script.name.toLowerCase() === file.name.toLowerCase())
      if (
        exists &&
        typeof window !== 'undefined' &&
        !window.confirm(`${file.name} already exists in ${scriptsDir}. Overwrite it?`)
      ) {
        return
      }
      setBusyAction('lua:upload')
      setNotice(undefined)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await runtime.uploadRemoteFile(`${scriptsDir}/${file.name}`, bytes, { overwrite: true })
        await load()
        setNotice({ tone: 'success', text: `Uploaded ${file.name}. Reboot to start it.` })
      } catch (error) {
        setNotice({
          tone: 'danger',
          text: error instanceof Error ? `Upload failed: ${error.message}` : 'Upload failed.'
        })
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, installed, scriptsDir, load]
  )

  const remove = useCallback(
    async (name: string) => {
      if (!runtime) return
      if (typeof window !== 'undefined' && !window.confirm(`Remove ${name} from ${scriptsDir}?`)) {
        return
      }
      setBusyAction(`lua:remove:${name}`)
      setNotice(undefined)
      try {
        await runtime.deleteRemotePath(`${scriptsDir}/${name}`, 'file')
        await load()
        setNotice({ tone: 'success', text: `Removed ${name}.` })
      } catch (error) {
        setNotice({
          tone: 'danger',
          text: error instanceof Error ? `Remove failed: ${error.message}` : 'Remove failed.'
        })
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, scriptsDir, load]
  )

  const enableScripting = useCallback(async () => {
    if (!runtime) return
    setBusyAction('lua:enable')
    setNotice(undefined)
    try {
      await runtime.setParameter('SCR_ENABLE', 1, writeOptions)
      // Only touch the heap when the current value looks too small — leave a
      // board-tuned larger heap alone (ArduCopter byte-identical: we write only
      // what the operator opted into).
      if (heapLow) {
        await runtime.setParameter('SCR_HEAP_SIZE', recommendedHeapBytes, writeOptions)
      }
      setNotice({
        tone: 'success',
        text: 'Scripting enabled. Reboot the flight controller to start the Lua VM.'
      })
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? `Enable failed: ${error.message}` : 'Enable failed.'
      })
    } finally {
      setBusyAction(undefined)
    }
  }, [runtime, heapLow, recommendedHeapBytes, writeOptions])

  const reboot = useCallback(async () => {
    if (!runtime) return
    setBusyAction('lua:reboot')
    setNotice(undefined)
    try {
      await runtime.reboot()
      setNotice({ tone: 'success', text: 'Reboot requested. Reconnect once the flight controller restarts.' })
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? `Reboot failed: ${error.message}` : 'Reboot failed.'
      })
    } finally {
      setBusyAction(undefined)
    }
  }, [runtime])

  // Restarting scripting is what ArduPilot actually asks for when a script
  // changes — a full reboot drops the link, re-runs every startup check and
  // re-syncs the parameter table to achieve the same thing.
  const restartScripting = useCallback(async () => {
    if (!runtime) return
    setBusyAction('lua:restart-scripting')
    setNotice(undefined)
    try {
      await runtime.restartScripting()
      setNotice({
        tone: 'success',
        text: 'Scripting restarted. Scripts re-run from the start; the flight controller stayed up.'
      })
    } catch (error) {
      setNotice({
        tone: 'danger',
        text:
          error instanceof Error
            ? `Restart scripting failed: ${error.message}`
            : 'Restart scripting failed.'
      })
    } finally {
      setBusyAction(undefined)
    }
  }, [runtime])

  const stopScripting = useCallback(async () => {
    if (!runtime) return
    setBusyAction('lua:stop-scripting')
    setNotice(undefined)
    try {
      await runtime.stopScripting()
      setNotice({
        tone: 'success',
        text: 'Scripting stopped. It stays stopped until you restart scripting or reboot.'
      })
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? `Stop scripting failed: ${error.message}` : 'Stop scripting failed.'
      })
    } finally {
      setBusyAction(undefined)
    }
  }, [runtime])

  return {
    installed,
    installedLoading,
    installedError,
    busyAction,
    notice,
    refresh: () => void load(),
    install: (appletId) => void install(appletId),
    remove: (name) => void remove(name),
    upload: (file) => void upload(file),
    enableScripting: () => void enableScripting(),
    reboot: () => void reboot(),
    restartScripting: () => void restartScripting(),
    stopScripting: () => void stopScripting()
  }
}
