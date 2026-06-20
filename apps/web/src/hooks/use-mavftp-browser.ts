import { useCallback, useEffect, useRef, useState } from 'react'
import type { MavftpDirectoryEntry } from '@arduconfig/ardupilot-core'

import { downloadBinaryFile } from '../download-file'

// Minimal structural slice of the runtime the file browser needs, so the
// hook stays decoupled from the full ArduPilotConfiguratorRuntime surface.
export interface MavftpCapableRuntime {
  listRemoteDirectory(path: string): Promise<MavftpDirectoryEntry[]>
  downloadRemoteFile(path: string): Promise<Uint8Array>
  uploadRemoteFile(path: string, bytes: Uint8Array, options?: { overwrite?: boolean }): Promise<void>
  deleteRemotePath(path: string, kind: 'file' | 'directory'): Promise<void>
}

export interface UseMavftpBrowserOptions {
  /** The active runtime, or undefined when no transport is wired. */
  runtime: MavftpCapableRuntime | undefined
  /** Whether a vehicle link is live (snapshot.connection.kind === 'connected'). */
  connected: boolean
  /** Whether the file-browser tab is the active view. */
  isActive: boolean
  /** Shared app-level busy-action setter, so download/upload/delete surface
   * in the global busy indicator exactly as before. */
  setBusyAction: (action: string | undefined) => void
}

export interface MavftpBrowser {
  path: string
  entries: readonly MavftpDirectoryEntry[]
  loading: boolean
  error: string | undefined
  navigate: (path: string) => void
  refresh: () => void
  download: (entry: MavftpDirectoryEntry) => void
  upload: (file: File) => void
  remove: (entry: MavftpDirectoryEntry) => void
}

/**
 * MAVFTP file-browser state machine. Owns the current path, directory
 * listing, loading/error state, and the navigate/download/upload/delete
 * actions. Behaviour-preserving extraction of what previously lived inline
 * in App.tsx.
 */
export function useMavftpBrowser(options: UseMavftpBrowserOptions): MavftpBrowser {
  const { runtime, connected, isActive, setBusyAction } = options

  const [path, setPath] = useState<string>('@SYS')
  const [entries, setEntries] = useState<readonly MavftpDirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Monotonic request id so a slow listing can't clobber a newer one. If
  // the operator navigates into a subdirectory while the lazy-load of the
  // parent is still in flight, only the latest request's result is applied
  // (the stale completion is dropped). Without this, a slow @SYS load
  // completing after a scripts/ navigation would snap the path back to @SYS.
  const requestIdRef = useRef(0)
  const load = useCallback(
    async (target: string) => {
      if (!runtime || !connected) {
        return
      }
      const requestId = ++requestIdRef.current
      setLoading(true)
      setError(undefined)
      try {
        const listing = await runtime.listRemoteDirectory(target)
        if (requestId !== requestIdRef.current) {
          return // a newer request superseded this one
        }
        // Sort directories first, then files, alphabetically within each.
        const sorted = [...listing].sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === 'directory' ? -1 : 1
          }
          return left.name.localeCompare(right.name)
        })
        setEntries(sorted)
        setPath(target)
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return
        }
        setEntries([])
        setError(err instanceof Error ? err.message : 'Failed to list directory.')
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false)
        }
      }
    },
    [runtime, connected]
  )

  // Lazy-load the file browser the first time the tab is opened (and on
  // reconnect), so the request only fires when the operator actually wants
  // it — MAVFTP listing is a real round-trip to the FC. Loads the default
  // root once; subsequent navigation is user-driven (not effect-driven), so
  // `path` is deliberately NOT a dependency here.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!isActive || !connected) {
      if (!connected) {
        loadedRef.current = false
      }
      return
    }
    if (!loadedRef.current) {
      loadedRef.current = true
      void load('@SYS')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, connected, load])

  const download = useCallback(
    async (entry: MavftpDirectoryEntry) => {
      if (!runtime) return
      setBusyAction('files:download')
      setError(undefined)
      try {
        const bytes = await runtime.downloadRemoteFile(entry.path)
        downloadBinaryFile(entry.name, bytes)
      } catch (err) {
        setError(err instanceof Error ? `Download failed: ${err.message}` : 'Download failed.')
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, setBusyAction]
  )

  const upload = useCallback(
    async (file: File) => {
      if (!runtime) return
      setBusyAction('files:upload')
      setError(undefined)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const destPath = `${path.replace(/\/+$/, '')}/${file.name}`
        await runtime.uploadRemoteFile(destPath, bytes, { overwrite: true })
        await load(path)
      } catch (err) {
        setError(err instanceof Error ? `Upload failed: ${err.message}` : 'Upload failed.')
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, path, load, setBusyAction]
  )

  const remove = useCallback(
    async (entry: MavftpDirectoryEntry) => {
      if (!runtime) return
      if (typeof window !== 'undefined' && !window.confirm(`Delete ${entry.path}? This cannot be undone.`)) {
        return
      }
      setBusyAction('files:delete')
      setError(undefined)
      try {
        await runtime.deleteRemotePath(entry.path, entry.kind)
        await load(path)
      } catch (err) {
        setError(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed.')
      } finally {
        setBusyAction(undefined)
      }
    },
    [runtime, path, load, setBusyAction]
  )

  const navigate = useCallback((target: string) => void load(target), [load])
  const refresh = useCallback(() => void load(path), [load, path])

  return {
    path,
    entries,
    loading,
    error,
    navigate,
    refresh,
    download: (entry) => void download(entry),
    upload: (file) => void upload(file),
    remove: (entry) => void remove(entry)
  }
}
