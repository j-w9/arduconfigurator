#!/usr/bin/env node
// Does a DFU (.hex) flash keep its pace when the operator switches tabs?
//
// Field report (Matek H743, 2026-10): on the tab, a flash finished in about
// two minutes; off it, it crawled (11%, then 30% minutes later) and sped up
// again on return. Chrome throttles a hidden tab's timers -- roughly one wake
// a second, and after five minutes hidden one a minute.
//
// Playwright cannot show this: it keeps every page it drives focused and
// visible, even a background tab in a minimised window. So this launches a
// plain Chrome and drives it over the raw DevTools protocol, flashes a fake
// STM32 DFU board (tests/e2e/support/fake-dfu.ts) once with the tab in front
// and once behind another tab, and compares the times. The fake board answers
// at once and keeps its own time, so the only timers in play are the app's.
//
//   npm run build --workspace @arduconfig/web
//   node scripts/dfu-background-check.mjs [--kb=128] [--transfer=1024] [--program-ms=5] [--erase-ms=50]
//
// --kb=1706 is the field report's image; past five minutes hidden it also
// shows Chrome's harsher throttling. Exits 1 when the hidden flash is more than
// twice as slow as the front one. Needs Google Chrome.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { fakeDfuInit, fakeDfuOptions, intelHexImage } from '../tests/e2e/support/fake-dfu.ts'

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const imageKb = arg('kb', 128)
const device = fakeDfuOptions({ transferSize: arg('transfer', 1024), programMs: arg('program-ms', 5), eraseMs: arg('erase-ms', 50) })
const previewPort = arg('port', 4290)
const debugPort = arg('debug-port', 9340)

const chromePath =
  process.env.ARDUCONFIG_E2E_BROWSER ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((path) => existsSync(path))
if (!chromePath) {
  console.error('Google Chrome not found; set ARDUCONFIG_E2E_BROWSER.')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'dfu-background-'))
const hexPath = join(work, 'image.hex')
writeFileSync(hexPath, intelHexImage(imageKb * 1024))

const children = []
const cleanup = () => {
  for (const child of children) child.kill()
  // Chrome may still be writing its profile as it exits; a leftover temp dir is harmless.
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 })
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

async function waitFor(check, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check().catch(() => undefined)
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await delay(250)
  }
}

// The built web app, served by vite preview.
const preview = spawn('npm', ['run', 'preview', '--workspace', '@arduconfig/web', '--', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], { stdio: 'ignore' })
children.push(preview)
const appUrl = `http://127.0.0.1:${previewPort}/`
await waitFor(async () => (await fetch(appUrl)).ok, 'the preview server')

// A plain Chrome: no automation switches, so it throttles as it would for anyone.
const chrome = spawn(chromePath, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
children.push(chrome)
const devtools = `http://127.0.0.1:${debugPort}`
const tab = await waitFor(async () => (await (await fetch(`${devtools}/json`)).json()).find((target) => target.type === 'page'), 'Chrome')

const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let nextId = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(`${message.error.message}`))
  else waiter.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    socket.send(JSON.stringify({ id: nextId, method, params }))
  })
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const byTestId = (id) => `document.querySelector('[data-testid="${id}"]')`
const click = (id) => evaluate(`${byTestId(id)}.click(), true`)

await send('Page.enable')
await send('DOM.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fakeDfuInit.toString()})(${JSON.stringify(device)})` })

async function flash(hidden) {
  await send('Page.navigate', { url: appUrl })
  await waitFor(() => evaluate(`!!${byTestId('view-button-flash')}`), 'the app')
  await click('view-button-flash')
  await waitFor(() => evaluate(`!!${byTestId('flash-tab-dfu-hex')}`), 'the Flash tab')
  await click('flash-tab-dfu-hex')
  await waitFor(() => evaluate(`!!${byTestId('dfu-hex-file')}`), 'the DFU card')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-testid="dfu-hex-file"]' })
  await send('DOM.setFileInputFiles', { nodeId, files: [hexPath] })
  await waitFor(() => evaluate(`${byTestId('dfu-hex-flash')}?.disabled === false`), 'the parsed image')

  const started = Date.now()
  await click('dfu-hex-flash')
  let other
  if (hidden) {
    other = await (await fetch(`${devtools}/json/new?about:blank`, { method: 'PUT' })).json()
    await waitFor(async () => (await evaluate('document.visibilityState')) === 'hidden', 'the tab to hide', 10_000)
  }
  let lastReport = 0
  const outcome = await waitFor(
    async () => {
      const state = await evaluate(`({
        notice: ${byTestId('dfu-hex-notice')}?.textContent ?? null,
        error: ${byTestId('dfu-hex-error')}?.textContent ?? null,
        step: [...document.querySelectorAll('[data-testid^="dfu-hex-step-"]')].map((li) => li.textContent).join(' | ') +
          ' -- ' + (${byTestId('dfu-hex-progress-label')}?.textContent ?? ''),
        visibility: document.visibilityState
      })`)
      if (Date.now() - lastReport > arg('report-s', 15) * 1000) {
        lastReport = Date.now()
        console.log(`  ${Math.round((Date.now() - started) / 1000)} s [${state.visibility}] ${state.step}`)
      }
      return state.notice || state.error ? state : undefined
    },
    'the flash to finish',
    60 * 60_000
  )
  const seconds = (Date.now() - started) / 1000
  const visibility = await evaluate('document.visibilityState')
  const stats = await evaluate('window.__fakeDfu')
  if (other) await fetch(`${devtools}/json/close/${other.id}`)
  return { seconds, outcome, stats, visibility }
}

console.log(`image ${imageKb} KiB, transfer ${device.transferSize} B, program ${device.programMs} ms/block, erase ${device.eraseMs} ms/sector`)
console.log('tab in front:')
const front = await flash(false)
console.log(`  ${front.seconds.toFixed(1)} s`)
console.log('tab behind another tab:')
const back = await flash(true)
console.log(`  ${back.seconds.toFixed(1)} s (tab ${back.visibility} at the end)`)

let failed = false
for (const [label, run] of [['front', front], ['background', back]]) {
  if (run.outcome.error || !/Flashed and verified/.test(run.outcome.notice ?? '')) {
    console.log(`${label} flash did not finish cleanly: ${run.outcome.error ?? run.outcome.notice}`)
    failed = true
  }
  if (run.stats.refused > 0) {
    console.log(`${label}: the board refused ${run.stats.refused} download(s) sent while it was busy`)
    failed = true
  }
}
console.log(
  `background: ${back.stats.blocks} blocks, ${back.stats.earlyPolls} early polls, longest gap between transfers ${Math.round(back.stats.longestGapMs)} ms`
)
const ratio = back.seconds / front.seconds
console.log(`hidden / front = ${ratio.toFixed(1)}x`)
if (ratio > 2) {
  console.log('FAIL: the flash loses its pace in a background tab')
  failed = true
} else if (!failed) {
  console.log('PASS')
}
socket.close()
process.exit(failed ? 1 : 0)
