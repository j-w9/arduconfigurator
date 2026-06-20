// Snapshot library management, extracted from App.tsx as part of its
// decomposition. Owns the snapshot CRUD + import/export I/O: capture a live
// snapshot, import a snapshot/library file (browser or desktop shell), export
// the local library / a selected snapshot (browser download or desktop shell),
// save the desktop-linked library, delete, and toggle deletion protection.
//
// Scope boundary: this is the snapshot *storage* subsystem only. The two
// parameter-editor-integration handlers — handleStageSelectedSnapshotDiff and
// handleApplySelectedSnapshotRestore — stay in App.tsx, because they reach into
// navigation (setActiveViewId / setSelectedParameterId), the shared draft-apply
// handler, the restore-acknowledgement state, and the derived restore-diff
// memos. Likewise the trivial handleOpenSnapshotImport (a one-line .click() on
// an App-owned <input> ref) stays in App.tsx.
//
// Behavior-neutral lift of the original App() functions — same logic, same
// notice copy, same analytics events, same non-memoized identities. The two
// internal helpers (clearDesktopSnapshotLibraryLink, applyParsedSnapshotImport)
// are private to the hook; nothing outside the moved handlers referenced them.

import type { ChangeEvent, Dispatch, SetStateAction } from 'react'

import {
  createParameterBackup,
  createParameterSnapshotLibrary,
  parseParameterSnapshotInput,
  serializeParameterBackup,
  serializeParameterSnapshotLibrary,
  type ConfiguratorSnapshot
} from '@arduconfig/ardupilot-core'

import { trackAppEvent } from '../analytics'
import type { ArduconfigDesktopBridge } from '../desktop-bridge'
import { downloadTextFile } from '../download-file'
import {
  buildSnapshotFilename,
  buildSnapshotLibraryFilename,
  mergeSavedSnapshots,
  parseSnapshotTags,
  updateSavedSnapshot
} from '../library-helpers'
import { createSavedSnapshot, type SavedParameterSnapshot } from '../snapshot-library'
import type { ParameterNotice } from './use-parameter-feedback'

export interface UseSnapshotLibraryParams {
  snapshot: ConfiguratorSnapshot
  desktopBridge: ArduconfigDesktopBridge | undefined
  selectedSnapshot: SavedParameterSnapshot | undefined
  savedSnapshots: SavedParameterSnapshot[]
  setSavedSnapshots: Dispatch<SetStateAction<SavedParameterSnapshot[]>>
  setSelectedSnapshotId: Dispatch<SetStateAction<string | undefined>>
  snapshotLabelInput: string
  setSnapshotLabelInput: Dispatch<SetStateAction<string>>
  snapshotNoteInput: string
  setSnapshotNoteInput: Dispatch<SetStateAction<string>>
  snapshotTagsInput: string
  setSnapshotTagsInput: Dispatch<SetStateAction<string>>
  snapshotProtectedInput: boolean
  setSnapshotProtectedInput: Dispatch<SetStateAction<boolean>>
  desktopSnapshotLibraryPath: string | undefined
  setDesktopSnapshotLibraryPath: Dispatch<SetStateAction<string | undefined>>
  desktopSnapshotLibraryName: string | undefined
  setDesktopSnapshotLibraryName: Dispatch<SetStateAction<string | undefined>>
  setSnapshotNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
}

export interface UseSnapshotLibraryResult {
  handleCaptureLiveSnapshot: () => void
  handleImportSnapshotFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleExportSnapshotLibrary: () => void
  handleOpenDesktopSnapshotFile: () => Promise<void>
  handleSaveDesktopSnapshotLibrary: () => Promise<void>
  handleExportSelectedSnapshotToDesktop: () => Promise<void>
  handleExportSelectedSnapshot: () => void
  handleDeleteSelectedSnapshot: () => void
  handleToggleSelectedSnapshotProtection: () => void
}

