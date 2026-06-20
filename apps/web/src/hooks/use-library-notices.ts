// Library-import / export feedback state, extracted from App.tsx as
// another slice of its decomposition. Six tightly cohesive useState
// hooks the Snapshots / Presets / Library views share: per-library
// ParameterNotice banners (snapshot, provisioning, tuning-profile,
// preset, session) plus a "noticesCopied" sticky flag that lets the
// next render re-show a notice after a clipboard copy.
//
// Behavior-neutral lift — identical setters, same shapes, same
// `undefined` defaults; the consuming JSX destructures these names
// directly off the hook return so no call sites change.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { ParameterNotice } from './use-parameter-feedback'

export interface UseLibraryNoticesResult {
  /** Snapshot-tab import / restore / export status banner. */
  snapshotNotice: ParameterNotice | undefined
  setSnapshotNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  /** Provisioning-library import / restore / export status banner. */
  provisioningNotice: ParameterNotice | undefined
  setProvisioningNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  /** Tuning-profile library import / restore status banner. */
  tuningProfileNotice: ParameterNotice | undefined
  setTuningProfileNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  /** Preset import / apply / capture status banner. */
  presetNotice: ParameterNotice | undefined
  setPresetNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  /** Session-level (cross-library) status banner. */
  sessionNotice: ParameterNotice | undefined
  setSessionNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
  /**
   * Sticky flag set after a notice's "Copy details" button — keeps the
   * "copied" state visible until a new notice replaces it (clearing on
   * notice change is the consumer's responsibility, same as before).
   */
  noticesCopied: boolean
  setNoticesCopied: Dispatch<SetStateAction<boolean>>
}

export function useLibraryNotices(): UseLibraryNoticesResult {
  const [snapshotNotice, setSnapshotNotice] = useState<ParameterNotice | undefined>()
  const [provisioningNotice, setProvisioningNotice] = useState<ParameterNotice | undefined>()
  const [tuningProfileNotice, setTuningProfileNotice] = useState<ParameterNotice | undefined>()
  const [presetNotice, setPresetNotice] = useState<ParameterNotice | undefined>()
  const [sessionNotice, setSessionNotice] = useState<ParameterNotice | undefined>()
  const [noticesCopied, setNoticesCopied] = useState(false)

  return {
    snapshotNotice,
    setSnapshotNotice,
    provisioningNotice,
    setProvisioningNotice,
    tuningProfileNotice,
    setTuningProfileNotice,
    presetNotice,
    setPresetNotice,
    sessionNotice,
    setSessionNotice,
    noticesCopied,
    setNoticesCopied
  }
}
