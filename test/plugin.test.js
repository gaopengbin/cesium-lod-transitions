import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as C from 'cesium'
import ContextLimits from '@cesium/engine/Source/Renderer/ContextLimits.js'
import { CesiumLodTransitions } from '../src/index.js'
import { weightImagery } from '../src/imagery-adapter.js'
import { wrapTerrainFragment } from '../src/shader.js'

// Node has no WebGL context; initialize the limits required by RenderState.
ContextLimits._minimumAliasedLineWidth = 1
ContextLimits._maximumAliasedLineWidth = 1

function fixture() {
  const layer = { alpha: 1, show: true, _calculateTextureTranslationAndScale: () => ({ x: 0, y: 0, z: 1, w: 1 }) }
  const image = level => ({ level, imageryLayer: layer, texture: {}, count: 1, addReference() { this.count++ }, releaseReference() { this.count-- } })
  const a = image(1), b = image(2)
  const item = readyImagery => ({ readyImagery, useWebMercatorT: false, textureCoordinateRectangle: { x: 0, y: 0, z: 1, w: 1 } })
  const tile = (level, parent) => ({ x: 0, y: 0, level, parent,
    rectangle: { west: 0, south: 0, east: 1 / 2 ** level, north: 1 / 2 ** level },
    data: Object.assign(Object.create({ get eligibleForUnloading() { return true } }), {
      vertexArray: { isDestroyed: () => false }, mesh: { vertices: new Float32Array(20), indices: new Uint16Array(6) },
      terrainData: { wasCreatedByUpsampling: () => false }, imagery: [item(level ? b : a)],
    }),
  })
  const parent = tile(0), child = tile(1, parent)
  const layers = [layer]
  const shaders = { baseFragmentShaderSource: new C.ShaderSource({ sources: ['in vec3 v_textureCoordinates; void main() { out_FragColor = vec4(1.0); }'] }),
    _shadersByTexturesFlags: [], getShaderProgram() {},
  }
  const provider = { _surfaceShaderSet: shaders, _tilesToRenderByTextureCount: [[parent]], _drawCommands: [], _usedDrawCommands: 0,
    endUpdate() {
      this._usedDrawCommands = 0
      for (const t of this._tilesToRenderByTextureCount.flat()) {
        const i = this._usedDrawCommands++
        this._drawCommands[i] = { owner: t, renderState: C.RenderState.fromCache({ depthTest: { enabled: true } }),
          uniformMap: { properties: { alphas: t.data.imagery.map(v => v.readyImagery.imageryLayer.alpha) } },
        }
      }
    },
    updateForPick(frame) { frame.picked = this._drawCommands.slice(0, this._usedDrawCommands) },
  }
  const quadtree = { _tileProvider: provider, _tilesToRender: [parent], forEachLoadedTile(callback) { [parent, child].forEach(callback) } }
  const scene = { globe: { _surface: quadtree, terrainProvider: {} }, postRender: new C.Event(), canvas: new EventTarget(), requestRender() {} }
  const viewer = { scene, imageryLayers: { get length() { return layers.length }, get: i => layers[i], layerAdded: new C.Event() }, destroyed: false,
    isDestroyed() { return this.destroyed }, destroy() { this.destroyed = true },
  }
  let time = 0, frame = 0
  const install = (options = {}) => {
    const p = new CesiumLodTransitions(viewer, { Cesium: C, respectReducedMotion: false, ...options })
    p._imagery.now = p._terrain.now = () => time
    return p
  }
  function render(goals, milliseconds = time, mode = C.SceneMode.SCENE3D) {
    time = milliseconds
    provider._tilesToRenderByTextureCount = [goals]
    quadtree._tilesToRender = goals
    const state = { frameNumber: ++frame, mode }
    provider.endUpdate(state)
    return provider._drawCommands.slice(0, provider._usedDrawCommands)
  }
  return { layer, a, b, item, parent, child, layers, shaders, provider, viewer, install, render }
}

test('runtime weights shadow only the old draw layer, without changing shared imagery', () => {
  const f = fixture()
  const result = weightImagery([{ ...f.item(f.a), _tileFadeAlpha: 0.3 }])
  assert.equal(result[0].readyImagery.imageryLayer.alpha, 0.3)
  assert.equal(f.layer.alpha, 1)
  assert.equal(f.a.imageryLayer, f.layer)
  assert.equal(result[0].readyImagery.texture, f.a.texture)
})

test('attaches to native command owners, fades both features and releases every hold', () => {
  const f = fixture(), p = f.install()
  const originalImages = f.parent.data.imagery
  f.render([f.parent])
  f.render([f.child], 10)
  let commands = f.render([f.child], 210)
  assert.equal(p.getStats().terrain.active, 1)
  assert.ok(commands.some(c => c._lodRole === 'secondary' && !c.renderState.depthMask))
  assert.ok(commands.every(c => [f.parent, f.child].includes(c.owner)))
  assert.equal(f.parent.data.imagery, originalImages)
  assert.equal(f.parent.data.eligibleForUnloading, false)
  commands = f.render([f.child], 410)
  assert.equal(commands.find(c => c._lodRole === 'primary').owner, f.child)
  p.setEnabled(false)
  f.render([f.child], 450)
  assert.equal(f.parent.data._terrainLodRefs, 0)
  assert.equal(f.child.data._terrainLodRefs, 0)
  assert.equal(f.parent.data.eligibleForUnloading, true)
  assert.equal(f.a.count, 1)
  assert.equal(f.b.count, 1)
  p.destroy()
})

