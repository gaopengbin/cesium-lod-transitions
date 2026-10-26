const C = globalThis.Cesium
const query = new URLSearchParams(location.search)
const { CesiumLodTransitions } = location.pathname.endsWith('/global.html') ? globalThis.CesiumLodTransitions : await import('/dist/index.js')
const fixture = query.has('fixture')
let heights
let manifest
if (fixture) {
  manifest = await fetch('/fixture/manifest.json').then(response => { if (!response.ok) throw new Error('Set TERRAIN_DATA_DIR to your local fixture directory'); return response.json() })
  heights = new Float32Array(await fetch('/fixture/heights.f32').then(response => response.arrayBuffer()))
  document.querySelector('#source').textContent = '本地勃朗峰真实高程与固定卫星影像，用于观察地形过渡；影像过渡请在默认诊断场景中测试。'
}
const scheme = new C.WebMercatorTilingScheme()
function proceduralHeight(lon, lat) {
  const east = (lon - C.Math.toRadians(6.865)) * 6378137 * Math.cos(lat)
  const north = (lat - C.Math.toRadians(45.832)) * 6378137
  const envelope = Math.exp(-(east * east + north * north) / (2 * 10000 ** 2))
  return Math.max(0, envelope * (2900 + 650 * Math.sin(east / 900) * Math.cos(north / 1150) + 500 * Math.sin((east + north) / 1800)))
}
function sample(px, py) {
  if (px < 0 || py < 0 || px > manifest.width - 1 || py > manifest.height - 1) return 0
  const x = Math.floor(px), y = Math.floor(py)
  const x1 = Math.min(x + 1, manifest.width - 1), y1 = Math.min(y + 1, manifest.height - 1)
  const tx = px - x, ty = py - y
  return (heights[y * manifest.width + x] * (1 - tx) + heights[y * manifest.width + x1] * tx) * (1 - ty) +
    (heights[y1 * manifest.width + x] * (1 - tx) + heights[y1 * manifest.width + x1] * tx) * ty
}
const terrain = new C.CustomHeightmapTerrainProvider({
  width: 65, height: 65, tilingScheme: scheme,
  credit: fixture ? 'Terrain: Mapzen / Tilezen, heights as supplied; no geoid correction' : 'Procedural terrain: synthetic test data',
  callback(x, y, level) {
    const data = new Float32Array(65 * 65)
    const scale = 2 ** level
    for (let row = 0; row < 65; row++) for (let col = 0; col < 65; col++) {
      if (fixture) {
        const pixels = 256 * 2 ** (manifest.demZoom - level)
        data[row * 65 + col] = sample((x + col / 64) * pixels - manifest.x0 * 256 - 0.5, (y + row / 64) * pixels - manifest.y0 * 256 - 0.5)
      } else {
        const lon = (x + col / 64) / scale * Math.PI * 2 - Math.PI
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + row / 64) / scale)))
        data[row * 65 + col] = proceduralHeight(lon, lat)
      }
    }
    return new Promise(resolve => setTimeout(() => resolve(data), level < 8 ? 0 : 70 + ((x * 17 + y * 13) % 5) * 20))
  },
})
terrain.getTileDataAvailable = (x, y, level) => level <= 13
const viewer = new C.Viewer('globe', {
  terrainProvider: terrain, baseLayer: false,
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
  scene3DOnly: true, requestRenderMode: true, maximumRenderTimeChange: Infinity,
  skyBox: false, skyAtmosphere: false, shadows: false,
  creditContainer: document.querySelector('#credits'),
  contextOptions: { webgl: { preserveDrawingBuffer: true } },
})
viewer.resolutionScale = Math.min(devicePixelRatio, 1.5) / devicePixelRatio
viewer.scene.globe.showGroundAtmosphere = false
viewer.scene.globe.maximumScreenSpaceError = 32
viewer.scene.globe.tileCacheSize = 256
viewer.scene.globe.depthTestAgainstTerrain = true
let imagery
if (fixture) {
  imagery = await C.SingleTileImageryProvider.fromUrl('/fixture/mont-blanc.jpg', {
    rectangle: C.Rectangle.fromDegrees(manifest.bounds.west, manifest.bounds.south, manifest.bounds.east, manifest.bounds.north),
    credit: 'Imagery: Esri, Maxar, Earthstar Geographics, GIS User Community',
  })
} else {
  imagery = new C.UrlTemplateImageryProvider({ url: '/unused/{z}/{x}/{y}', maximumLevel: 15, credit: 'Diagnostic imagery: synthetic, colors identify LOD levels' })
  const colors = ['#315b79', '#a58142', '#46866e', '#805e96', '#427f9b', '#9f604d', '#657d43', '#8b6380']
  imagery.requestImage = (x, y, level) => new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = colors[level % colors.length]
    ctx.fillRect(0, 0, 256, 256)
    const pixels = ctx.getImageData(0, 0, 256, 256)
    const scale = 2 ** level
    for (let row = 0; row < 256; row++) for (let col = 0; col < 256; col++) {
      const lon = (x + (col + 0.5) / 256) / scale * Math.PI * 2 - Math.PI
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (row + 0.5) / 256) / scale)))
      const h = proceduralHeight(lon, lat)
      const east = (proceduralHeight(lon + 100 / (6378137 * Math.cos(lat)), lat) - h) / 100
      const north = (proceduralHeight(lon, lat + 100 / 6378137) - h) / 100
      const shade = Math.max(0.3, Math.min(1.3, 0.85 - east * 0.45 + north * 0.55))
      const offset = (row * 256 + col) * 4
      for (let i = 0; i < 3; i++) pixels.data[offset + i] *= shade
    }
    ctx.putImageData(pixels, 0, 0)
    ctx.strokeStyle = '#ffffff55'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, 254, 254)
    ctx.lineWidth = 1
    ctx.strokeStyle = '#ffffff22'
    for (let i = 16; i < 256; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 20px monospace'
    ctx.fillText(`LEVEL ${level}`, 15, 34)
    ctx.font = '12px monospace'
    ctx.fillText(`x ${x} / y ${y}`, 15, 55)
    setTimeout(() => resolve(canvas), 40 + ((x + y) % 4) * 30)
  })
}
viewer.imageryLayers.addImageryProvider(imagery)
const transitions = new CesiumLodTransitions(viewer, { Cesium: C, duration: 800, imagery: true, terrain: true, respectReducedMotion: false })
let errors = 0
let debug = false
let revision = 0
viewer.scene.renderError.addEventListener((scene, error) => { errors++; console.error(error) })
function resetView(range = 18000) {
  viewer.camera.lookAt(C.Cartesian3.fromDegrees(6.865, 45.832, fixture ? 3600 : 2200), new C.HeadingPitchRange(C.Math.toRadians(25), C.Math.toRadians(-45), range))
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
  viewer.scene.requestRender()
}
function setDetail(value) {
  viewer.scene.globe.maximumScreenSpaceError = value === 'fine' ? 2 : 32
  document.querySelector('#coarse').setAttribute('aria-pressed', String(value !== 'fine'))
  document.querySelector('#fine').setAttribute('aria-pressed', String(value === 'fine'))
  viewer.scene.requestRender()
}
async function settle(timeout = 20000) {
  const start = performance.now()
  let stable = 0
  return new Promise(resolve => {
    function check() {
      viewer.scene.requestRender()
      const stats = transitions.getStats()
      stable = viewer.scene.globe.tilesLoaded && !stats.imagery.active && !stats.terrain.active && !stats.terrain.waiting ? stable + 1 : 0
      if (stable > 15 || performance.now() - start > timeout) resolve(stable > 15)
      else requestAnimationFrame(check)
    }
    check()
  })
}
function setFeature(name, enabled) {
  transitions[name === 'image' ? 'setImageryEnabled' : 'setTerrainEnabled'](enabled)
  document.querySelector(`#${name}-on`).setAttribute('aria-pressed', String(enabled))
  document.querySelector(`#${name}-off`).setAttribute('aria-pressed', String(!enabled))
}
for (const name of ['image', 'terrain']) for (const enabled of [true, false]) document.querySelector(`#${name}-${enabled ? 'on' : 'off'}`).addEventListener('click', () => setFeature(name, enabled))
for (const name of ['coarse', 'fine']) document.querySelector(`#${name}`).addEventListener('click', () => { revision++; setDetail(name) })
for (const button of document.querySelectorAll('[data-duration]')) button.addEventListener('click', () => {
  transitions.setDuration(Number(button.dataset.duration))
  document.querySelectorAll('[data-duration]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
})
document.querySelector('#reset').addEventListener('click', () => { revision++; resetView() })
document.querySelector('#debug').addEventListener('click', event => { debug = !debug; transitions.setDebug(debug); event.currentTarget.setAttribute('aria-pressed', String(debug)) })
document.querySelector('#play').addEventListener('click', async event => {
  const run = ++revision
  event.currentTarget.disabled = true
  resetView()
  setDetail('coarse')
  await settle()
  if (revision === run) { setDetail('fine'); await settle() }
  if (revision === run) { setDetail('coarse'); await settle() }
  document.querySelector('#play').disabled = false
})
viewer.scene.postRender.addEventListener(() => {
  const stats = transitions.getStats()
  document.querySelector('#image-active').textContent = stats.imagery.active
  document.querySelector('#terrain-active').textContent = stats.terrain.active
  document.querySelector('#extra').textContent = (stats.terrain.extraMeshBytes / 1048576).toFixed(1)
  document.querySelector('#status-text').textContent = errors ? `渲染异常 ${errors} 次` : stats.suspended.length ? `已回退原始绘制：${stats.suspended.join(', ')}` : stats.imagery.active || stats.terrain.active ? `正在交接 · 地形绘制 ${stats.commands} 次` : viewer.scene.globe.tilesLoaded ? '已就绪 · 0.8 秒为默认每级时长' : '正在加载细节…'
  document.querySelector('#status').dataset.error = String(!!errors)
})
window.pluginDemo = { viewer, transitions, setDetail, resetView, setFeature, settle, snapshot: () => ({ ...transitions.getStats(), errors, tilesLoaded: viewer.scene.globe.tilesLoaded }) }
resetView()
