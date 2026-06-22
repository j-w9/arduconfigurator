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

export interface DesktopSocketOpenOptions {
  kind: 'udp' | 'tcp'
  /** UDP bound/listen: local port to bind. */
  localPort?: number
  /** UDP connected / TCP: fixed remote endpoint. */
  remoteHost?: string
  remotePort?: number
}

export interface DesktopSocketApi {
  open(id: string, options: DesktopSocketOpenOptions): Promise<void>
  send(id: string, frame: Uint8Array): Promise<void>
  close(id: string): Promise<void>
  subscribe(id: string, onFrame: (frame: Uint8Array) => void, onStatus: (status: unknown) => void): () => void
}

export interface ArduconfigDesktopBridge {
  readonly platform: 'electron'
  openSnapshotFile(): Promise<DesktopOpenedTextFile | undefined>
  saveSnapshotLibrary(request: DesktopSaveTextFileRequest): Promise<DesktopSavedTextFile | undefined>
  saveSnapshotBackup(request: DesktopSaveTextFileRequest): Promise<DesktopSavedTextFile | undefined>
  /** Native UDP/TCP sockets — present only in the desktop app. */
  socket?: DesktopSocketApi
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

/** True only in the desktop app, where native UDP/TCP sockets are available. */
export function desktopSocketsSupported(): boolean {
  return getDesktopBridge()?.socket !== undefined
}
