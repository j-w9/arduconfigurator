import { contextBridge, ipcRenderer } from 'electron'

interface DesktopOpenedTextFile {
  path: string
  name: string
  contents: string
}

interface DesktopSavedTextFile {
  path: string
  name: string
}

interface DesktopSaveTextFileRequest {
  title: string
  suggestedName: string
  contents: string
  existingPath?: string
}

contextBridge.exposeInMainWorld('arduconfigDesktop', {
  platform: 'electron' as const,
  openSnapshotFile: () => ipcRenderer.invoke('desktop:snapshots:open-file') as Promise<DesktopOpenedTextFile | undefined>,
  saveSnapshotLibrary: (request: DesktopSaveTextFileRequest) =>
    ipcRenderer.invoke('desktop:snapshots:save-library', request) as Promise<DesktopSavedTextFile | undefined>,
  saveSnapshotBackup: (request: DesktopSaveTextFileRequest) =>
    ipcRenderer.invoke('desktop:snapshots:save-backup', request) as Promise<DesktopSavedTextFile | undefined>,
  // Firmware fetch bridge — the main process reaches firmware.ardupilot.org
  // (no CORS) and returns a board-filtered list + the chosen .apj bytes.
  firmware: {
    list: (boardId: number, vehicletype?: string) =>
      ipcRenderer.invoke('desktop:firmware:list', boardId, vehicletype) as Promise<{
        releaseTypes: string[]
        entries: { boardId: number; vehicletype: string; releaseType: string; version: string; url: string; latest: boolean }[]
      }>,
    download: (url: string) => ipcRenderer.invoke('desktop:firmware:download', url) as Promise<Uint8Array>
  }
})
