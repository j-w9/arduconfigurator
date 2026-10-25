#!/usr/bin/env node
// Generate packages/protocol-mavlink/src/generated/mavlink-generic.ts — the
// decode-only message table behind the codec's generic path — from ArduPilot's
// MAVLink XML definitions (ardupilotmega.xml and everything it includes).
//
// Run manually after updating the ArduPilot checkout:
//   node scripts/generate-mavlink-generic.mjs [path/to/message_definitions/v1.0]
// (default: ~/ardupilot/modules/mavlink/message_definitions/v1.0, or
// $MAVLINK_XML_DIR).
//
// crc_extra and wire order are computed exactly as pymavlink's mavgen does,
// and the script refuses to write anything unless its crc_extra reproduces
// every hand-entered value in MAVLINK_MESSAGE_CRCS (constants.ts).
//
// The XML is regular enough for a hand-rolled reader — no deps.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const XML_DIR = resolve(
  process.argv[2] ?? process.env.MAVLINK_XML_DIR ?? join(homedir(), 'ardupilot/modules/mavlink/message_definitions/v1.0')
)
const ROOT_DIALECT = 'ardupilotmega.xml'
// Not included by ardupilotmega, so never emitted — read only to check the
// crc routine against the hand-entered AVAILABLE_MODES values.
const VERIFY_ONLY_DIALECTS = ['development.xml']
const CONSTANTS_FILE = join(REPO_ROOT, 'packages/protocol-mavlink/src/constants.ts')
const OUT_FILE = join(REPO_ROOT, 'packages/protocol-mavlink/src/generated/mavlink-generic.ts')

// Wire type -> [compact code, byte size]. uint8_t_mavlink_version is a
// uint8_t on the wire and in the crc.
const TYPES = {
  double: ['d', 8],
  uint64_t: ['Q', 8],
  int64_t: ['q', 8],
  float: ['f', 4],
  uint32_t: ['I', 4],
  int32_t: ['i', 4],
  uint16_t: ['H', 2],
  int16_t: ['h', 2],
  uint8_t: ['B', 1],
  int8_t: ['b', 1],
  char: ['c', 1]
}

function fail(message) {
  console.error(`generate-mavlink-generic: ${message}`)
  process.exit(1)
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return match ? match[1] : undefined
}

function parseDialect(file) {
  const path = join(XML_DIR, file)
  if (!existsSync(path)) fail(`missing ${path}`)
  const xml = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const includes = [...xml.matchAll(/<include>\s*([^<\s]+)\s*<\/include>/g)].map((m) => m[1])
  const messages = []
  for (const match of xml.matchAll(/<message\b([^>]*)>([\s\S]*?)<\/message>/g)) {
    const id = Number(attr(match[1], 'id'))
    const name = attr(match[1], 'name')
    if (!Number.isInteger(id) || !name) fail(`${file}: bad <message${match[1]}>`)
    const fields = []
    let extension = false
    for (const token of match[2].matchAll(/<extensions\s*\/>|<field\b([^>]*?)\/?>/g)) {
      if (token[0].startsWith('<extensions')) {
        extension = true
        continue
      }
      const rawType = attr(token[1], 'type')
      const fieldName = attr(token[1], 'name')
      if (!rawType || !fieldName) fail(`${file} ${name}: bad <field${token[1]}>`)
      const array = /^([a-z0-9_]+)\[(\d+)\]$/.exec(rawType)
      let type = array ? array[1] : rawType
      if (type === 'uint8_t_mavlink_version') type = 'uint8_t'
      if (!TYPES[type]) fail(`${file} ${name}.${fieldName}: unknown type ${rawType}`)
      fields.push({ name: fieldName, type, length: array ? Number(array[2]) : 0, extension })
    }
    messages.push({ id, name, fields, file })
  }
  return { includes, messages }
}

// Depth-first over <include>s, each dialect once — the order mavgen merges in.
function loadDialects(root) {
  const seen = new Set()
  const files = []
  const messages = []
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const dialect = parseDialect(file)
    dialect.includes.forEach(visit)
    files.push(file)
    messages.push(...dialect.messages)
  }
  visit(root)
  return { files, messages }
}