test('instance hooks leave another Viewer and all Cesium prototypes untouched', () => {
  const a = fixture(), b = fixture()
  const originalA = a.provider.endUpdate, originalB = b.provider.endUpdate
  const source = a.shaders.baseFragmentShaderSource
  const draw = C.DrawCommand.prototype.execute
  const p = a.install()
  a.render([a.parent])
  assert.equal(b.provider.endUpdate, originalB)
  assert.equal(C.DrawCommand.prototype.execute, draw)
  assert.throws(() => a.install(), /already/)
  p.destroy()
  assert.equal(a.provider.endUpdate, originalA)
  assert.equal(a.shaders.baseFragmentShaderSource, source)
  p.destroy()
  const again = a.install()
  again.destroy()
})

test('separate feature switches keep the other terrain handoff running', () => {
  const f = fixture(), p = f.install()
  f.render([f.parent])
  f.render([f.child], 10)
  f.render([f.child], 210)
  const before = [...p._terrain.pairs.values()][0]
  p.setImageryEnabled(false)
  assert.equal([...p._terrain.pairs.values()][0], before)
  p.destroy()
})

test('pick commands exclude secondary geometry, then restore native arrays', () => {
  const f = fixture(), p = f.install()
  f.render([f.parent])
  f.render([f.child], 10)
  f.render([f.child], 210)
  const all = f.provider._drawCommands, count = f.provider._usedDrawCommands
  const frame = {}
  f.provider.updateForPick(frame)
  assert.ok(frame.picked.every(c => c._lodRole === 'primary'))
  assert.equal(f.provider._drawCommands, all)
  assert.equal(f.provider._usedDrawCommands, count)
  p.destroy()
})

test('automatically falls back in unsupported scenes and resumes when supported', () => {
  const f = fixture(), p = f.install()
  f.render([f.parent])
  f.layers.push({ alpha: 1, show: true })
  f.render([f.child], 10)
  assert.match(p.getStats().suspended.join(), /one opaque/)
  assert.equal(p.getStats().terrain.active, 0)
  assert.equal(f.parent.data._terrainLodRefs, 0)
  f.layers.pop()
  f.render([f.parent], 20)
  assert.deepEqual(p.getStats().suspended, [])
  f.render([f.child], 30, C.SceneMode.SCENE2D)
  assert.match(p.getStats().suspended.join(), /3D/)
  p.destroy()
})

test('restores native imagery and selection arrays even if command generation fails', () => {
  const f = fixture()
  f.provider.endUpdate = () => { throw new Error('native draw failure') }
  const p = f.install(), images = f.parent.data.imagery
  assert.throws(() => f.render([f.parent]), /native draw failure/)
  assert.equal(f.parent.data.imagery, images)
  assert.equal(f.provider._tilesToRenderByTextureCount[0][0], f.parent)
  p.destroy()
})

test('Viewer destroy and context loss release active resources', () => {
  for (const action of ['context', 'viewer']) {
    const f = fixture(), p = f.install()
    f.render([f.parent])
    f.render([f.child], 10)
    f.render([f.child], 210)
    if (action === 'context') f.viewer.scene.canvas.dispatchEvent(new Event('webglcontextlost'))
    else f.viewer.destroy()
    assert.equal(f.parent.data._terrainLodRefs, 0)
    assert.equal(f.child.data._terrainLodRefs, 0)
    assert.equal(f.a.count, 1)
    assert.equal(f.b.count, 1)
    if (action === 'viewer') assert.equal(p.isDestroyed(), true)
    p.destroy()
    assert.throws(() => p.setDuration(100), /destroyed/)
  }
})

test('rejects incompatible versions and invalid options before hooking', () => {
  const f = fixture(), original = f.provider.endUpdate
  assert.throws(() => new CesiumLodTransitions(f.viewer, { Cesium: { ...C, VERSION: '1.139.0' } }), /1.145/)
  assert.throws(() => f.install({ duration: NaN }), /duration/)
  assert.throws(() => f.install({ imagery: { maxLayers: 1000 } }), /maxLayers/)
  assert.equal(f.provider.endUpdate, original)
})

test('shader wrapping is idempotent and avoids clipping native full-tile edges', () => {
  const source = 'in vec3 v_textureCoordinates; void main() { out_FragColor = vec4(1.0); }'
  const wrapped = wrapTerrainFragment(source)
  assert.equal(wrapTerrainFragment(wrapped), wrapped)
  assert.match(wrapped, /u_lodRegion.x > 0.0/)
  assert.throws(() => wrapTerrainFragment('no main'), /Unsupported/)
})

test('an incompatible shader layout rejects attachment before changing methods', () => {
  const f = fixture(), original = f.provider.endUpdate
  f.shaders.baseFragmentShaderSource.sources = ['no globe main']
  assert.throws(() => f.install(), /Expected one/)
  assert.equal(f.provider.endUpdate, original)
})
