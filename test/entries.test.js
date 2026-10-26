import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('ESM, CommonJS and browser-global builds load without side effects or a bundled Cesium', async () => {
  const esm = await import('../dist/index.js')
  const cjs = createRequire(import.meta.url)('../dist/index.cjs')
  const code = await readFile(new URL('../dist/cesium-lod-transitions.global.js', import.meta.url), 'utf8')
  const context = {}
  runInNewContext(code, context)
  for (const module of [esm, cjs, context.CesiumLodTransitions]) {
    assert.equal(module.VERSION, '0.1.0')
    assert.equal(typeof module.CesiumLodTransitions, 'function')
    assert.equal(typeof module.createLodTransitions, 'function')
  }
  assert.ok(code.length < 70000, 'Browser plugin must not bundle the Cesium engine')
})