// CRC-16/MCRF4XX (X.25), as mavcrc.x25crc.
function crcAccumulate(byte, crc) {
  let tmp = byte ^ (crc & 0xff)
  tmp = (tmp ^ (tmp << 4)) & 0xff
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

function crcString(text, crc) {
  for (const byte of Buffer.from(text, 'ascii')) crc = crcAccumulate(byte, crc)
  return crc
}

// mavgen: base fields stable-sorted by type size (descending), extensions
// appended in declaration order.
function wireOrder(fields) {
  const base = fields.filter((f) => !f.extension)
  const ext = fields.filter((f) => f.extension)
  const sorted = base
    .map((field, index) => ({ field, index }))
    .sort((a, b) => TYPES[b.field.type][1] - TYPES[a.field.type][1] || a.index - b.index)
    .map(({ field }) => field)
  return [...sorted, ...ext]
}

function crcExtra(message) {
  let crc = crcString(`${message.name} `, 0xffff)
  for (const field of wireOrder(message.fields)) {
    if (field.extension) continue
    crc = crcString(`${field.type} `, crc)
    crc = crcString(`${field.name} `, crc)
    if (field.length) crc = crcAccumulate(field.length, crc)
  }
  return (crc & 0xff) ^ (crc >> 8)
}

// Hand-entered values from constants.ts, by message id.
function readExistingCrcs() {
  const source = readFileSync(CONSTANTS_FILE, 'utf8')
  const idsBlock = /export const MAVLINK_MESSAGE_IDS = \{([\s\S]*?)\} as const/.exec(source)
  const crcBlock = /export const MAVLINK_MESSAGE_CRCS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!idsBlock || !crcBlock) fail('cannot find MAVLINK_MESSAGE_IDS / MAVLINK_MESSAGE_CRCS in constants.ts')
  const ids = Object.fromEntries([...idsBlock[1].matchAll(/^\s*([A-Z0-9_]+):\s*(\d+)/gm)].map((m) => [m[1], Number(m[2])]))
  const crcs = new Map()
  for (const match of crcBlock[1].matchAll(/\[MAVLINK_MESSAGE_IDS\.([A-Z0-9_]+)\]:\s*(\d+)/g)) {
    if (ids[match[1]] === undefined) fail(`constants.ts: unknown id name ${match[1]}`)
    crcs.set(ids[match[1]], { name: match[1], crc: Number(match[2]) })
  }
  if (crcs.size < 30) fail(`only parsed ${crcs.size} MAVLINK_MESSAGE_CRCS entries — parser out of date?`)
  return crcs
}

const { files, messages } = loadDialects(ROOT_DIALECT)
const byId = new Map()
for (const message of messages) {
  if (byId.has(message.id)) {
    const first = byId.get(message.id)
    fail(`duplicate message id ${message.id}: ${first.name} (${first.file}) and ${message.name} (${message.file})`)
  }
  byId.set(message.id, message)
}

const verifyOnly = new Map()
for (const file of VERIFY_ONLY_DIALECTS) {
  for (const message of parseDialect(file).messages) {
    if (!byId.has(message.id)) verifyOnly.set(message.id, message)
  }
}

const mismatches = []
let checked = 0
for (const [id, { name, crc }] of readExistingCrcs()) {
  const message = byId.get(id) ?? verifyOnly.get(id)
  if (!message) {
    mismatches.push(`${name} (${id}): not found in any dialect read`)
    continue
  }
  const computed = crcExtra(message)
  checked += 1
  if (computed !== crc) mismatches.push(`${name} (${id}): constants.ts has ${crc}, computed ${computed}`)
}
if (mismatches.length > 0) fail(`crc_extra check failed:\n  ${mismatches.join('\n  ')}`)

const rows = [...byId.values()]
  .sort((a, b) => a.id - b.id)
  .map((message) => {
    const ordered = wireOrder(message.fields)
    const encode = (f) => `${f.name}:${TYPES[f.type][0]}${f.length || ''}`
    const base = ordered.filter((f) => !f.extension).map(encode).join(',')
    const ext = ordered.filter((f) => f.extension).map(encode).join(',')
    return `  [${message.id},'${message.name}',${crcExtra(message)},'${ext ? `${base}|${ext}` : base}']`
  })

const header = `// GENERATED by scripts/generate-mavlink-generic.mjs — do not edit by hand.
//
// Source: ArduPilot's MAVLink message definitions (modules/mavlink,
// message_definitions/v1.0), ${ROOT_DIALECT} and the dialects it includes:
//   ${files.join(', ')}
// The MAVLink XML definitions are MIT-licensed (mavlink/mavlink); code
// generated from them by mavgen is offered under LGPL. This table is a
// derived data extract (ids, names, crc_extra, field layout), carried here
// under the project's GPL-3.0-only licence with that provenance noted.
//
// Row: [id, name, crc_extra, fields]. fields lists the wire order
// (non-extension fields stable-sorted by type size, then extensions after
// '|') as name:<code><array length?>. Codes: d double, f float, Q uint64,
// q int64, I uint32, i int32, H uint16, h int16, B uint8, b int8, c char.
// crc_extra was checked against every MAVLINK_MESSAGE_CRCS entry (${checked}).
`

const out = `${header}
export type MavlinkGenericRow = readonly [id: number, name: string, crcExtra: number, fields: string]

export const MAVLINK_GENERIC_ROWS: readonly MavlinkGenericRow[] = [
${rows.join(',\n')}
]
`

mkdirSync(dirname(OUT_FILE), { recursive: true })
writeFileSync(OUT_FILE, out)
console.log(`wrote ${OUT_FILE}: ${rows.length} messages, ${Buffer.byteLength(out)} bytes; crc_extra matched ${checked} existing entries`)
