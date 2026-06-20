import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ParameterSyncWaiterSet,
  ParameterValueWaiterSet
} from '../packages/ardupilot-core/dist/runtime-parameter-waiters.js'

// ---------------------------------------------------------------------------
// ParameterValueWaiterSet
// ---------------------------------------------------------------------------

test('ParameterValueWaiterSet resolves when the matching PARAM_VALUE arrives', async () => {
  const set = new ParameterValueWaiterSet()
  const handle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 1000 })

  set.resolve({ id: 'THR_MIN', value: 1100 })
  const parameter = await handle.promise
  assert.equal(parameter.id, 'THR_MIN')
  assert.equal(parameter.value, 1100)
  assert.equal(set.size, 0, 'set should drain after a successful resolve')
})

test('ParameterValueWaiterSet honours the float tolerance', async () => {
  // 0.05 ± 0.0001 should match 0.0500001 (float32 round-trip noise) but
  // NOT match 0.06.
  const set = new ParameterValueWaiterSet()
  const handle = set.add('PSC_VELXY_P', 0.05, { verifyTimeoutMs: 1000, tolerance: 0.0001 })

  set.resolve({ id: 'PSC_VELXY_P', value: 0.0500001 })
  const parameter = await handle.promise
  assert.ok(Math.abs(parameter.value - 0.05) < 1e-5)
})

test('ParameterValueWaiterSet ignores PARAM_VALUE for the wrong paramId', async () => {
  const set = new ParameterValueWaiterSet()
  const handle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 100 })

  set.resolve({ id: 'NOT_THR_MIN', value: 1100 })
  assert.equal(set.size, 1, 'waiter for wrong-paramId resolve should stay in the set')

  await assert.rejects(() => handle.promise, /Timed out waiting for THR_MIN/)
  assert.equal(set.size, 0, 'timeout cleans the waiter')
})

test('ParameterValueWaiterSet ignores PARAM_VALUE outside tolerance', async () => {
  const set = new ParameterValueWaiterSet()
  const handle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 100, tolerance: 0.5 })

  set.resolve({ id: 'THR_MIN', value: 1200 })
  await assert.rejects(() => handle.promise, /Timed out waiting for THR_MIN/)
})

test('ParameterValueWaiterSet supports concurrent waiters on different paramIds', async () => {
  const set = new ParameterValueWaiterSet()
  const throttle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 1000 })
  const yaw = set.add('ATC_RAT_YAW_P', 0.18, { verifyTimeoutMs: 1000 })
  assert.equal(set.size, 2)

  set.resolve({ id: 'THR_MIN', value: 1100 })
  const throttleResult = await throttle.promise
  assert.equal(throttleResult.value, 1100)
  assert.equal(set.size, 1, 'yaw waiter should still be pending')

  set.resolve({ id: 'ATC_RAT_YAW_P', value: 0.18 })
  const yawResult = await yaw.promise
  assert.equal(yawResult.value, 0.18)
  assert.equal(set.size, 0)
})

test('ParameterValueWaiterSet cancel() rejects the promise + drains the waiter', async () => {
  const set = new ParameterValueWaiterSet()
  const handle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 10000 })

  handle.cancel(new Error('vehicle disconnected'))
  await assert.rejects(() => handle.promise, /vehicle disconnected/)
  assert.equal(set.size, 0)
})

test('ParameterValueWaiterSet cancel() is a no-op if already resolved', async () => {
  const set = new ParameterValueWaiterSet()
  const handle = set.add('THR_MIN', 1100, { verifyTimeoutMs: 1000 })

  set.resolve({ id: 'THR_MIN', value: 1100 })
  await handle.promise

  // Second cancel after resolve should not throw or affect anything.
  handle.cancel(new Error('late cancel'))
  assert.equal(set.size, 0)
})

test('ParameterValueWaiterSet rejectAll() drains every pending waiter', async () => {
  const set = new ParameterValueWaiterSet()
  const a = set.add('THR_MIN', 1100, { verifyTimeoutMs: 10000 })
  const b = set.add('THR_MAX', 1900, { verifyTimeoutMs: 10000 })
  assert.equal(set.size, 2)

  set.rejectAll(new Error('link lost'))
  await assert.rejects(() => a.promise, /link lost/)
  await assert.rejects(() => b.promise, /link lost/)
  assert.equal(set.size, 0)
})

// ---------------------------------------------------------------------------
// ParameterSyncWaiterSet
// ---------------------------------------------------------------------------

test('ParameterSyncWaiterSet resolves all waiters when sync completes', async () => {
  const set = new ParameterSyncWaiterSet()
  const a = set.add(1000)
  const b = set.add(1000)
  assert.equal(set.size, 2)

  const stats = {
    downloaded: 1500,
    total: 1500,
    duplicateFrames: 3,
    status: 'complete',
    progress: 1,
    requestedAtMs: 100
  }
  set.resolveAll(stats)

  const [aResult, bResult] = await Promise.all([a, b])
  assert.equal(aResult.downloaded, 1500)
  assert.equal(bResult.status, 'complete')
  assert.equal(set.size, 0)
})

test('ParameterSyncWaiterSet rejects all waiters on rejectAll', async () => {
  const set = new ParameterSyncWaiterSet()
  const a = set.add(10000)
  const b = set.add(10000)
  set.rejectAll(new Error('link lost mid-sync'))

  await assert.rejects(() => a, /link lost mid-sync/)
  await assert.rejects(() => b, /link lost mid-sync/)
  assert.equal(set.size, 0)
})

test('ParameterSyncWaiterSet times out individual waiters without blocking others', async () => {
  const set = new ParameterSyncWaiterSet()
  const shortLived = set.add(50)

  await assert.rejects(() => shortLived, /Timed out waiting for parameter sync/)
  assert.equal(set.size, 0)
})

test('ParameterSyncWaiterSet treats the timeout as an idle window — noteProgress re-arms it', async () => {
  const set = new ParameterSyncWaiterSet()
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const idleMs = 100
  const synced = set.add(idleMs)

  // Stream "progress" every 30ms for 180ms — aggregate elapsed is well past
  // the 100ms idle window, but no single gap reaches it. An absolute-budget
  // timeout would have rejected ~100ms in; the idle timer keeps re-arming.
  for (let i = 0; i < 6; i += 1) {
    await delay(30)
    set.noteProgress()
  }
  assert.equal(set.size, 1) // still pending — slow-but-steady sync did not time out

  set.resolveAll({
    downloaded: 1083,
    total: 1083,
    duplicateFrames: 20,
    status: 'complete',
    progress: 1,
    requestedAtMs: 0
  })
  const stats = await synced
  assert.equal(stats.downloaded, 1083)
  assert.equal(set.size, 0)
})

test('ParameterSyncWaiterSet still times out a genuine stall (no progress within the idle window)', async () => {
  const set = new ParameterSyncWaiterSet()
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const stalled = set.add(40)

  // One early progress tick, then silence — the re-armed timer must still fire.
  set.noteProgress()
  await delay(10)
  set.noteProgress()

  await assert.rejects(() => stalled, /no progress for 40ms/)
  assert.equal(set.size, 0)
})
