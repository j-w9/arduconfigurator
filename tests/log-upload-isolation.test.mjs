// The log-upload feature stays self-contained.
//
// It talks to a server the OPERATOR runs, at an address they type in, under
// their own account. It is not a component of anything else in this app, and it
// must not become one — a shared helper today is a shared blast radius later.
//
// The check is structural rather than a promise in a comment: it reads the
// actual imports of every file in the feature and of everything that imports it,
// and fails if either side reaches somewhere it should not.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WEB_SRC = path.join(ROOT, '..', 'apps', 'web', 'src')

/** Every file that makes up the log-upload feature. */
const FEATURE_FILES = [
  'log-upload/client.ts',
  'log-upload/session-storage.ts',
  'hooks/use-log-upload.ts',
  'views/LogServerPanel.tsx',
  'view-models/log-upload-form.ts'
]

/**
 * What the feature is allowed to import: itself, the workspace packages any view
 * uses, and React. Anything else is a new coupling and should be a deliberate
 * decision rather than something that arrives unnoticed in a refactor.
 */
const ALLOWED_IMPORT = /^(react$|@arduconfig\/|\.\.?\/(log-upload|view-models\/log-upload-form|hooks\/use-log-upload)|\.\/)/

/** Files that are expected to consume the feature. */
/*
 * Who may talk to the operator's log server.
 *
 * This was the Logs surface alone. It widened deliberately when config uploads
 * arrived: a parameter backup, preset library or snapshot library can be filed
 * beside the flights it produced, which is the entire point — "the tune changed
 * and the next flight oscillated" needs both halves in one place. Those surfaces
 * reuse the session the Logs tab established rather than asking for credentials
 * again.
 *
 * The rule still bites: everything here reaches the server through
 * log-upload/client, and anything NOT on this list importing it is still a
 * failure. Widening the boundary is a decision recorded here, not a drift.
 */
const EXPECTED_CONSUMERS = new Set([
  'App.tsx',
  'sections/LogsSection.tsx',
  // Config-artifact uploads, all going through the one shared hook.
  'hooks/use-artifact-upload.ts',
  'hooks/use-parameter-backup-io.ts',
  'hooks/use-snapshot-library.ts',
  'sections/PresetsSection.tsx',
  'views/UploadToLogServerButton.tsx',
  'views/Presets.tsx'
])

test('the log-upload feature exists where the guard expects it', () => {
  // Otherwise a rename would silently turn this whole file into a no-op that
  // keeps passing while guarding nothing.
  for (const relative of FEATURE_FILES) {
    assert.ok(statSync(path.join(WEB_SRC, relative)).isFile(), `${relative} should exist`)
  }
})

test('the feature imports only itself, workspace packages and React', () => {
  const offenders = []
  for (const relative of FEATURE_FILES) {
    const source = readFileSync(path.join(WEB_SRC, relative), 'utf8')
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      if (!ALLOWED_IMPORT.test(match[1])) {
        offenders.push(`${relative} imports ${match[1]}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'the log-upload feature reached outside its own boundary')
})

test('only the Logs surface consumes the feature', () => {
  // The other direction. If something unrelated starts importing the upload
  // client, the two are coupled whatever the comments say.
  const consumers = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      // A test importing the feature is testing it, not coupling to it. The
      // rule is about production code growing a dependency.
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      const relative = path.relative(WEB_SRC, full)
      if (FEATURE_FILES.includes(relative)) continue
      const source = readFileSync(full, 'utf8')
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        if (/log-upload|use-log-upload|LogServerPanel/.test(match[1])) {
          consumers.push(relative)
        }
      }
    }
  }
  walk(WEB_SRC)

  const unexpected = [...new Set(consumers)].filter((file) => !EXPECTED_CONSUMERS.has(file))
  assert.deepEqual(unexpected, [], 'something outside the Logs surface started importing the upload feature')
})

test('the upload client holds no credentials of its own', () => {
  // The password is passed in, used once and dropped. Nothing in the feature
  // should ever write it down — session-storage.ts persists the address, the
  // username and a token, and that list should stay closed.
  const storage = readFileSync(path.join(WEB_SRC, 'log-upload/session-storage.ts'), 'utf8')
  assert.ok(!/password/i.test(storage.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    'session-storage must not touch a password outside its comments')
})
