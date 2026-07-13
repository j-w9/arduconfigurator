// OSD message shorthand table detection + edit state (ArduPilot fork feature).
// The table lives on the FC behind a MAVLink-FTP mount (@OSD/shorthand.dat);
// when the firmware exposes it the OSD Messages section shows an editable
// from→to dictionary, otherwise the editor stays hidden. Mirrors use-vtx-table.

import { useCallback, useEffect, useState } from 'react'

import type { OsdShorthand, OsdShorthandEntry } from '@arduconfig/ardupilot-core'
import { OSD_SHORTHAND_FROM_LEN, OSD_SHORTHAND_MAX_ENTRIES, OSD_SHORTHAND_TO_LEN } from '@arduconfig/ardupilot-core'

/** Usable text is one less than the field width (NUL terminator). */
export const OSD_SHORTHAND_FROM_MAX = OSD_SHORTHAND_FROM_LEN - 1
export const OSD_SHORTHAND_TO_MAX = OSD_SHORTHAND_TO_LEN - 1

// Structural runtime slice — avoids importing the whole runtime class.
export interface OsdShorthandRuntime {
  readOsdShorthand(): Promise<OsdShorthand | undefined>
  writeOsdShorthand(table: OsdShorthand): Promise<void>
}

export type OsdShorthandStatus = 'idle' | 'loading' | 'available' | 'unavailable'

export interface UseOsdShorthandResult {
  status: OsdShorthandStatus
  entries: OsdShorthandEntry[]
  dirty: boolean
  saving: boolean
  error: string | undefined
  maxEntries: number
  /** Max usable chars per field (width minus the NUL terminator). */
  fromMax: number
  toMax: number
  setEntry: (index: number, patch: Partial<OsdShorthandEntry>) => void
  addEntry: () => void
  removeEntry: (index: number) => void
  reset: () => void
  save: () => void
}

export function useOsdShorthand(input: {
  runtime: OsdShorthandRuntime | undefined
  active: boolean
  connected: boolean
}): UseOsdShorthandResult {
  const { runtime, active, connected } = input
  const [status, setStatus] = useState<OsdShorthandStatus>('idle')
  const [detected, setDetected] = useState<OsdShorthandEntry[]>([])
  const [entries, setEntries] = useState<OsdShorthandEntry[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!active || !connected || !runtime) {
      setStatus('idle')
      setDetected([])
      setEntries([])
      setDirty(false)
      setError(undefined)
      return
    }
    let cancelled = false
    setStatus('loading')
    setError(undefined)
    void runtime
      .readOsdShorthand()
      .then((table) => {
        if (cancelled) return
        if (table) {
          setDetected(table.entries.map((entry) => ({ ...entry })))
          setEntries(table.entries.map((entry) => ({ ...entry })))
          setDirty(false)
          setStatus('available')
        } else {
          setStatus('unavailable')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [active, connected, runtime])

  const setEntry = useCallback((index: number, patch: Partial<OsdShorthandEntry>) => {
    setEntries((current) => {
      const next = current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
      return next
    })
    setDirty(true)
  }, [])

  const addEntry = useCallback(() => {
    setEntries((current) => (current.length >= OSD_SHORTHAND_MAX_ENTRIES ? current : [...current, { from: '', to: '' }]))
    setDirty(true)
  }, [])

  const removeEntry = useCallback((index: number) => {
    setEntries((current) => current.filter((_entry, i) => i !== index))
    setDirty(true)
  }, [])

  const reset = useCallback(() => {
    setEntries(detected.map((entry) => ({ ...entry })))
    setDirty(false)
    setError(undefined)
  }, [detected])

  const save = useCallback(() => {
    if (!runtime || saving) {
      return
    }
    // Drop fully-empty rows; a from with no to (or vice versa) is a user error.
    const cleaned = entries
      .map((entry) => ({ from: entry.from.trim(), to: entry.to.trim() }))
      .filter((entry) => entry.from !== '' || entry.to !== '')
    const invalid = cleaned.find((entry) => entry.from === '' || entry.to === '')
    if (invalid) {
      setError('Every row needs both a "from" and a "to" (or leave the whole row blank).')
      return
    }
    setSaving(true)
    setError(undefined)
    void runtime
      .writeOsdShorthand({ entries: cleaned })
      .then(() => {
        setDetected(cleaned.map((entry) => ({ ...entry })))
        setEntries(cleaned.map((entry) => ({ ...entry })))
        setDirty(false)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Failed to write the OSD shorthand table.')
      })
      .finally(() => setSaving(false))
  }, [entries, runtime, saving])

  return {
    status,
    entries,
    dirty,
    saving,
    error,
    maxEntries: OSD_SHORTHAND_MAX_ENTRIES,
    fromMax: OSD_SHORTHAND_FROM_MAX,
    toMax: OSD_SHORTHAND_TO_MAX,
    setEntry,
    addEntry,
    removeEntry,
    reset,
    save
  }
}
