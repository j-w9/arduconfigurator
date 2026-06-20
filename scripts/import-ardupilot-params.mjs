#!/usr/bin/env node
// Auto-import ArduPilot upstream parameter metadata.
//
// Fetches the official per-vehicle parameter definitions (apm.pdef.json) from
// autotest.ardupilot.org and transforms them into the compact UpstreamParameter
// shape (see packages/param-metadata/src/upstream.ts), writing one committed
// JSON file per vehicle under apps/web/src/generated/param-upstream/.
//
// The web app lazy-loads the file for the connected vehicle and merges it under
// the hand-authored catalog (mergeUpstreamParameters), so curated params keep
// their UX while the full ArduPilot parameter tree gains real labels,
// descriptions, ranges, value/bitmask options, and units.
//
// Re-run to refresh from upstream:
//   node scripts/import-ardupilot-params.mjs
//
// Source data is CC-BY / GPL ArduPilot project metadata.

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCES = {
  arducopter: 'https://autotest.ardupilot.org/Parameters/Copter/apm.pdef.json',
  arduplane: 'https://autotest.ardupilot.org/Parameters/Plane/apm.pdef.json',
  ardurover: 'https://autotest.ardupilot.org/Parameters/Rover/apm.pdef.json',
  ardusub: 'https://autotest.ardupilot.org/Parameters/Sub/apm.pdef.json'
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'apps', 'web', 'src', 'generated', 'param-upstream')

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

// Values / Bitmask maps come as { "0": "Label", ... }. Turn them into the
// app's ParameterValueOption[] (value = numeric key, label = text). For a
// bitmask the "value" is the bit index, matching ScopedBitmaskField.
function toOptions(map) {
  if (!map || typeof map !== 'object') return undefined
  const options = Object.entries(map)
    .map(([key, label]) => ({ value: Number(key), label: String(label) }))
    .filter((option) => Number.isFinite(option.value) && option.label.length > 0)
    .sort((a, b) => a.value - b.value)
  return options.length > 0 ? options : undefined
}

function transformParameter(meta) {
  if (!meta || typeof meta !== 'object') return undefined
  const entry = {}
  if (meta.DisplayName) entry.label = String(meta.DisplayName)
  if (meta.Description) entry.description = String(meta.Description)
  if (meta.Units) entry.unit = String(meta.Units)

  if (meta.Range && typeof meta.Range === 'object') {
    const low = toNumber(meta.Range.low)
    const high = toNumber(meta.Range.high)
    if (low !== undefined) entry.minimum = low
    if (high !== undefined) entry.maximum = high
  }

  const bitmaskOptions = toOptions(meta.Bitmask)
  if (bitmaskOptions) {
    entry.options = bitmaskOptions
    entry.bitmask = true
  } else {
    const valueOptions = toOptions(meta.Values)
    if (valueOptions) entry.options = valueOptions
  }

  if (meta.RebootRequired && String(meta.RebootRequired).toLowerCase() === 'true') {
    entry.rebootRequired = true
  }

  // Skip params with no enrichment at all — they'd add bytes without value.
  return Object.keys(entry).length > 0 ? entry : undefined
}

function transformBundle(raw) {
  const out = {}
  for (const group of Object.values(raw)) {
    if (!group || typeof group !== 'object') continue
    for (const [name, meta] of Object.entries(group)) {
      const entry = transformParameter(meta)
      if (entry) out[name] = entry
    }
  }
  // Stable key order for clean diffs.
  return Object.fromEntries(Object.keys(out).sort().map((key) => [key, out[key]]))
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const summary = []
  for (const [vehicle, url] of Object.entries(SOURCES)) {
    process.stdout.write(`Fetching ${vehicle} from ${url} ... `)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
    }
    const raw = await response.json()
    const transformed = transformBundle(raw)
    const file = join(outDir, `${vehicle}.json`)
    await writeFile(file, JSON.stringify(transformed) + '\n', 'utf8')
    const bytes = JSON.stringify(transformed).length
    summary.push({ vehicle, params: Object.keys(transformed).length, kb: Math.round(bytes / 1024) })
    process.stdout.write(`${Object.keys(transformed).length} params (${Math.round(bytes / 1024)} KB)\n`)
  }
  console.log('\nDone. Generated:')
  for (const row of summary) {
    console.log(`  ${row.vehicle.padEnd(12)} ${String(row.params).padStart(5)} params  ${row.kb} KB`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
