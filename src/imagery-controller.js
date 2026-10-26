const clamp = value => Math.max(0, Math.min(1, value))
const mercator = latitude => Math.log(Math.tan(Math.PI / 4 + Math.max(-1.4844222297, Math.min(1.4844222297, latitude)) / 2))
const inverseMercator = value => 2 * Math.atan(Math.exp(value)) - Math.PI / 2

export function coverageFromUv(rectangle, uv, webMercator) {
  const south = webMercator ? mercator(rectangle.south) : rectangle.south
  const north = webMercator ? mercator(rectangle.north) : rectangle.north
  const latitude = t => webMercator ? inverseMercator(south + (north - south) * t) : south + (north - south) * t
  return {
    west: rectangle.west + (rectangle.east - rectangle.west) * uv.x,
    south: latitude(uv.y),
    east: rectangle.west + (rectangle.east - rectangle.west) * uv.z,
    north: latitude(uv.w),
  }
}

export function uvFromCoverage(rectangle, coverage, webMercator) {
  const south = webMercator ? mercator(rectangle.south) : rectangle.south
  const north = webMercator ? mercator(rectangle.north) : rectangle.north
  const latitude = value => ((webMercator ? mercator(value) : value) - south) / (north - south)
  return {
    x: clamp((coverage.west - rectangle.west) / (rectangle.east - rectangle.west)),
    y: clamp(latitude(coverage.south)),
    z: clamp((coverage.east - rectangle.west) / (rectangle.east - rectangle.west)),
    w: clamp(latitude(coverage.north)),
  }
}

function intersection(a, b) {
  const west = Math.max(a.west, b.west)
  const south = Math.max(a.south, b.south)
  const east = Math.min(a.east, b.east)
  const north = Math.min(a.north, b.north)
  if (east - west <= 1e-10 || north - south <= 1e-10) return undefined
  return { west, south, east, north }
}

function retain(images, imagery) {
  if (images.has(imagery)) return
  imagery.addReference()
  images.add(imagery)
}

function release(images) {
  for (const imagery of images) imagery.releaseReference()
  images.clear()
}

function subtractRectangle(source, cover) {
  const overlap = intersection(source, cover)
  if (!overlap) return [source]
  const result = []
  if (source.west < overlap.west) result.push({ ...source, east: overlap.west })
  if (overlap.east < source.east) result.push({ ...source, west: overlap.east })
  if (source.south < overlap.south) result.push({ west: overlap.west, east: overlap.east, south: source.south, north: overlap.south })
  if (overlap.north < source.north) result.push({ west: overlap.west, east: overlap.east, south: overlap.north, north: source.north })
  return result
}

function visibleSources(sources) {
  const visible = []
  for (let i = 0; i < sources.length; i++) {
    let regions = [sources[i].coverage]
    for (let j = i + 1; j < sources.length && regions.length; j++) {
      if (sources[j].alpha < 0.9999) continue
      regions = regions.flatMap(region => subtractRectangle(region, sources[j].coverage))
    }
    for (const coverage of regions) visible.push({ ...sources[i], coverage })
  }
  return visible
}

function coalesceSources(sources) {
  const close = (a, b) => Math.abs(a - b) < 1e-9
  const result = sources.map(source => ({ ...source, coverage: { ...source.coverage } }))
  // One imagery tile is often split over several terrain meshes. Merge only
  // rectangular unions with matching textures/weights; never bridge a gap.
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]
        const b = result[j]
        if (a.imagery !== b.imagery || a.webMercator !== b.webMercator || Math.abs(a.alpha - b.alpha) > 0.0001) continue
        const p = a.coverage
        const q = b.coverage
        const horizontal = close(p.south, q.south) && close(p.north, q.north) && p.west <= q.east + 1e-9 && q.west <= p.east + 1e-9
        const vertical = close(p.west, q.west) && close(p.east, q.east) && p.south <= q.north + 1e-9 && q.south <= p.north + 1e-9
        if (!horizontal && !vertical) continue
        a.coverage = { west: Math.min(p.west, q.west), south: Math.min(p.south, q.south), east: Math.max(p.east, q.east), north: Math.max(p.north, q.north) }
        result.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  return result
}

// Opaque, non-wrapping base imagery. Cesium still owns loading and textures.
export class TileFadeController {
  constructor({ now = () => performance.now(), duration = 800, maxLayers = 32 } = {}) {
    this.now = now
    this.duration = duration
    this.maxLayers = maxLayers
    this.enabled = true
    this.frame = -1
    this.previousDraws = []
    this.currentDraws = []
    this.previousHeld = new Set()
    this.currentHeld = new Set()
    this.previousTargets = new Map()
    this.currentTargets = new Map()
    this.states = new Map()
    this.stats = { started: 0, completed: 0, zoomIn: 0, zoomOut: 0, budgetSkips: 0, active: 0, extraSamplers: 0, levels: [] }
    this.samples = []
  }

  beginFrame(frame) {
    if (frame === this.frame) return
    release(this.previousHeld)
    this.previousDraws = this.currentDraws
    this.previousHeld = this.currentHeld
    this.currentDraws = []
    this.currentHeld = new Set()
    this.previousTargets = this.currentTargets
    this.currentTargets = new Map()
    this.frame = frame
    this.stats.extraSamplers = 0
    this.stats.levels = []
    for (const [key, state] of this.states) {
      if (state.frame < frame - 1 || this.now() - state.start >= this.duration) {
        release(state.held)
        this.states.delete(key)
        this.stats.completed++
      }
    }
    this.stats.active = this.states.size
  }

