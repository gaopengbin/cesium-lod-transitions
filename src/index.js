import { TileFadeController } from './imagery-controller.js'
import { TerrainLodTransition } from './terrain-controller.js'
import { patchFragmentSources } from './shader.js'
import { weightImagery } from './imagery-adapter.js'

export const VERSION = '0.1.0'
const instances = new WeakMap()
const fullRegion = { x: 0, y: 0, z: 1, w: 1 }
const noTint = { x: 0, y: 0, z: 0, w: 0 }
const feature = value => typeof value === 'object' && value !== null ? { enabled: true, ...value } : { enabled: value !== false }
const own = (object, name) => Object.getOwnPropertyDescriptor(object, name)

function positive(value, name, max = Infinity) {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`${name} must be finite and between 0 and ${max}`)
  return value
}

function restore(object, name, descriptor) {
  if (descriptor) Object.defineProperty(object, name, descriptor)
  else delete object[name]
}

/** Installs hooks only on this Viewer's existing globe/provider instances. */
export class CesiumLodTransitions {
  constructor(viewer, options = {}) {
    const C = options.Cesium ?? globalThis.Cesium
    if (!C || !/^1\.145\./.test(C.VERSION)) throw new Error('cesium-lod-transitions 0.1 supports CesiumJS 1.145.x (tested 1.145.0); pass { Cesium } from your Viewer module')
    if (viewer?.isDestroyed?.()) throw new Error('Cannot attach to a destroyed Viewer')
    const scene = viewer?.scene
    const globe = scene?.globe
    const quadtree = globe?._surface
    const provider = quadtree?._tileProvider
    const shaders = provider?._surfaceShaderSet
    if (!provider || !shaders?.getShaderProgram || !provider.endUpdate || !provider.updateForPick || !Array.isArray(provider._drawCommands) || !quadtree.forEachLoadedTile) {
      throw new Error('Unsupported Cesium globe internals; no hooks were installed')
    }
    if (instances.has(globe)) throw new Error('This Viewer already has CesiumLodTransitions; destroy the previous instance first')
    // Validate the shader layout transactionally before installing any hooks.
    patchFragmentSources(shaders.baseFragmentShaderSource)
    const duration = positive(options.duration ?? 800, 'duration', 60000)
    const image = feature(options.imagery)
    const terrain = feature(options.terrain)
    for (const [name, value] of Object.entries({ imageryDuration: image.duration ?? duration, terrainDuration: terrain.duration ?? duration })) positive(value, name, 60000)
    positive(image.maxLayers ?? 8, 'imagery.maxLayers', 8)
    for (const [name, value] of Object.entries({ maxPairs: terrain.maxPairs ?? 64, maxCommands: terrain.maxCommands ?? 512, maxExtraBytes: terrain.maxExtraBytes ?? 32 * 1024 * 1024 })) positive(value, `terrain.${name}`)
    this._C = C
    this._viewer = viewer
    this._scene = scene
    this._globe = globe
    this._quadtree = quadtree
    this._provider = provider
    this._shaders = shaders
    this._imagery = new TileFadeController({ duration: image.duration ?? duration, maxLayers: image.maxLayers ?? 8 })
    this._terrain = new TerrainLodTransition({ duration: terrain.duration ?? duration, maxPairs: terrain.maxPairs, maxExtraBytes: terrain.maxExtraBytes, maxCommands: terrain.maxCommands })
    const reduced = options.respectReducedMotion !== false && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    this._wanted = { imagery: !!image.enabled && !reduced, terrain: !!terrain.enabled && !reduced }
    this._imagery.setEnabled(this._wanted.imagery)
    this._terrain.setEnabled(this._wanted.terrain)
    this._debug = !!options.debug
    this._destroyed = false
    this._suspended = []
    this._pins = new Map()
    this._bases = new Map()
    this._patchedBase = undefined
    this._states = new Map()
    this._tail = 0
    this._commands = 0
    this._terrainProvider = globe.terrainProvider
    this._removers = []
    const gl = scene.context?._gl
    this._textureLimit = gl ? Math.max(1, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) - 4) : 12
    const end = provider.endUpdate
    const pick = provider.updateForPick
    const destroy = viewer.destroy
    this._originalEnd = end
    this._originalPick = pick
    this._originalDestroy = destroy
    this._descriptors = { end: own(provider, 'endUpdate'), pick: own(provider, 'updateForPick'), destroy: own(viewer, 'destroy') }
    const plugin = this
    this._endHook = function(frame) { return plugin._render(frame, end, this) }
    this._pickHook = function(frame) {
      if (plugin._destroyed) return pick.call(this, frame)
      const all = this._drawCommands
      const count = this._usedDrawCommands
      const filtered = all.slice(0, count).filter(command => command._lodRole !== 'secondary')
      this._drawCommands = filtered
      this._usedDrawCommands = filtered.length
      try { return pick.call(this, frame) }
      finally { this._drawCommands = all; this._usedDrawCommands = count }
    }
    this._destroyHook = function(...args) { plugin.destroy(); return destroy.apply(this, args) }
    provider.endUpdate = this._endHook
    provider.updateForPick = this._pickHook
    viewer.destroy = this._destroyHook
    instances.set(globe, this)
    this._listen(scene.postRender, () => {
      if (this._imagery.stats.active || this._terrain.stats.active || this._terrain.stats.waiting) this._tail = 2
      if (this._tail > 0) { this._tail--; scene.requestRender() }
    })
    for (const name of ['layerAdded', 'layerRemoved', 'layerMoved', 'layerShownOrHidden']) this._listen(viewer.imageryLayers[name], () => this.reset())
    this._lost = () => this.reset()
    scene.canvas.addEventListener('webglcontextlost', this._lost)
    scene.requestRender()
  }

  _listen(event, callback) {
    if (event?.addEventListener) this._removers.push(event.addEventListener(callback))
  }

  _invalidateShaders() {
    const caches = this._shaders._shadersByTexturesFlags
    for (const byFlags of Object.values(caches)) {
      if (!byFlags) continue
      for (const shader of Object.values(byFlags)) if (shader?.shaderProgram && !shader.shaderProgram.isDestroyed()) shader.shaderProgram.destroy()
    }
    this._shaders._shadersByTexturesFlags = []
    this._quadtree.forEachLoadedTile(tile => { if (tile.data) tile.data.surfaceShader = undefined })
  }

  _ensureShader() {
    const base = this._shaders.baseFragmentShaderSource
    if (base === this._patchedBase) return
    const patched = patchFragmentSources(base)
    this._invalidateShaders()
    this._bases.clear()
    this._bases.set(patched, base)
    this._shaders.baseFragmentShaderSource = patched
    this._patchedBase = patched
  }

  _syncPins() {
    const held = new Set(this._terrain.frameHeld)
    for (const pair of this._terrain.pairs.values()) for (const data of pair.held) held.add(data)
    for (const data of held) {
      if (this._pins.has(data)) continue
      const descriptor = own(data, 'eligibleForUnloading')
      let prototype = data
      let original
      while (prototype && !original) { original = own(prototype, 'eligibleForUnloading'); prototype = Object.getPrototypeOf(prototype) }
      if (!original?.get) throw new Error('Unsupported Cesium surface unload guard')
      Object.defineProperty(data, 'eligibleForUnloading', { configurable: true, get() { return this._terrainLodRefs > 0 ? false : original.get.call(this) } })
      this._pins.set(data, descriptor)
    }
    for (const [data, descriptor] of this._pins) {
      if ((data._terrainLodRefs || 0) > 0) continue
      restore(data, 'eligibleForUnloading', descriptor)
      this._pins.delete(data)
    }
  }

  _support(frame) {
    const reasons = []
    const shown = []
    for (let i = 0; i < this._viewer.imageryLayers.length; i++) {
      const layer = this._viewer.imageryLayers.get(i)
      if (layer.show) shown.push(layer)
    }
    if (frame.mode !== this._C.SceneMode.SCENE3D) reasons.push('3D globe only')
    if (shown.length !== 1 || shown[0]?.alpha !== 1) reasons.push('one opaque imagery layer required')
    if (this._globe.translucency?.enabled) reasons.push('globe translucency')
    if (this._globe.material) reasons.push('custom globe material')
    if (this._scene.shadowMap?.enabled) reasons.push('shadows')
    if (this._globe.terrainProvider?.hasWaterMask) reasons.push('water masks')
    if (this._globe.clippingPlanes?.length || this._globe.clippingPolygons?.length) reasons.push('globe clipping')
    if (this._quadtree._tilesToRender?.some(tile => tile.data?.vectorData?.show)) reasons.push('vector globe features')
    this._suspended = reasons
    return reasons.length === 0
  }

  _render(frame, original, receiver) {
    if (this._destroyed) return original.call(receiver, frame)
    if (this._terrainProvider !== this._globe.terrainProvider) { this.reset(); this._terrainProvider = this._globe.terrainProvider }
    const supported = this._support(frame)
    const imageEnabled = supported && this._wanted.imagery
    const terrainEnabled = supported && this._wanted.terrain
    if (this._imagery.enabled !== imageEnabled) this._imagery.setEnabled(imageEnabled)
    if (this._terrain.enabled !== terrainEnabled) this._terrain.setEnabled(terrainEnabled)
    const groups = this._provider._tilesToRenderByTextureCount
    const goals = groups.flat().filter(Boolean)
    this._imagery.beginFrame(frame.frameNumber)
    let entries = terrainEnabled ? this._terrain.plan(goals, frame.frameNumber) : goals.map(tile => ({ tile, region: tile.rectangle, role: 'primary', weight: 1 }))
    this._syncPins()
    const changed = new Map()
    const byTile = new Map()
    try {
      if (imageEnabled) {
        for (const { tile } of entries) {
          if (byTile.has(tile)) continue
          const expanded = this._imagery.expand(tile, tile.data.imagery, frame)
          byTile.set(tile, weightImagery(expanded))
        }
        if ([...byTile.values()].some(items => items.filter(item => item.readyImagery).length > this._textureLimit)) {
          byTile.clear()
          this._imagery.reset()
          this._suspended.push('imagery texture budget exceeded')
        }
      }
      if (terrainEnabled && entries.some(({ tile }) => (byTile.get(tile) || tile.data.imagery).filter(item => item.readyImagery).length > this._textureLimit)) {
        this._terrain.clear('texture-budget')
        this._syncPins()
        entries = goals.map(tile => ({ tile, region: tile.rectangle, role: 'primary', weight: 1 }))
        this._suspended.push('terrain texture budget exceeded')
      }
      for (const [tile, items] of byTile) { changed.set(tile.data, tile.data.imagery); tile.data.imagery = items }
      const owners = new WeakMap()
      const draws = entries.map(entry => {
        // Native draw-command owners identify every pass, including reused
        // commands. No global functions, Cesium namespace or prototypes change.
        const tile = new Proxy(entry.tile, {})
        owners.set(tile, entry)
        return tile
      })
      this._ensureShader()
      this._provider._tilesToRenderByTextureCount = [draws]
      const result = original.call(receiver, frame)
      this._commands = this._provider._usedDrawCommands
      for (let i = 0; i < this._commands; i++) {
        const command = this._provider._drawCommands[i]
        const entry = owners.get(command.owner)
        this._style(command, entry, terrainEnabled)
        if (entry) command.owner = entry.tile
      }
      return result
    } finally {
      this._provider._tilesToRenderByTextureCount = groups
      for (const [data, imagery] of changed) data.imagery = imagery
    }
  }

  _style(command, entry, terrainEnabled) {
    const C = this._C
    const role = entry?.role || 'primary'
    command._lodRole = role
    if (terrainEnabled && entry) {
      const key = `${command.renderState.id}/${role}`
      if (!this._states.has(key)) {
        const state = C.RenderState.getState(command.renderState)
        state.depthTest = { enabled: true, func: C.DepthFunction.LESS_OR_EQUAL }
        state.depthMask = role === 'primary'
        if (role === 'secondary') state.blending = C.BlendingState.PRE_MULTIPLIED_ALPHA_BLEND
        this._states.set(key, C.RenderState.fromCache(state))
      }
      command.renderState = this._states.get(key)
      if (role === 'secondary') command.castShadows = false
    }
    let region = fullRegion
    if (entry?.pairId || (terrainEnabled && entry)) {
      const r = entry.region
      const t = entry.tile.rectangle
      region = { x: (r.west - t.west) / (t.east - t.west), y: (r.south - t.south) / (t.north - t.south), z: (r.east - t.west) / (t.east - t.west), w: (r.north - t.south) / (t.north - t.south) }
    }
    const weight = entry?.weight ?? 1
    const tint = !this._debug || !entry?.pairId ? noTint : role === 'secondary' ? { x: 1, y: 0.48, z: 0.16, w: 0.3 } : { x: 0.12, y: 0.85, z: 0.7, w: 0.3 }
    command.uniformMap = { ...command.uniformMap, u_lodRegion: () => region, u_lodWeight: () => weight, u_lodTint: () => tint }
    command.dirty = true
  }

  _assertAlive() { if (this._destroyed) throw new Error('CesiumLodTransitions has been destroyed') }
  setEnabled(enabled) { this._assertAlive(); this._wanted = { imagery: !!enabled, terrain: !!enabled }; return this.reset() }
  setImageryEnabled(enabled) {
    this._assertAlive()
    this._wanted.imagery = !!enabled
    this._imagery.setEnabled(!!enabled)
    this._scene.requestRender()
    return this
  }
  setTerrainEnabled(enabled) {
    this._assertAlive()
    this._wanted.terrain = !!enabled
    this._terrain.setEnabled(!!enabled)
    this._syncPins()
    this._scene.requestRender()
    return this
  }
  setDuration(milliseconds) { this._assertAlive(); positive(milliseconds, 'duration', 60000); this._imagery.duration = this._terrain.duration = milliseconds; this._scene.requestRender(); return this }
  setDebug(enabled) { this._assertAlive(); this._debug = !!enabled; this._scene.requestRender(); return this }
  reset() {
    this._assertAlive()
    this._imagery.setEnabled(this._wanted.imagery)
    this._terrain.setEnabled(this._wanted.terrain)
    this._syncPins()
    this._scene.requestRender()
    return this
  }
  getStats() {
    return { cesiumVersion: this._C.VERSION, destroyed: this._destroyed, enabled: { ...this._wanted }, suspended: [...this._suspended],
      imagery: { ...this._imagery.stats, levels: [...this._imagery.stats.levels] },
      terrain: { ...this._terrain.stats, levels: [...this._terrain.stats.levels], endReasons: { ...this._terrain.stats.endReasons } }, commands: this._commands }
  }
  isDestroyed() { return this._destroyed }
  destroy() {
    if (this._destroyed) return
    this._imagery.destroy()
    this._terrain.destroy()
    this._syncPins()
    this._destroyed = true
    for (const remove of this._removers) remove()
    this._scene.canvas.removeEventListener('webglcontextlost', this._lost)
    if (this._provider.endUpdate === this._endHook) restore(this._provider, 'endUpdate', this._descriptors.end)
    if (this._provider.updateForPick === this._pickHook) restore(this._provider, 'updateForPick', this._descriptors.pick)
    if (this._viewer.destroy === this._destroyHook) restore(this._viewer, 'destroy', this._descriptors.destroy)
    if (this._bases.has(this._shaders.baseFragmentShaderSource)) {
      this._shaders.baseFragmentShaderSource = this._bases.get(this._shaders.baseFragmentShaderSource)
      this._invalidateShaders()
    }
    for (const command of this._provider._drawCommands) delete command._lodRole
    this._bases.clear()
    this._states.clear()
    this._commands = 0
    this._wanted = { imagery: false, terrain: false }
    instances.delete(this._globe)
    this._scene.requestRender()
  }
}

export function createLodTransitions(viewer, options) { return new CesiumLodTransitions(viewer, options) }
