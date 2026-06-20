// Verify the service-worker source enforces the manual-update protocol:
//
//   1. install does NOT call skipWaiting() unconditionally — a new SW
//      stays in `waiting` until the client opts in.
//   2. A message handler calls skipWaiting() ONLY when the client posts
//      { type: 'SKIP_WAITING' }.
//   3. activate still calls clients.claim() so once the user opts in,
//      the SW takes control of this page and controllerchange fires.
//
// Runs against the SOURCE at apps/web/public/sw.js (not the built dist)
// since these are protocol invariants, not build-time substitutions.
//
// A failure here means either someone re-introduced auto-activation
// (breaking the opt-in prompt) or removed the SKIP_WAITING handler
// (leaving the prompt with no way to apply).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const swSourcePath = fileURLToPath(new URL('../apps/web/public/sw.js', import.meta.url))

test('PWA SW: install handler does NOT auto-skipWaiting (manual opt-in protocol)', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  const installBlock = extractListenerBlock(source, 'install')
  assert.ok(installBlock, 'expected an install event listener in sw.js')
  assert.doesNotMatch(
    installBlock,
    /self\.skipWaiting\(\)/,
    'install handler must not call skipWaiting() — that would re-introduce silent auto-activation'
  )
})

test('PWA SW: message handler calls skipWaiting() on SKIP_WAITING', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  const messageBlock = extractListenerBlock(source, 'message')
  assert.ok(messageBlock, 'expected a message event listener in sw.js for SKIP_WAITING')
  assert.match(
    messageBlock,
    /['"]SKIP_WAITING['"]/,
    "message handler must reference the 'SKIP_WAITING' type"
  )
  assert.match(
    messageBlock,
    /self\.skipWaiting\(\)/,
    'message handler must call skipWaiting() so the new SW can take over'
  )
})

test('PWA SW: activate handler still calls clients.claim()', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  const activateBlock = extractListenerBlock(source, 'activate')
  assert.ok(activateBlock, 'expected an activate event listener in sw.js')
  assert.match(
    activateBlock,
    /self\.clients\.claim\(\)/,
    'activate must clients.claim() so the newly-activated SW controls the live page (fires controllerchange in clients)'
  )
})

test('PWA SW: skipWaiting is gated — the ONLY call site is the message handler', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  // Strip line comments so a "// self.skipWaiting()" in prose doesn't
  // count toward the call-site total.
  const code = source.replace(/\/\/[^\n]*/g, '')
  const occurrences = code.match(/self\.skipWaiting\s*\(\s*\)/g) ?? []
  assert.equal(
    occurrences.length,
    1,
    `skipWaiting() should appear exactly once (gated behind SKIP_WAITING), found ${occurrences.length}`
  )
})

const swUpdatePath = fileURLToPath(new URL('../apps/web/src/sw-update.ts', import.meta.url))

test('PWA SW-update (audit-37): offer() always publishes a fresh apply (no early-return on "available")', () => {
  // Background: a NEW SW arriving while a previous one is in `waiting`
  // supersedes that previous worker — the prior waiting worker is moved
  // to `redundant` and discarded (W3C ServiceWorker spec, Install algo).
  // If offer() early-returns when the bus is already `available`, the
  // cached apply closure still references the now-redundant worker and
  // a banner click is a silent no-op (postMessage to a redundant worker
  // is dropped). offer() MUST overwrite the closure on every fresh
  // install so apply targets the live waiting worker.
  const source = readFileSync(swUpdatePath, 'utf8')
  const offerBlock = extractFunctionBlock(source, 'function offer(')
  assert.ok(offerBlock, 'expected offer() function in sw-update.ts')
  assert.doesNotMatch(
    offerBlock,
    /if\s*\(\s*bus\.state\.kind\s*===\s*['"]available['"]\s*\)\s*return/,
    "offer() must not early-return when bus.state.kind === 'available' — a cascade deploy would leave apply tied to a now-redundant worker"
  )
  assert.match(
    offerBlock,
    /publish\(\s*\{\s*kind:\s*['"]available['"]/,
    'offer() must publish an `available` state with the fresh apply closure'
  )
})

function extractFunctionBlock(source, opener) {
  const start = source.indexOf(opener)
  if (start === -1) return undefined
  const bodyStart = source.indexOf('{', start)
  if (bodyStart === -1) return undefined
  let depth = 0
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(bodyStart + 1, i)
    }
  }
  return undefined
}

function extractListenerBlock(source, eventName) {
  // Find `self.addEventListener('<eventName>', (event) => { ... })` and
  // return the body between the matching braces. Brace-counts the body
  // so nested closures don't truncate the match.
  const opener = `self.addEventListener('${eventName}'`
  const start = source.indexOf(opener)
  if (start === -1) return undefined
  // Locate the first `{` after the opener — that's the listener body.
  const bodyStart = source.indexOf('{', start)
  if (bodyStart === -1) return undefined
  let depth = 0
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(bodyStart + 1, i)
    }
  }
  return undefined
}