  record(tile, item, alpha = 1) {
    const imagery = item.readyImagery
    if (!imagery || alpha <= 0) return
    const texture = item.useWebMercatorT ? imagery.textureWebMercator : imagery.texture
    if (!texture) return
    const coverage = coverageFromUv(tile.rectangle, item.textureCoordinateRectangle, item.useWebMercatorT)
    this.currentDraws.push({ imagery, coverage, alpha, webMercator: item.useWebMercatorT })
    retain(this.currentHeld, imagery)
  }

  expand(tile, original, frameState) {
    this.beginFrame(frameState.frameNumber)
    if (!this.enabled) return original
    if (this.duration <= 0) {
      for (let index = 0; index < original.length; index++) {
        const item = original[index]
        this.record(tile, item)
        this.currentTargets.set(`${tile.level}/${tile.x}/${tile.y}/${index}`, item.readyImagery)
        const level = item.readyImagery?.level
        if (level !== undefined && !this.stats.levels.includes(level)) this.stats.levels.push(level)
      }
      return original
    }
    const output = []
    for (let index = 0; index < original.length; index++) {
      const item = original[index]
      const imagery = item.readyImagery
      output.push(item)
      this.record(tile, item)
      if (!imagery || imagery.imageryLayer.alpha !== 1) continue
      if (!this.stats.levels.includes(imagery.level)) this.stats.levels.push(imagery.level)
      const targetCoverage = coverageFromUv(tile.rectangle, item.textureCoordinateRectangle, item.useWebMercatorT)
      const key = `${tile.level}/${tile.x}/${tile.y}/${index}`
      const stableTarget = this.previousTargets.get(key) === imagery
      this.currentTargets.set(key, imagery)
      let state = this.states.get(key)
      if (state && state.target !== imagery) {
        release(state.held)
        this.states.delete(key)
        state = undefined
      }
      // Stable tiles need no transition. A tile absent from the last rendered
      // frame may be a parent on zoom-out or a child on zoom-in.
      const previous = this.previousDraws.filter(draw => draw.imagery.imageryLayer === imagery.imageryLayer && intersection(draw.coverage, targetCoverage))
      const changed = previous.some(draw => draw.imagery !== imagery)
      if (!state && changed && !stableTarget) {
        const sources = coalesceSources(visibleSources(previous.map(draw => ({ ...draw, coverage: intersection(draw.coverage, targetCoverage) }))))
        // The footprint can cover many children after a large zoom-out. Skip
        // this transition rather than pin unbounded textures or build a shader
        // with an unbounded number of texture slots.
        if (sources.length >= this.maxLayers) {
          this.stats.budgetSkips++
          continue
        }
        const held = new Set()
        for (const source of sources) retain(held, source.imagery)
        state = { target: imagery, start: this.now(), frame: this.frame, sources, held }
        this.states.set(key, state)
        this.stats.started++
        const sourceLevel = Math.max(...sources.map(source => source.imagery.level))
        if (sourceLevel < imagery.level) this.stats.zoomIn++
        if (sourceLevel > imagery.level) this.stats.zoomOut++
      }
      if (!state) continue
      state.frame = this.frame
      const linear = clamp((this.now() - state.start) / this.duration)
      const progress = linear * linear * (3 - 2 * linear)
      for (const source of state.sources) {
        const alpha = source.alpha * (1 - progress)
        if (alpha < 0.001) continue
        const entry = {
          readyImagery: source.imagery,
          loadingImagery: undefined,
          useWebMercatorT: source.webMercator,
          textureCoordinateRectangle: uvFromCoverage(tile.rectangle, source.coverage, source.webMercator),
          textureTranslationAndScale: undefined,
          _tileFadeAlpha: alpha,
        }
        // Transform against the destination terrain tile, not the old mesh.
        entry.textureTranslationAndScale = imagery.imageryLayer._calculateTextureTranslationAndScale(tile, entry)
        output.push(entry)
        this.record(tile, entry, alpha)
        this.stats.extraSamplers++
        this.samples.push({ frame: this.frame, from: source.imagery.level, to: imagery.level, alpha: Number(alpha.toFixed(4)) })
        if (this.samples.length > 400) this.samples.splice(0, 200)
      }
    }
    this.stats.active = this.states.size
    return output
  }

  setEnabled(enabled) {
    this.reset()
    this.enabled = enabled
  }

  reset() {
    for (const state of this.states.values()) release(state.held)
    this.states.clear()
    this.stats.active = 0
    this.stats.extraSamplers = 0
    release(this.previousHeld)
    release(this.currentHeld)
    this.previousDraws = []
    this.currentDraws = []
    this.previousTargets.clear()
    this.currentTargets.clear()
    this.frame = -1
  }

  destroy() {
    this.setEnabled(false)
    release(this.previousHeld)
    release(this.currentHeld)
    this.previousDraws = []
    this.currentDraws = []
    this.previousTargets.clear()
    this.currentTargets.clear()
  }
}
