import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const consumer = resolve(root, 'artifacts/consumer')
const installed = resolve(consumer, 'node_modules/cesium-lod-transitions')
const require = createRequire(resolve(consumer, 'package.json'))
const cjs = require('cesium-lod-transitions')
const esm = await import(pathToFileURL(resolve(installed, 'dist/index.js')).href)
assert.equal(cjs.VERSION, '0.1.0')
assert.equal(esm.VERSION, cjs.VERSION)
for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'cesium-lod-transitions.global.js']) {
  const bytes = await readFile(resolve(installed, 'dist', file))
  const expected = await readFile(resolve(root, 'dist', file))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(expected).digest('hex'), `Installed ${file} differs from release build`)
}
const base = '/artifacts/consumer/node_modules/cesium/Build/CesiumUnminified/'
const html = (await readFile(resolve(root, 'examples/index.html'), 'utf8')).replaceAll('/cesium/', base).replace('/examples/main.js', '/artifacts/consumer/main.js')
const main = (await readFile(resolve(root, 'examples/main.js'), 'utf8')).replace("'/dist/index.js'", "'/artifacts/consumer/node_modules/cesium-lod-transitions/dist/index.js'")
await writeFile(resolve(consumer, 'index.html'), html)
await writeFile(resolve(consumer, 'main.js'), main)
await writeFile(resolve(consumer, 'bootstrap.js'), "import * as C from 'cesium'\nwindow.Cesium=C\nawait import('/artifacts/consumer/main.js')\n")
await build({ entryPoints: [resolve(consumer, 'bootstrap.js')], bundle: true, format: 'esm', target: 'es2022', outfile: resolve(consumer, 'app.js'), external: ['/artifacts/consumer/main.js'] })
const esmHtml = html.replace(`<script src="${base}Cesium.js"></script>`, '').replace('src="/artifacts/consumer/main.js"', 'src="/artifacts/consumer/app.js"')
await writeFile(resolve(consumer, 'esm.html'), esmHtml)
await writeFile(resolve(consumer, 'types.ts'), "import * as C from 'cesium'\nimport { CesiumLodTransitions } from 'cesium-lod-transitions'\ndeclare const viewer: C.Viewer\nnew CesiumLodTransitions(viewer, {Cesium:C,duration:800}).destroy()\n")
await writeFile(resolve(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: false, noEmit: true }, include: ['types.ts'] }))
const engine = JSON.parse(await readFile(resolve(consumer, 'node_modules/@cesium/engine/package.json'), 'utf8')).version
console.log(JSON.stringify({ ok: true, version: esm.VERSION, engine, browser: 'http://127.0.0.1:19381/artifacts/consumer/index.html', filesMatch: true }))
