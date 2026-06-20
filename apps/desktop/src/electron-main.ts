import { basename, resolve, sep } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type { VehicleType } from '@arduconfig/firmware-flash'

import { createDesktopWebPreferences } from './electron-window-options.js'
import { listBoardFirmware, downloadFirmwareApj } from './firmware-fetch.js'
import { desktopPlatformManifest } from './platform.js'
import { confinedExistingPath } from './save-path.js'
import { startHostedWebUi, type HostedWebUi } from './web-ui-server.js'

const DESKTOP_DEV_SERVER_URL = process.env.ARDUCONFIG_DESKTOP_DEV_SERVER_URL
const DESKTOP_DEVTOOLS = process.env.ARDUCONFIG_DESKTOP_DEVTOOLS === '1'
const PRELOAD_PATH = fileURLToPath(new URL('./preload.js', import.meta.url))

let hostedWebUi: HostedWebUi | undefined

app.name = 'ArduConfigurator'

void app.whenReady().then(async () => {
  registerDesktopSnapshotFileHandlers()
  registerDesktopFirmwareHandlers()
  hostedWebUi = DESKTOP_DEV_SERVER_URL ? undefined : await startHostedWebUi()
  await createMainWindow(hostedWebUi?.url ?? DESKTOP_DEV_SERVER_URL ?? 'http://127.0.0.1:4173')

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow(hostedWebUi?.url ?? DESKTOP_DEV_SERVER_URL ?? 'http://127.0.0.1:4173')
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void hostedWebUi?.close().catch(() => {})
})

async function createMainWindow(startUrl: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: 'ArduConfigurator',
    autoHideMenuBar: true,
    backgroundColor: '#0b1014',
    webPreferences: createDesktopWebPreferences(PRELOAD_PATH)
  })

  configurePermissions(window)

  const appOrigin = (() => {
    try {
      return new URL(startUrl).origin
    } catch {
      return undefined
    }
  })()

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand http(s) to the OS. Without a scheme allow-list, content
    // (a future XSS, or proxy/manifest-driven markup) could open
    // file:// / smb:// / ms-msdt: / custom-protocol URLs — a classic
    // Electron openExternal → local-code/protocol-handler abuse vector.
    let scheme = ''
    try {
      scheme = new URL(url).protocol
    } catch {
      scheme = ''
    }
    if (scheme === 'https:' || scheme === 'http:') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Keep the main window pinned to the trusted loopback origin. A
  // top-level navigation away (JS sets location, a proxy/manifest
  // redirect) would otherwise host arbitrary content while the
  // preload bridge (snapshot open/save) is still exposed to it.
  const blockOffOriginNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (!appOrigin) {
      return
    }
    let targetOrigin: string | undefined
    try {
      targetOrigin = new URL(url).origin
    } catch {
      targetOrigin = undefined
    }
    if (targetOrigin !== appOrigin) {
      event.preventDefault()
    }
  }
  window.webContents.on('will-navigate', (event, url) => blockOffOriginNavigation(event, url))
  window.webContents.on('will-redirect', (event, url) => blockOffOriginNavigation(event, url))

  await window.loadURL(startUrl)
  window.setTitle(`ArduConfigurator Desktop (${desktopPlatformManifest.intent})`)

  if (DESKTOP_DEVTOOLS) {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  return window
}

function configurePermissions(window: BrowserWindow): void {
  const allowedOriginPrefixes = ['http://127.0.0.1:', 'http://localhost:']

  window.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'serial') {
      return isAllowedOrigin(requestingOrigin, allowedOriginPrefixes)
    }

    return false
  })

  window.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'serial') {
      return false
    }

    return isAllowedOrigin(details.origin, allowedOriginPrefixes)
  })
}

function isAllowedOrigin(origin: string, allowedOriginPrefixes: string[]): boolean {
  return allowedOriginPrefixes.some((prefix) => origin.startsWith(prefix))
}

function registerDesktopSnapshotFileHandlers(): void {
  ipcMain.handle('desktop:snapshots:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Snapshot or Library',
      properties: ['openFile'],
      filters: [
        { name: 'JSON files', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    const targetPath = result.filePaths[0]
    return {
      path: targetPath,
      name: basename(targetPath),
      contents: await readFile(targetPath, 'utf8')
    }
  })

  ipcMain.handle('desktop:snapshots:save-library', async (_event, request: DesktopSaveFileRequest) =>
    saveTextFileWithDialog(request, 'arduconfig-snapshot-library.json')
  )
  ipcMain.handle('desktop:snapshots:save-backup', async (_event, request: DesktopSaveFileRequest) =>
    saveTextFileWithDialog(request, 'arduconfig-snapshot.json')
  )
}

function registerDesktopFirmwareHandlers(): void {
  // The desktop main process can reach firmware.ardupilot.org directly (no
  // CORS), so it serves the renderer a board-filtered firmware list + the
  // chosen .apj bytes — the browser can't do either.
  ipcMain.handle('desktop:firmware:list', async (_event, boardId: number, vehicletype?: string) =>
    listBoardFirmware(boardId, vehicletype as VehicleType | undefined)
  )
  ipcMain.handle('desktop:firmware:download', async (_event, url: string) => downloadFirmwareApj(url))
}

interface DesktopSaveFileRequest {
  title: string
  suggestedName: string
  contents: string
  existingPath?: string
}

// Resolve symlinks on an already path-confined target and re-check it stays
// within the allowed roots, so a symlink planted inside Documents can't
// redirect a re-save outside them. A path that doesn't exist yet has no
// symlink to resolve and passes through unchanged.
function realpathConfined(target: string | undefined, roots: string[]): string | undefined {
  if (!target) {
    return undefined
  }
  let real: string
  try {
    real = realpathSync(target)
  } catch {
    return target
  }
  const confined = roots.some((root) => {
    const base = resolve(root)
    return real === base || real.startsWith(base + sep)
  })
  return confined ? real : undefined
}

async function saveTextFileWithDialog(
  request: DesktopSaveFileRequest,
  fallbackName: string
): Promise<{ path: string; name: string } | undefined> {
  const roots = [app.getPath('documents'), app.getPath('userData')]
  const targetPath =
    realpathConfined(confinedExistingPath(request.existingPath, roots), roots) ||
    (
      await dialog.showSaveDialog({
        title: request.title,
        defaultPath: request.suggestedName.trim() || fallbackName,
        filters: [
          { name: 'JSON files', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    ).filePath

  if (!targetPath) {
    return undefined
  }

  await writeFile(targetPath, request.contents, 'utf8')
  return {
    path: targetPath,
    name: basename(targetPath)
  }
}
