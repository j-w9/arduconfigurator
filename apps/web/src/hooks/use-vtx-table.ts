// VTX band/frequency table detection + edit state for the VTX view. The table
// lives on the FC behind a MAVLink-FTP mount (@VTX/vtxtable.dat); when the
// firmware exposes it the VTX view shows a real editable band/frequency grid,
// otherwise it keeps the "Table not available" preview.
//
// Bands/frequencies and power levels are both editable + savable for an analog
// VTX — the firmware now resolves the selectable power set from this table (its
// non-zero entries, in order), so the values are authoritative. For a digital
// video system the table is instead learned from the goggles over MSP and the
// VTX view renders it read-only (see VtxSection's tableLearned).

import { useCallback, useEffect, useState } from 'react'

import type { VtxTable } from '@arduconfig/ardupilot-core'

// Structural runtime slice — avoids importing the whole runtime class.
export interface VtxTableRuntime {
  readVtxTable(): Promise<VtxTable | undefined>
  writeVtxTable(table: VtxTable): Promise<void>
}

export type VtxTableStatus = 'idle' | 'loading' | 'available' | 'unavailable'

export interface UseVtxTableResult {
  status: VtxTableStatus
  /** Editable working copy of the table (undefined until available). */
  table: VtxTable | undefined
  /** The last table READ FROM the FC (undefined until available). Unlike
   *  `table` this does not reflect unsaved edits — consumers that must match
   *  what the FC actually has (e.g. the RC Mixer's RCL level index) use this. */
  detected: VtxTable | undefined
  dirty: boolean
  saving: boolean
  error: string | undefined
  setFrequency: (bandIndex: number, channelIndex: number, mhz: number) => void
  setPowerValue: (index: number, value: number) => void
  setPowerLabel: (index: number, label: string) => void
  /** Replace the working draft wholesale (e.g. from a Betaflight import).
   *  Marks dirty; Save then uploads it. */
  loadTable: (table: VtxTable) => void
  save: () => void
  reset: () => void
  reload: () => void
}

function cloneVtxTable(table: VtxTable): VtxTable {
  return {
    version: table.version,
    numChannels: table.numChannels,
    bands: table.bands.map((band) => ({ ...band, frequencies: [...band.frequencies] })),
    powerLevels: table.powerLevels.map((level) => ({ ...level }))
  }
}

export function useVtxTable(input: {
  runtime: VtxTableRuntime | undefined
  active: boolean
  connected: boolean
}): UseVtxTableResult {
  const { runtime, active, connected } = input
  const [status, setStatus] = useState<VtxTableStatus>('idle')
  const [detected, setDetected] = useState<VtxTable | undefined>(undefined)
  const [draft, setDraft] = useState<VtxTable | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  // Bumped to force a re-detect (on reload / view re-open) without racing a
  // stale in-flight read.
  const [loadToken, setLoadToken] = useState(0)

  useEffect(() => {
    // Reset when the view closes or the link drops so re-opening re-detects.
    if (!active || !connected || !runtime) {
      setStatus('idle')
      setDetected(undefined)
      setDraft(undefined)
      setDirty(false)
      setError(undefined)
      return
    }
    let cancelled = false
    setStatus('loading')
    setError(undefined)
    void runtime
      .readVtxTable()
      .then((table) => {
        if (cancelled) return
        if (table) {
          setDetected(table)
          setDraft(cloneVtxTable(table))
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
  }, [active, connected, runtime, loadToken])

  const setFrequency = useCallback((bandIndex: number, channelIndex: number, mhz: number) => {
    setDraft((current) => {
      if (!current) return current
      const next = cloneVtxTable(current)
      const band = next.bands[bandIndex]
      if (!band || channelIndex < 0 || channelIndex >= next.numChannels) return current
      band.frequencies[channelIndex] = Number.isFinite(mhz) ? Math.max(0, Math.round(mhz)) : 0
      return next
    })
    setDirty(true)
  }, [])

  const setPowerValue = useCallback((index: number, value: number) => {
    setDraft((current) => {
      if (!current) return current
      const level = current.powerLevels[index]
      if (!level) return current
      const next = cloneVtxTable(current)
      next.powerLevels[index].value = Number.isFinite(value) ? Math.max(0, Math.min(0xffff, Math.round(value))) : 0
      return next
    })
    setDirty(true)
  }, [])

  const setPowerLabel = useCallback((index: number, label: string) => {
    setDraft((current) => {
      if (!current) return current
      const level = current.powerLevels[index]
      if (!level) return current
      const next = cloneVtxTable(current)
      // The firmware stores a 3-char fixed-width label; keep the edit within that.
      next.powerLevels[index].label = label.slice(0, 3)
      return next
    })
    setDirty(true)
  }, [])

  const loadTable = useCallback((table: VtxTable) => {
    setDraft(cloneVtxTable(table))
    setDirty(true)
    setError(undefined)
  }, [])

  const reset = useCallback(() => {
    setDraft(detected ? cloneVtxTable(detected) : undefined)
    setDirty(false)
    setError(undefined)
  }, [detected])

  const reload = useCallback(() => {
    setLoadToken((token) => token + 1)
  }, [])

  const save = useCallback(() => {
    if (!runtime || !draft || saving) return
    setSaving(true)
    setError(undefined)
    void runtime
      .writeVtxTable(draft)
      .then(() => {
        setDetected(cloneVtxTable(draft))
        setDirty(false)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Failed to write the VTX table.')
      })
      .finally(() => setSaving(false))
  }, [runtime, draft, saving])

  return {
    status,
    table: draft,
    detected,
    dirty,
    saving,
    error,
    setFrequency,
    setPowerValue,
    setPowerLabel,
    loadTable,
    save,
    reset,
    reload
  }
}
