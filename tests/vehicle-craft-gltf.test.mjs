import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

// rover.gltf / sub.gltf are original CC0 models (generate-rover-gltf.mjs /
// generate-sub-gltf.mjs) so ArduRover / ArduSub get a real Setup craft
// preview instead of the copter quad. Mirrors plane-gltf.test.mjs.

const here = dirname(fileURLToPath(import.meta.url))
const models = join(here, '..', 'apps', 'web', 'public', 'models')

for (const name of ['rover', 'sub']) {
  const gltf = JSON.parse(readFileSync(join(models, `${name}.gltf`), 'utf8'))

  test(`${name}.gltf is a structurally valid glTF 2.0 asset`, () => {
    assert.equal(gltf.asset.version, '2.0')
    assert.equal(gltf.scene, 0)
    assert.equal(gltf.scenes.length, 1)
    assert.equal(gltf.nodes.length, 1)
    assert.equal(gltf.nodes[0].name, name, 'node is named for the vehicle')
    assert.equal(gltf.meshes.length, 1)

    const primitive = gltf.meshes[0].primitives[0]
    assert.equal(primitive.attributes.POSITION, 0)
    assert.equal(primitive.attributes.NORMAL, 1)
    assert.equal(primitive.indices, 2)
    assert.ok(gltf.materials[primitive.material], 'primitive references a real material')
  })

  test(`${name}.gltf accessors and buffer are internally consistent`, () => {
    const [position, normal, index] = gltf.accessors
    assert.equal(position.type, 'VEC3')
    assert.equal(position.componentType, 5126)
    assert.equal(normal.type, 'VEC3')
    assert.equal(index.type, 'SCALAR')
    assert.equal(index.componentType, 5123)
    assert.equal(position.count, normal.count, 'one normal per position')
    assert.equal(index.count % 3, 0, 'indices form whole triangles')

    const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64')
    assert.equal(buffer.length, gltf.buffers[0].byteLength)
    const totalFromViews = gltf.bufferViews.reduce((sum, view) => sum + view.byteLength, 0)
    assert.equal(totalFromViews, gltf.buffers[0].byteLength, 'bufferViews tile the buffer')

    const idxView = gltf.bufferViews[index.bufferView]
    const idx = new Uint16Array(buffer.buffer, buffer.byteOffset + idxView.byteOffset, index.count)
    const maxIndex = idx.reduce((m, v) => Math.max(m, v), 0)
    assert.ok(maxIndex < position.count, `max index ${maxIndex} < vertex count ${position.count}`)
  })

  test(`${name}.gltf is copter-comparably sized and not a quad silhouette`, () => {
    const position = gltf.accessors[0]
    const width = position.max[0] - position.min[0] // X = track / span
    const length = position.max[2] - position.min[2] // Z = nose-to-tail
    const maxDim = Math.max(width, length, position.max[1] - position.min[1])
    // Fixed x16.5 preview scale: ~3.5–5 units frames it like the copters.
    assert.ok(maxDim > 3 && maxDim < 6, `${name} max dimension ${maxDim} in the copter-comparable range`)
    // A rover/ROV reads as longer than it is wide — unmistakably not the
    // square quad default it used to fall through to.
    assert.ok(length > width, `${name} length ${length} exceeds width ${width}`)
  })
}
