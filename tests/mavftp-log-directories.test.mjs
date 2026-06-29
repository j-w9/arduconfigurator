import { test } from 'node:test'
import assert from 'node:assert/strict'

import { listMavftpLogFiles, MAVFTP_LOG_DIRECTORIES } from '@arduconfig/ardupilot-core'

const file = (name, path) => ({ name, path, kind: 'file', sizeBytes: 100 })
const dir = (name, path) => ({ name, path, kind: 'directory' })

test('probes /APM/LOGS first (hardware)', async () => {
  assert.deepEqual([...MAVFTP_LOG_DIRECTORIES], ['/APM/LOGS', '/logs'])
  const seen = []
  const result = await listMavftpLogFiles(async (path) => {
    seen.push(path)
    if (path === '/APM/LOGS') return [file('1.BIN', '/APM/LOGS/1.BIN')]
    throw new Error('should not reach /logs')
  })
  assert.deepEqual(seen, ['/APM/LOGS'])
  assert.equal(result.length, 1)
  assert.equal(result[0].path, '/APM/LOGS/1.BIN')
})

test('falls back to /logs when /APM/LOGS is absent (SITL)', async () => {
  const seen = []
  const result = await listMavftpLogFiles(async (path) => {
    seen.push(path)
    if (path === '/APM/LOGS') throw new Error('FileNotFound')
    return [file('2.BIN', '/logs/2.BIN')]
  })
  assert.deepEqual(seen, ['/APM/LOGS', '/logs'])
  assert.equal(result.length, 1)
  assert.equal(result[0].path, '/logs/2.BIN')
})

test('falls back to /logs when /APM/LOGS exists but has no log files', async () => {
  const result = await listMavftpLogFiles(async (path) =>
    path === '/APM/LOGS' ? [dir('sub', '/APM/LOGS/sub')] : [file('3.BIN', '/logs/3.BIN')]
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].path, '/logs/3.BIN')
})

test('returns [] (not throw) when every candidate is empty', async () => {
  const result = await listMavftpLogFiles(async () => [])
  assert.deepEqual(result, [])
})

test('rethrows the first error when every candidate errors (dead link surfaces)', async () => {
  await assert.rejects(
    listMavftpLogFiles(async (path) => {
      throw new Error(`link down at ${path}`)
    }),
    /link down at \/APM\/LOGS/
  )
})

test('filters out directories, keeping only files', async () => {
  const result = await listMavftpLogFiles(async () => [
    dir('sub', '/APM/LOGS/sub'),
    file('a.BIN', '/APM/LOGS/a.BIN')
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'a.BIN')
})