export function useSnapshotLibrary({
  snapshot,
  desktopBridge,
  selectedSnapshot,
  savedSnapshots,
  setSavedSnapshots,
  setSelectedSnapshotId,
  snapshotLabelInput,
  setSnapshotLabelInput,
  snapshotNoteInput,
  setSnapshotNoteInput,
  snapshotTagsInput,
  setSnapshotTagsInput,
  snapshotProtectedInput,
  setSnapshotProtectedInput,
  desktopSnapshotLibraryPath,
  setDesktopSnapshotLibraryPath,
  desktopSnapshotLibraryName,
  setDesktopSnapshotLibraryName,
  setSnapshotNotice
}: UseSnapshotLibraryParams): UseSnapshotLibraryResult {
  function clearDesktopSnapshotLibraryLink(): void {
    setDesktopSnapshotLibraryPath(undefined)
    setDesktopSnapshotLibraryName(undefined)
  }

  function applyParsedSnapshotImport(
    parsedInput: ReturnType<typeof parseParameterSnapshotInput>,
    fileNameHint?: string,
    mode: 'merge' | 'replace' = 'merge'
  ): void {
    if (parsedInput.kind === 'library') {
      const importedSnapshots = parsedInput.library.snapshots
      setSavedSnapshots((current) => (mode === 'replace' ? importedSnapshots : mergeSavedSnapshots(current, importedSnapshots)))
      setSelectedSnapshotId(importedSnapshots[0]?.id)
      setSnapshotNotice({
        tone: 'success',
        text:
          mode === 'replace'
            ? `Opened ${importedSnapshots.length} snapshot(s) from desktop library "${parsedInput.library.name}".`
            : `Imported ${importedSnapshots.length} snapshot(s) from library "${parsedInput.library.name}".`
      })
      return
    }

    const backup = parsedInput.backup
    const savedSnapshot = createSavedSnapshot(backup, snapshotLabelInput || fileNameHint?.replace(/\.[^.]+$/, ''), 'imported', {
      note: snapshotNoteInput,
      tags: parseSnapshotTags(snapshotTagsInput),
      protected: snapshotProtectedInput
    })
    setSavedSnapshots((current) => [savedSnapshot, ...current.filter((entry) => entry.id !== savedSnapshot.id)])
    setSelectedSnapshotId(savedSnapshot.id)
    setSnapshotLabelInput('')
    setSnapshotNoteInput('')
    setSnapshotTagsInput('')
    setSnapshotProtectedInput(false)
    setSnapshotNotice({
      tone: 'success',
      text: `Imported snapshot "${savedSnapshot.label}" with ${backup.parameterCount} parameters.`
    })
  }

  function handleCaptureLiveSnapshot(): void {
    if (snapshot.parameters.length === 0) {
      setSnapshotNotice({
        tone: 'warning',
        text: 'Pull parameters before capturing a snapshot.'
      })
      return
    }

    const backup = createParameterBackup(snapshot)
    const savedSnapshot = createSavedSnapshot(backup, snapshotLabelInput, 'captured', {
      note: snapshotNoteInput,
      tags: parseSnapshotTags(snapshotTagsInput),
      protected: snapshotProtectedInput
    })
    setSavedSnapshots((current) => [savedSnapshot, ...current.filter((entry) => entry.id !== savedSnapshot.id)])
    setSelectedSnapshotId(savedSnapshot.id)
    setSnapshotLabelInput('')
    setSnapshotNoteInput('')
    setSnapshotTagsInput('')
    setSnapshotProtectedInput(false)
    setSnapshotNotice({
      tone: 'success',
      text: `Saved snapshot "${savedSnapshot.label}" with ${backup.parameterCount} parameters.`
    })
    trackAppEvent('Snapshot Captured', {
      parameterCount: backup.parameterCount,
      protected: snapshotProtectedInput
    })
  }

  async function handleImportSnapshotFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      clearDesktopSnapshotLibraryLink()
      applyParsedSnapshotImport(parseParameterSnapshotInput(await file.text()), file.name)
    } catch (error) {
      setSnapshotNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to import snapshot or library file.'
      })
    } finally {
      event.target.value = ''
    }
  }

  function handleExportSnapshotLibrary(): void {
    const library = createParameterSnapshotLibrary('Browser Local Snapshot Library', savedSnapshots)
    downloadTextFile(buildSnapshotLibraryFilename(), serializeParameterSnapshotLibrary(library))
    setSnapshotNotice({
      tone: 'success',
      text: `Exported snapshot library with ${library.snapshots.length} saved snapshot(s).`
    })
  }

  async function handleOpenDesktopSnapshotFile(): Promise<void> {
    if (!desktopBridge) {
      return
    }

    try {
      const file = await desktopBridge.openSnapshotFile()
      if (!file) {
        return
      }

      const parsedInput = parseParameterSnapshotInput(file.contents)
      if (parsedInput.kind === 'library') {
        setDesktopSnapshotLibraryPath(file.path)
        setDesktopSnapshotLibraryName(parsedInput.library.name || file.name)
      } else {
        clearDesktopSnapshotLibraryLink()
      }

      applyParsedSnapshotImport(parsedInput, file.name, parsedInput.kind === 'library' ? 'replace' : 'merge')
    } catch (error) {
      setSnapshotNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to open a desktop snapshot file.'
      })
    }
  }

  async function handleSaveDesktopSnapshotLibrary(): Promise<void> {
    if (!desktopBridge) {
      return
    }

    try {
      const library = createParameterSnapshotLibrary(desktopSnapshotLibraryName || 'Desktop Snapshot Library', savedSnapshots)
      const savedFile = await desktopBridge.saveSnapshotLibrary({
        title: desktopSnapshotLibraryPath ? 'Save Snapshot Library' : 'Save Snapshot Library As',
        suggestedName: buildSnapshotLibraryFilename(),
        contents: serializeParameterSnapshotLibrary(library),
        existingPath: desktopSnapshotLibraryPath
      })
      if (!savedFile) {
        return
      }

      setDesktopSnapshotLibraryPath(savedFile.path)
      setDesktopSnapshotLibraryName(library.name)
      setSnapshotNotice({
        tone: 'success',
        text: `Saved snapshot library to ${savedFile.name}.`
      })
    } catch (error) {
      setSnapshotNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to save the desktop snapshot library.'
      })
    }
  }

  async function handleExportSelectedSnapshotToDesktop(): Promise<void> {
    if (!desktopBridge || !selectedSnapshot) {
      return
    }

    try {
      const savedFile = await desktopBridge.saveSnapshotBackup({
        title: 'Export Selected Snapshot',
        suggestedName: buildSnapshotFilename(selectedSnapshot),
        contents: serializeParameterBackup(selectedSnapshot.backup)
      })
      if (!savedFile) {
        return
      }

      setSnapshotNotice({
        tone: 'success',
        text: `Exported snapshot "${selectedSnapshot.label}" to ${savedFile.name}.`
      })
    } catch (error) {
      setSnapshotNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to export the selected snapshot to the desktop shell.'
      })
    }
  }

  function handleExportSelectedSnapshot(): void {
    if (!selectedSnapshot) {
      return
    }

    downloadTextFile(buildSnapshotFilename(selectedSnapshot), serializeParameterBackup(selectedSnapshot.backup))
    setSnapshotNotice({
      tone: 'success',
      text: `Exported snapshot "${selectedSnapshot.label}".`
    })
  }

  function handleDeleteSelectedSnapshot(): void {
    if (!selectedSnapshot) {
      return
    }

    if (selectedSnapshot.protected) {
      setSnapshotNotice({
        tone: 'warning',
        text: `Snapshot "${selectedSnapshot.label}" is protected. Unprotect it before deleting it from the active library.`
      })
      return
    }

    setSavedSnapshots((current) => current.filter((entry) => entry.id !== selectedSnapshot.id))
    setSnapshotNotice({
      tone: 'neutral',
      text: `Deleted snapshot "${selectedSnapshot.label}" from the local browser library.`
    })
  }

  function handleToggleSelectedSnapshotProtection(): void {
    if (!selectedSnapshot) {
      return
    }

    const nextProtected = !selectedSnapshot.protected
    setSavedSnapshots((current) =>
      updateSavedSnapshot(current, selectedSnapshot.id, (savedSnapshot) => ({
        ...savedSnapshot,
        protected: nextProtected
      }))
    )
    setSnapshotNotice({
      tone: 'success',
      text: nextProtected
        ? `Snapshot "${selectedSnapshot.label}" is now protected against deletion.`
        : `Snapshot "${selectedSnapshot.label}" is no longer protected.`
    })
  }

  return {
    handleCaptureLiveSnapshot,
    handleImportSnapshotFile,
    handleExportSnapshotLibrary,
    handleOpenDesktopSnapshotFile,
    handleSaveDesktopSnapshotLibrary,
    handleExportSelectedSnapshotToDesktop,
    handleExportSelectedSnapshot,
    handleDeleteSelectedSnapshot,
    handleToggleSelectedSnapshotProtection
  }
}
