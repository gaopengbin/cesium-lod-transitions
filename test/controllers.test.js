import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TileFadeController, coverageFromUv, uvFromCoverage } from '../src/imagery-controller.js'
import { TerrainLodTransition, describePair } from '../src/terrain-controller.js'

const region = { west: 0, south: 0, east: 1, north: 1 }
const uv = { x: 0, y: 0, z: 1, w: 1 }
const layer = { alpha: 1, _calculateTextureTranslationAndScale: () => uv }
const image = level => ({ level, imageryLayer: layer, texture: {}, textureWebMercator: {}, count: 1, addReference() { this.count++ }, releaseReference() { this.count-- } })
const item = readyImagery => ({ readyImagery, textureCoordinateRectangle: uv, useWebMercatorT: false })
const base = { x: 0, y: 0, level: 0, rectangle: region }

test('imagery opacity is per texture and old GPU references release after completion', () => {
  let now = 0
  const c = new TileFadeController({ now: () => now, duration: 800 })
  const a = image(1), b = image(2)
  c.expand(base, [item(a)], { frameNumber: 1 })
  c.expand(base, [item(b)], { frameNumber: 2 })
  now = 400
  const entries = c.expand(base, [item(b)], { frameNumber: 3 })
  assert.equal(entries[1]._tileFadeAlpha, 0.5)
  assert.equal(layer.alpha, 1)
  now = 801
  c.expand(base, [item(b)], { frameNumber: 4 })
  c.expand(base, [item(b)], { frameNumber: 5 })
  c.expand(base, [item(b)], { frameNumber: 6 })
  assert.equal(a.count, 1)
  c.destroy()
  assert.equal(b.count, 1)
})

test('zoom-out preserves four child footprints over the new image', () => {
  const c = new TileFadeController({ now: () => 0 })
  const children = []
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const bounds = { west: x / 2, east: (x + 1) / 2, south: y / 2, north: (y + 1) / 2 }
    const i = image(1)
    children.push(i)
    c.expand({ x, y, level: 1, rectangle: bounds }, [item(i)], { frameNumber: 1 })
  }
  const entries = c.expand(base, [item(image(0))], { frameNumber: 2 })
  assert.equal(entries.length, 5)
  assert.deepEqual(entries[1].textureCoordinateRectangle, { x: 0, y: 0, z: 0.5, w: 0.5 })
  assert.deepEqual(entries[4].textureCoordinateRectangle, { x: 0.5, y: 0.5, z: 1, w: 1 })
  c.destroy()
  assert.ok(children.every(i => i.count === 1))
})

test('imagery interruption does not reveal an image hidden by an earlier transition', () => {
  const c = new TileFadeController({ now: () => 0 })
  const a = image(1), b = image(2), d = image(3)
  c.expand(base, [item(a)], { frameNumber: 1 })
  c.expand(base, [item(b)], { frameNumber: 2 })
  const entries = c.expand(base, [item(d)], { frameNumber: 3 })
  assert.deepEqual(entries.map(entry => entry.readyImagery), [d, a])
  c.setEnabled(false)
  c.expand(base, [item(d)], { frameNumber: 4 })
  assert.ok([a, b, d].every(i => i.count === 1))
})

test('Mercator source footprints round-trip at non-equatorial latitudes', () => {
  const bounds = { west: 0, east: 1, south: 0.3, north: 1.1 }
  const coords = { x: 0.1, y: 0.2, z: 0.8, w: 0.7 }
  const result = uvFromCoverage(bounds, coverageFromUv(bounds, coords, true), true)
  for (const key of Object.keys(coords)) assert.ok(Math.abs(result[key] - coords[key]) < 1e-9)
})

function tile(x, y, level, parent) {
  const scale = 1 / 2 ** level
  return { x, y, level, parent, rectangle: { west: x * scale, east: (x + 1) * scale, south: y * scale, north: (y + 1) * scale },
    data: { vertexArray: { isDestroyed: () => false }, mesh: { vertices: new Float32Array(20), indices: new Uint16Array(6) }, terrainData: { wasCreatedByUpsampling: () => false }, imagery: [item(image(level))] },
  }
}
const area = r => (r.east - r.west) * (r.north - r.south)

test('terrain midpoint swaps primary depth mesh using documented epsilon weights', () => {
  const p = tile(0, 0, 0), c = tile(0, 0, 1, p)
  assert.deepEqual(describePair(0, p, c), { primary: p })
  assert.equal(describePair(0.25, p, c).primary, p)
  assert.equal(describePair(0.25, p, c).weight, 1 / 64 + 63 / 64 * 0.3125)
  assert.equal(describePair(0.5, p, c).primary, c)
  assert.equal(describePair(0.5, p, c).weight, 1)
  assert.deepEqual(describePair(1, p, c), { primary: c })
})

test('terrain owns coverage exactly once; progress advances once per frame and reverses', () => {
  let now = 0
  const c = new TerrainLodTransition({ now: () => now })
  const p = tile(0, 0, 0)
  const children = [tile(0, 0, 1, p), tile(1, 0, 1, p), tile(0, 1, 1, p), tile(1, 1, 1, p)]
  c.plan([p], 1)
  c.plan(children, 2)
  now = 200
  const entries = c.plan(children, 3)
  assert.equal(entries.filter(e => e.role === 'primary').reduce((sum, e) => sum + area(e.region), 0), 1)
  now = 300
  c.plan(children, 3)
  assert.equal([...c.pairs.values()][0].progress, 0.25)
  c.plan([p], 4)
  assert.ok([...c.pairs.values()].every(pair => pair.target === 0 && pair.progress === 0.125))
  now = 1000
  c.plan([p], 5)
  assert.equal(c.stats.active, 0)
  c.destroy()
  assert.ok([p, ...children].every(t => !t.data._terrainLodRefs))
})

test('unready intermediate meshes hold the old parent, then resume adjacent handoffs', () => {
  let now = 0
  const c = new TerrainLodTransition({ now: () => now })
  const p = tile(0, 0, 0), mid = tile(0, 0, 1, p), fine = tile(0, 0, 2, mid)
  const vao = mid.data.vertexArray
  mid.data.vertexArray = undefined
  c.plan([p], 1)
  assert.ok(c.plan([fine], 2).every(e => e.tile === p))
  mid.data.vertexArray = vao
  now = 100
  c.plan([fine], 3)
  assert.equal([...c.pairs.values()][0].child, mid)
  c.destroy()
})

test('budgets fall back to complete native coverage without leaking pins', () => {
  for (const limits of [{ maxPairs: 0 }, { maxCommands: 1 }, { maxExtraBytes: 1 }]) {
    const c = new TerrainLodTransition(limits)
    const p = tile(0, 0, 0), children = [tile(0, 0, 1, p), tile(1, 0, 1, p), tile(0, 1, 1, p), tile(1, 1, 1, p)]
    c.plan([p], 1)
    const entries = c.plan(children, 2)
    assert.equal(c.stats.active, 0)
    assert.equal(entries.reduce((sum, e) => sum + area(e.region), 0), 1)
    c.destroy()
    assert.ok([p, ...children].every(t => !t.data._terrainLodRefs))
  }
})
