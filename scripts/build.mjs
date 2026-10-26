import { mkdir, copyFile } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
const base = { entryPoints: ['src/index.js'], bundle: true, target: 'es2022', sourcemap: true, legalComments: 'eof' }
await build({ ...base, format: 'esm', outfile: 'dist/index.js' })
await build({ ...base, format: 'cjs', outfile: 'dist/index.cjs' })
await build({ ...base, format: 'iife', globalName: 'CesiumLodTransitions', outfile: 'dist/cesium-lod-transitions.global.js', minify: true })
await copyFile(new URL('../src/index.d.ts', import.meta.url), new URL('../dist/index.d.ts', import.meta.url))
