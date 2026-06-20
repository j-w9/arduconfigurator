import assert from 'node:assert/strict'
import test from 'node:test'

import { confinedExistingPath } from '../apps/desktop/dist/save-path.js'

const ROOTS = ['/home/user/Documents', '/home/user/.config/ArduConfigurator']

test('confinedExistingPath: a .json inside an allowed root is honored', () => {
  assert.equal(
    confinedExistingPath('/home/user/Documents/snapshots/lib.json', ROOTS),
    '/home/user/Documents/snapshots/lib.json'
  )
  assert.equal(
    confinedExistingPath('/home/user/.config/ArduConfigurator/backup.json', ROOTS),
    '/home/user/.config/ArduConfigurator/backup.json'
  )
})

test('confinedExistingPath: arbitrary-write attempts are refused (→ dialog fallback)', () => {
  // outside any root
  assert.equal(confinedExistingPath('/home/user/.ssh/authorized_keys.json', ROOTS), undefined)
  // not .json (the real attack: overwrite an rc / key file)
  assert.equal(confinedExistingPath('/home/user/Documents/.zshrc', ROOTS), undefined)
  assert.equal(confinedExistingPath('/home/user/Documents/key', ROOTS), undefined)
  // path traversal back out of the root
  assert.equal(confinedExistingPath('/home/user/Documents/../.ssh/k.json', ROOTS), undefined)
  // sibling-dir prefix escape (the bare-startsWith bug)
  assert.equal(confinedExistingPath('/home/user/Documents-evil/x.json', ROOTS), undefined)
  // nothing supplied
  assert.equal(confinedExistingPath(undefined, ROOTS), undefined)
  assert.equal(confinedExistingPath('', ROOTS), undefined)
})
