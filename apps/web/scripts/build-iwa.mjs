// Packages the built web bundle (apps/web/dist) into a signed Isolated Web App
// (.swbn). An IWA is the only context where the Direct Sockets API (raw
// UDP/TCP, used by the "UDP (direct)" transport) is exposed, so this is what a
// user installs to connect to a MAVLink link without the desktop bridge.
//
// Prereq: `npm run build --workspace @arduconfig/web` (produces dist/).
// Output: apps/web/dist-iwa/arduconfigurator.swbn  (+ prints the Web Bundle ID).
//
// The Ed25519 signing key lives at apps/web/iwa/signing-key.pem and is
// gitignored — it is generated on first run for local/dev signing. A real
// release would sign with a stable, securely-stored key (the Web Bundle ID,
// and thus the app's origin, is derived from it).

import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BundleBuilder } from 'wbn'
import { IntegrityBlockSigner, NodeCryptoSigningStrategy, WebBundleId, parsePemKey } from 'wbn-sign'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const distDir = join(webRoot, 'dist')
const keyPath = join(webRoot, 'iwa', 'signing-key.pem')
const outDir = join(webRoot, 'dist-iwa')
const outFile = join(outDir, 'arduconfigurator.swbn')

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain'
}

function loadOrCreateKey() {
  if (existsSync(keyPath)) {
    return parsePemKey(readFileSync(keyPath))
  }
  console.log('[iwa] no signing key found — generating a dev Ed25519 key at iwa/signing-key.pem')
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  mkdirSync(dirname(keyPath), { recursive: true })
  writeFileSync(keyPath, pem)
  return parsePemKey(Buffer.from(pem))
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

// IWA manifest = the existing PWA manifest plus the IWA-required fields and the
// direct-sockets permission. Augmented at packaging time so the normal web
// build (and its served manifest) stay untouched.
function buildIwaManifest() {
  const base = JSON.parse(readFileSync(join(distDir, 'manifest.webmanifest'), 'utf8'))
  return JSON.stringify(
    {
      ...base,
      id: '/',
      version: '1.0.0',
      // Direct Sockets is gated behind this permission inside the IWA.
      permissions_policy: {
        'direct-sockets': ['self']
      }
    },
    null,
    2
  )
}

async function main() {
  if (!existsSync(distDir)) {
    throw new Error('apps/web/dist not found — run `npm run build --workspace @arduconfig/web` first.')
  }

  const privateKey = loadOrCreateKey()
  const publicKey = createPublicKey(privateKey)
  const webBundleId = new WebBundleId(publicKey)
  const origin = webBundleId.serializeWithIsolatedWebAppOrigin().replace(/\/$/, '')

  const builder = new BundleBuilder()
  builder.setPrimaryURL(`${origin}/`)

  const iwaManifest = buildIwaManifest()
  for (const file of walk(distDir)) {
    const rel = relative(distDir, file).split('\\').join('/')
    const url = `${origin}/${rel}`
    const contentType = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const body =
      rel === 'manifest.webmanifest' ? Buffer.from(iwaManifest) : readFileSync(file)
    builder.addExchange(url, 200, { 'Content-Type': contentType }, body)
    // index.html doubles as the directory root.
    if (rel === 'index.html') {
      builder.addExchange(`${origin}/`, 200, { 'Content-Type': 'text/html' }, body)
    }
  }

  const webBundle = builder.createBundle()
  const signer = new IntegrityBlockSigner(webBundle, webBundleId.serialize(), [
    new NodeCryptoSigningStrategy(privateKey)
  ])
  const signed = await signer.sign()
  const signedWebBundle = signed.signedWebBundle ?? signed

  mkdirSync(outDir, { recursive: true })
  writeFileSync(outFile, Buffer.from(signedWebBundle))

  console.log('[iwa] Web Bundle ID:', webBundleId.serialize())
  console.log('[iwa] Isolated-app origin:', `${origin}/`)
  console.log('[iwa] Wrote', relative(webRoot, outFile), `(${Buffer.from(signedWebBundle).length} bytes)`)
}

main().catch((error) => {
  console.error('[iwa]', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
