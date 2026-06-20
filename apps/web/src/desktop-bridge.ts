export interface DesktopOpenedTextFile {
  path: string
  name: string
  contents: string
}

export interface DesktopSavedTextFile {
  path: string
  name: string
}

export interface DesktopSaveTextFileRequest {
  title: string
  suggestedName: string
  contents: string
  existingPath?: string
}

export interface ArduconfigDesktopBridge {
  readonly platform: 'electron'
  openSnapshotFile(): Promise<DesktopOpenedTextFile | undefined>
  saveSnapshotLibrary(request: DesktopSaveTextFileRequest): Promise<DesktopSavedTextFile | undefined>
  saveSnapshotBackup(request: DesktopSaveTextFileRequest): Promise<DesktopSavedTextFile | undefined>
}

declare global {
  interface Window {
    arduconfigDesktop?: ArduconfigDesktopBridge
  }
}

export function getDesktopBridge(): ArduconfigDesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.arduconfigDesktop
}
