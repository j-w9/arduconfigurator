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
  },
  // Native UDP/TCP socket bridge. The renderer constructs a DesktopSocketTransport
  // that drives a main-process UdpTransport/TcpTransport over these channels.
  socket: {
    open: (id: string, options: SocketOpenOptions) =>
      ipcRenderer.invoke('desktop:socket:open', id, options) as Promise<void>,
    send: (id: string, frame: Uint8Array) => ipcRenderer.invoke('desktop:socket:send', id, frame) as Promise<void>,
    close: (id: string) => ipcRenderer.invoke('desktop:socket:close', id) as Promise<void>,
    subscribe: (
      id: string,
      onFrame: (frame: Uint8Array) => void,
      onStatus: (status: unknown) => void
    ): (() => void) => {
      const frameHandler = (_event: unknown, socketId: string, frame: Uint8Array) => {
        if (socketId === id) {
          onFrame(frame)
        }
      }
      const statusHandler = (_event: unknown, socketId: string, status: unknown) => {
        if (socketId === id) {
          onStatus(status)
        }
      }
      ipcRenderer.on('desktop:socket:frame', frameHandler)
      ipcRenderer.on('desktop:socket:status', statusHandler)
      return () => {
        ipcRenderer.removeListener('desktop:socket:frame', frameHandler)
        ipcRenderer.removeListener('desktop:socket:status', statusHandler)
      }
    }
  }
})

interface SocketOpenOptions {
  kind: 'udp' | 'tcp'
  localPort?: number
  remoteHost?: string
  remotePort?: number
}
