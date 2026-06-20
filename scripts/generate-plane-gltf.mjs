#!/usr/bin/env node
// Generates apps/web/public/models/plane.gltf — a small, self-authored
// fixed-wing model for the Setup craft preview.
//
// The other models in that folder are copied from Betaflight Configurator
// (GPL-3.0, multirotors only). ArduPlane needs a plane, so this emits a
// real glTF 2.0 asset (boxes for fuselage / wing / tail / fin) from a
// deterministic script rather than vendoring an opaque binary. Re-run
// with `node scripts/generate-plane-gltf.mjs` after editing the boxes.
//
// Conventions match the procedural craft models: forward is -Z, up is +Y,
// span is X, and the asset is sized so the preview's fixed "betaflight"
// scale (x16.5) frames it like the copters (max dimension ~= 4.6 units).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', 'apps', 'web', 'public', 'models', 'plane.gltf')

// [centerX, centerY, centerZ, halfX, halfY, halfZ]
const BOXES = [
  [0, 0, 0, 0.18, 0.2, 1.6], // fuselage
  [0, 0, -1.74, 0.1, 0.12, 0.2], // nose
  [0, 0.18, -0.55, 0.14, 0.12, 0.36], // canopy
  [0, 0.02, -0.15, 2.3, 0.05, 0.42], // main wing
  [0, 0.02, 1.45, 0.95, 0.04, 0.28], // horizontal stabilizer
  [0, 0.28, 1.45, 0.045, 0.3, 0.3] // vertical fin
]

// Unit cube face data: 6 faces, each with an outward normal and the 4
// corner sign triplets in CCW winding (so triangles face outward).
const FACES = [
  { n: [1, 0, 0], c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], c: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], c: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] }
]

const positions = []
const normals = []
const indices = []

for (const [cx, cy, cz, hx, hy, hz] of BOXES) {
  for (const face of FACES) {
    const base = positions.length / 3
    for (const [sx, sy, sz] of face.c) {
      positions.push(cx + sx * hx, cy + sy * hy, cz + sz * hz)
      normals.push(...face.n)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

const posArray = new Float32Array(positions)
const normArray = new Float32Array(normals)
const idxArray = new Uint16Array(indices)

const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < posArray.length; i += 3) {
  for (let a = 0; a < 3; a += 1) {
    min[a] = Math.min(min[a], posArray[i + a])
    max[a] = Math.max(max[a], posArray[i + a])
  }
}

// Pack: positions, normals, then (4-byte aligned) indices.
const posBytes = posArray.byteLength
const normBytes = normArray.byteLength
const idxOffset = posBytes + normBytes
const idxBytes = idxArray.byteLength
const total = idxOffset + idxBytes

const buffer = Buffer.alloc(total)
Buffer.from(posArray.buffer).copy(buffer, 0)
Buffer.from(normArray.buffer).copy(buffer, posBytes)
Buffer.from(idxArray.buffer).copy(buffer, idxOffset)

const gltf = {
  asset: { version: '2.0', generator: 'arduconfigurator scripts/generate-plane-gltf.mjs' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [0] }],
  nodes: [{ name: 'plane', mesh: 0 }],
  meshes: [
    {
      name: 'plane',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }]
    }
  ],
  materials: [
    {
      name: 'airframe',
      pbrMetallicRoughness: {
        baseColorFactor: [0.847, 0.89, 0.953, 1],
        metallicFactor: 0.18,
        roughnessFactor: 0.56
      }
    }
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126, // FLOAT
      count: posArray.length / 3,
      type: 'VEC3',
      min,
      max
    },
    { bufferView: 1, componentType: 5126, count: normArray.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: idxArray.length, type: 'SCALAR' } // UNSIGNED_SHORT
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 }, // ARRAY_BUFFER
    { buffer: 0, byteOffset: posBytes, byteLength: normBytes, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes, target: 34963 } // ELEMENT_ARRAY_BUFFER
  ],
  buffers: [
    {
      byteLength: total,
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`
    }
  ]
}

writeFileSync(outPath, `${JSON.stringify(gltf, null, 2)}\n`)
process.stdout.write(
  `wrote ${outPath} (${posArray.length / 3} verts, ${idxArray.length} indices, ${total} buffer bytes)\n`
)
