import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cesium = resolve(root, 'node_modules/cesium/Build/CesiumUnminified')
const cesiumMin = resolve(root, 'node_modules/cesium/Build/Cesium')
const fixture = process.env.TERRAIN_DATA_DIR
const port = Number(process.env.PORT || 19381)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm' }
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname)
    const base = path.startsWith('/cesium-min/') ? cesiumMin : path.startsWith('/cesium/') ? cesium : path.startsWith('/fixture/') && fixture ? resolve(fixture) : root
    const relative = path.startsWith('/cesium-min/') ? path.slice(12) : path.startsWith('/cesium/') ? path.slice(8) : path.startsWith('/fixture/') && fixture ? path.slice(9) : path === '/' ? 'examples/index.html' : path.slice(1)
    const file = resolve(base, relative)
    if (!file.startsWith(base + sep)) { res.writeHead(403); res.end(); return }
    res.setHeader('Content-Type', types[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(await readFile(file))
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(error.message) }
}).listen(port, '127.0.0.1', () => console.log(`Unmodified Cesium + packaged plugin: http://127.0.0.1:${port}/`))
