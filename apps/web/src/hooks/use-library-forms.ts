import { useState, type Dispatch, type SetStateAction } from 'react'

/** Where a saved tuning profile draws its values from. */
export type TuningProfileSourceMode = 'live' | 'staged'

/** Where a saved provisioning profile draws its parameter set from. */
export type ProvisioningProfileSourceMode = 'selected-snapshot' | 'live-controller'

/** Default pre-flight checklist seeded into a new provisioning profile. */
export const DEFAULT_PROVISIONING_CHECKLIST_LINES = [
  'Motor order verified on the bench.',
  'Receiver inputs respond on the expected channels.',
  'Attitude and sensor telemetry look sane.',
  'Failsafe behavior was reviewed for the mission profile.',
  'Profile-specific payload and OSD settings were confirmed.'
] as const

export interface LibraryForms {
  snapshotLabelInput: string
  setSnapshotLabelInput: Dispatch<SetStateAction<string>>
  snapshotNoteInput: string
  setSnapshotNoteInput: Dispatch<SetStateAction<string>>
  snapshotTagsInput: string
  setSnapshotTagsInput: Dispatch<SetStateAction<string>>
  snapshotProtectedInput: boolean
  setSnapshotProtectedInput: Dispatch<SetStateAction<boolean>>

  provisioningProfileLabelInput: string
  setProvisioningProfileLabelInput: Dispatch<SetStateAction<string>>
  provisioningProfileModelInput: string
  setProvisioningProfileModelInput: Dispatch<SetStateAction<string>>
  provisioningProfileFleetInput: string
  setProvisioningProfileFleetInput: Dispatch<SetStateAction<string>>
  provisioningProfileMissionInput: string
  setProvisioningProfileMissionInput: Dispatch<SetStateAction<string>>
  provisioningProfileNoteInput: string
  setProvisioningProfileNoteInput: Dispatch<SetStateAction<string>>
  provisioningProfileTagsInput: string
  setProvisioningProfileTagsInput: Dispatch<SetStateAction<string>>
  provisioningProfileChecklistInput: string
  setProvisioningProfileChecklistInput: Dispatch<SetStateAction<string>>
  provisioningProfileProtectedInput: boolean
  setProvisioningProfileProtectedInput: Dispatch<SetStateAction<boolean>>
  provisioningProfileSourceInput: ProvisioningProfileSourceMode
  setProvisioningProfileSourceInput: Dispatch<SetStateAction<ProvisioningProfileSourceMode>>
  includeDraftOverlayInProvisioningProfile: boolean
  setIncludeDraftOverlayInProvisioningProfile: Dispatch<SetStateAction<boolean>>

  tuningProfileLabelInput: string
  setTuningProfileLabelInput: Dispatch<SetStateAction<string>>
  tuningProfileNoteInput: string
  setTuningProfileNoteInput: Dispatch<SetStateAction<string>>
  tuningProfileProtectedInput: boolean
  setTuningProfileProtectedInput: Dispatch<SetStateAction<boolean>>
  tuningProfileSourceInput: TuningProfileSourceMode
  setTuningProfileSourceInput: Dispatch<SetStateAction<TuningProfileSourceMode>>
}

/**
 * Owns the save-form draft fields for the three browser libraries
 * (snapshot / provisioning profile / tuning profile) extracted from
 * App.tsx. Pure form input state — no protocol coupling — so this is a
 * verbatim state move with identical initial values and setter
 * semantics; the save/reset handlers stay in App and call the returned
 * setters unchanged.
 *
 * The two source-mode unions and the default-checklist constant move
 * here with the state that uses them and are re-exported for the App
 * handlers / JSX that still reference them.
 */
export function useLibraryForms(): LibraryForms {
  const [snapshotLabelInput, setSnapshotLabelInput] = useState('')
  const [snapshotNoteInput, setSnapshotNoteInput] = useState('')
  const [snapshotTagsInput, setSnapshotTagsInput] = useState('')
  const [snapshotProtectedInput, setSnapshotProtectedInput] = useState(false)
  const [provisioningProfileLabelInput, setProvisioningProfileLabelInput] = useState('')
  const [provisioningProfileModelInput, setProvisioningProfileModelInput] = useState('')
  const [provisioningProfileFleetInput, setProvisioningProfileFleetInput] = useState('')
  const [provisioningProfileMissionInput, setProvisioningProfileMissionInput] = useState('')
  const [provisioningProfileNoteInput, setProvisioningProfileNoteInput] = useState('')
  const [provisioningProfileTagsInput, setProvisioningProfileTagsInput] = useState('')
  const [provisioningProfileChecklistInput, setProvisioningProfileChecklistInput] = useState(
    DEFAULT_PROVISIONING_CHECKLIST_LINES.join('\n')
  )
  const [provisioningProfileProtectedInput, setProvisioningProfileProtectedInput] = useState(false)
  const [provisioningProfileSourceInput, setProvisioningProfileSourceInput] =
    useState<ProvisioningProfileSourceMode>('selected-snapshot')
  const [includeDraftOverlayInProvisioningProfile, setIncludeDraftOverlayInProvisioningProfile] =
    useState(false)
  const [tuningProfileLabelInput, setTuningProfileLabelInput] = useState('')
  const [tuningProfileNoteInput, setTuningProfileNoteInput] = useState('')
  const [tuningProfileProtectedInput, setTuningProfileProtectedInput] = useState(false)
  const [tuningProfileSourceInput, setTuningProfileSourceInput] =
    useState<TuningProfileSourceMode>('staged')

  return {
    snapshotLabelInput,
    setSnapshotLabelInput,
    snapshotNoteInput,
    setSnapshotNoteInput,
    snapshotTagsInput,
    setSnapshotTagsInput,
    snapshotProtectedInput,
    setSnapshotProtectedInput,
    provisioningProfileLabelInput,
    setProvisioningProfileLabelInput,
    provisioningProfileModelInput,
    setProvisioningProfileModelInput,
    provisioningProfileFleetInput,
    setProvisioningProfileFleetInput,
    provisioningProfileMissionInput,
    setProvisioningProfileMissionInput,
    provisioningProfileNoteInput,
    setProvisioningProfileNoteInput,
    provisioningProfileTagsInput,
    setProvisioningProfileTagsInput,
    provisioningProfileChecklistInput,
    setProvisioningProfileChecklistInput,
    provisioningProfileProtectedInput,
    setProvisioningProfileProtectedInput,
    provisioningProfileSourceInput,
    setProvisioningProfileSourceInput,
    includeDraftOverlayInProvisioningProfile,
    setIncludeDraftOverlayInProvisioningProfile,
    tuningProfileLabelInput,
    setTuningProfileLabelInput,
    tuningProfileNoteInput,
    setTuningProfileNoteInput,
    tuningProfileProtectedInput,
    setTuningProfileProtectedInput,
    tuningProfileSourceInput,
    setTuningProfileSourceInput
  }
}
