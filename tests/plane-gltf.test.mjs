import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const gltfPath = join(here, '..', 'apps', 'web', 'public', 'models', 'plane.gltf')
const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'))

test('plane.gltf is a structurally valid glTF 2.0 asset', () => {
  assert.equal(gltf.asset.version, '2.0')
  assert.equal(gltf.scene, 0)
  assert.equal(gltf.scenes.length, 1)
  assert.equal(gltf.nodes.length, 1)
  assert.equal(gltf.meshes.length, 1)

  const primitive = gltf.meshes[0].primitives[0]
  assert.equal(primitive.attributes.POSITION, 0)
  assert.equal(primitive.attributes.NORMAL, 1)
  assert.equal(primitive.indices, 2)
  assert.equal(typeof primitive.material, 'number')
  assert.ok(gltf.materials[primitive.material], 'primitive references a real material')
})

test('plane.gltf accessors and buffer are internally consistent', () => {
  const [position, normal, index] = gltf.accessors
  assert.equal(position.type, 'VEC3')
  assert.equal(position.componentType, 5126) // FLOAT
  assert.equal(normal.type, 'VEC3')
  assert.equal(normal.componentType, 5126)
  assert.equal(index.type, 'SCALAR')
  assert.equal(index.componentType, 5123) // UNSIGNED_SHORT
  assert.equal(position.count, normal.count, 'one normal per position')
  assert.equal(position.count % 3, 0)
  assert.equal(index.count % 3, 0, 'indices form whole triangles')

  // Every index addresses a real vertex.
  const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64')
  assert.equal(buffer.length, gltf.buffers[0].byteLength)

  const totalFromViews = gltf.bufferViews.reduce((sum, view) => sum + view.byteLength, 0)
  assert.equal(totalFromViews, gltf.buffers[0].byteLength, 'bufferViews tile the buffer')

  const idxView = gltf.bufferViews[index.bufferView]
  const idx = new Uint16Array(
    buffer.buffer,
    buffer.byteOffset + idxView.byteOffset,
    index.count
  )
  const maxIndex = idx.reduce((m, v) => Math.max(m, v), 0)
  assert.ok(maxIndex < position.count, `max index ${maxIndex} < vertex count ${position.count}`)
})

test('plane.gltf is sized and oriented like the copter preview models', () => {
  const position = gltf.accessors[0]
  const span = position.max[0] - position.min[0] // X = wingspan
  const length = position.max[2] - position.min[2] // Z = nose-to-tail
  // The preview applies a fixed x16.5 scale to glTF models; ~4.6 units of
  // span keeps the plane framed like the ~4-5 unit copter models.
  assert.ok(span > 3.5 && span < 6, `wingspan ${span} in the copter-comparable range`)
  assert.ok(length > 2.5 && length < 5, `length ${length} plausible for a plane`)
  // Wider than it is long — unmistakably a fixed-wing, not a quad.
  assert.ok(span > length, 'wingspan exceeds fuselage length')
})
