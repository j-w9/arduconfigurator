import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface HostedWebUi {
  url: string
  close(): Promise<void>
}

export async function startHostedWebUi(): Promise<HostedWebUi> {
  const webDistDir = await resolveWebDistDir()
  const indexPath = path.join(webDistDir, 'index.html')

  await access(indexPath)

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(webDistDir, request, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown web host error.'
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(message)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine hosted web UI address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
  }
}

async function resolveWebDistDir(): Promise<string> {
  const candidates: string[] = []

  // Packaged Electron app: web assets ship under process.resourcesPath/web/dist
  // via electron-builder's extraResources mapping.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    candidates.push(path.join(resourcesPath, 'web', 'dist'))
  }

  // Development / monorepo layout: ../../web/dist relative to this compiled file
  // (apps/desktop/dist/web-ui-server.js -> apps/web/dist).
  candidates.push(fileURLToPath(new URL('../../web/dist', import.meta.url)))

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'index.html'))
      return candidate
    } catch {
      // Try next candidate.
    }
  }

  // Fall back to the dev path so the caller surfaces a clear ENOENT.
  return candidates[candidates.length - 1]
}

async function handleRequest(webDistDir: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestPath = sanitizeRequestPath(request.url ?? '/')
  const candidatePath = path.resolve(webDistDir, `.${requestPath}`)
  // Boundary must include the separator: a bare startsWith(webDistDir)
  // also matches a sibling like `${webDistDir}-secrets/…`.
  const withinDist = candidatePath === webDistDir || candidatePath.startsWith(webDistDir + path.sep)
  const targetPath = withinDist ? candidatePath : path.join(webDistDir, 'index.html')

  const filePath = await resolveAssetPath(webDistDir, targetPath)
  const body = await readFile(filePath)
  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    // Same validated policy the hosted web build ships via _headers:
    // script-src 'self' (no inline/eval), with the allowances the app needs
    // — WebSocket transport, three.js GLTF data: buffers, the OpenStreetMap
    // map iframe, OpenStreetMap raster tiles for the no-GPS calibration map
    // picker (img-src), and inline <style> for dynamic widget sizing.
    'content-security-policy':
      "default-src 'self'; script-src 'self'; connect-src 'self' ws: wss: data:; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; frame-src https://www.openstreetmap.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff'
  })
  response.end(body)
}

async function resolveAssetPath(webDistDir: string, requestedPath: string): Promise<string> {
  try {
    await access(requestedPath)
    return requestedPath
  } catch {
    return path.join(webDistDir, 'index.html')
  }
}

function sanitizeRequestPath(url: string): string {
  const parsed = new URL(url, 'http://127.0.0.1')
  if (parsed.pathname === '/' || parsed.pathname.length === 0) {
    return '/index.html'
  }

  return parsed.pathname
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.ico':
      return 'image/x-icon'
    case '.map':
      return 'application/json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}
