/* global performance */
const clamp = value => Math.max(0, Math.min(1, value))
const keyOf = tile => `${tile.level}/${tile.x}/${tile.y}`

export function describePair(progress, parent, child) {
  if (progress <= 0) return { primary: parent }
  if (progress >= 1) return { primary: child }
  const u = progress * progress * (3 - 2 * progress)
  const epsilon = 1 / 64
  if (u < 0.5) return { primary: parent, secondary: child, weight: epsilon + (1 - epsilon) * 2 * u }
  const t = 2 * u - 1
  return { primary: child, secondary: parent, weight: 1 - t + epsilon * t }
}

export function intersect(a, b) {
  const result = { west: Math.max(a.west, b.west), east: Math.min(a.east, b.east), south: Math.max(a.south, b.south), north: Math.min(a.north, b.north) }
  return result.east - result.west > 1e-12 && result.north - result.south > 1e-12 ? result : undefined
}

export function subtract(source, cover) {
  const overlap = intersect(source, cover)
  if (!overlap) return [source]
  const result = []
  if (source.west < overlap.west) result.push({ ...source, east: overlap.west })
  if (overlap.east < source.east) result.push({ ...source, west: overlap.east })
  if (source.south < overlap.south) result.push({ west: overlap.west, east: overlap.east, south: source.south, north: overlap.south })
  if (overlap.north < source.north) result.push({ west: overlap.west, east: overlap.east, south: overlap.north, north: source.north })
  return result
}

function ancestorOf(ancestor, tile) {
  for (let node = tile; node && node.level >= ancestor.level; node = node.parent) if (node === ancestor) return true
  return false
}

function realMeshReady(tile) {
  const data = tile?.data
  if (!data?.vertexArray || !data.mesh || !data.terrainData || data.vertexArray.isDestroyed?.()) return false
  if (tile.upsampledFromParent || data.terrainData.wasCreatedByUpsampling?.()) return false
  return data.imagery.some(item => item.readyImagery?.texture || item.readyImagery?.textureWebMercator)
}

function meshBytes(tile) {
  return (tile.data?.mesh?.vertices?.byteLength || 0) + (tile.data?.mesh?.indices?.byteLength || 0)
}

function pin(set, tile) {
  const data = tile.data
  if (!data?.vertexArray || set.has(data)) return
  data._terrainLodRefs = (data._terrainLodRefs || 0) + 1
  set.add(data)
}

function release(set) {
  for (const data of set) data._terrainLodRefs = Math.max(0, (data._terrainLodRefs || 0) - 1)
  set.clear()
}

export class TerrainLodTransition {
  constructor({ now = () => performance.now(), duration = 800, maxPairs = 64, maxExtraBytes = 32 * 1024 * 1024, maxCommands = 512 } = {}) {
    this.now = now
    this.duration = duration
    this.maxPairs = maxPairs
    this.maxExtraBytes = maxExtraBytes
    this.maxCommands = maxCommands
    this.enabled = true
    this.pairs = new Map()
    this.previous = []
    this.frameHeld = new Set()
    this.waiting = new Map()
    this.lastFrame = -1
    this.cached = []
    this.generation = 0
    this.events = []
    this.stats = { active: 0, waiting: 0, started: 0, reversed: 0, completed: 0, primary: 0, secondary: 0, extraMeshBytes: 0, pinnedMeshes: 0, endReasons: {}, levels: [] }
  }

  retire(key, reason) {
    const pair = this.pairs.get(key)
    if (!pair) return
    release(pair.held)
    this.pairs.delete(key)
    this.stats.endReasons[reason] = (this.stats.endReasons[reason] || 0) + 1
    if (reason === 'complete') this.stats.completed++
  }

  clear(reason = 'reset') {
    for (const key of [...this.pairs.keys()]) this.retire(key, reason)
    release(this.frameHeld)
    this.previous = []
    this.waiting.clear()
    this.cached = []
    this.lastFrame = -1
    this.stats.active = this.stats.waiting = this.stats.secondary = this.stats.extraMeshBytes = this.stats.pinnedMeshes = 0
    this.stats.primary = 0
    this.stats.levels = []
  }

  setEnabled(enabled) {
    this.clear(enabled ? 'enable' : 'disabled')
    this.enabled = enabled
  }

  tryStart(parent, child, target, now, goals) {
    const id = keyOf(child)
    if (this.pairs.has(id) || !realMeshReady(parent) || !realMeshReady(child)) return
    if (child.parent !== parent) return
    if ([...this.pairs.values()].some(pair => intersect(pair.child.rectangle, child.rectangle))) return
    const extra = new Set([...this.pairs.values()].map(pair => pair.parent))
    extra.add(parent)
    if (this.pairs.size >= this.maxPairs || [...extra].reduce((sum, tile) => sum + meshBytes(tile), 0) > this.maxExtraBytes) {
      this.stats.endReasons.budget = (this.stats.endReasons.budget || 0) + 1
      return
    }
    if (!goals.some(goal => intersect(goal.rectangle, child.rectangle))) return
    const held = new Set()
    pin(held, parent)
    pin(held, child)
    const pair = {
      id, generation: ++this.generation, parent, child, target,
      progress: target ? 0 : 1, lastTime: now,
      parentVertexArray: parent.data.vertexArray,
      childVertexArray: child.data.vertexArray,
      held,
    }
    this.pairs.set(id, pair)
    this.stats.started++
  }

  plan(goals, frame) {
    if (frame === this.lastFrame) return this.cached
    const now = this.now()
    const previous = this.previous
    const pending = []
    const waiting = new Map()
    if (this.enabled && this.duration > 0) {
      for (const [key, pair] of this.pairs) {
        if (pair.parent.data?.vertexArray !== pair.parentVertexArray || pair.child.data?.vertexArray !== pair.childVertexArray || !realMeshReady(pair.parent) || !realMeshReady(pair.child)) {
          this.retire(key, 'generation')
          continue
        }
        const relevant = goals.filter(goal => intersect(goal.rectangle, pair.child.rectangle))
        if (!relevant.length) {
          this.retire(key, 'invisible')
          continue
        }
        const target = relevant.some(goal => ancestorOf(pair.child, goal)) ? 1 : 0
        if (target !== pair.target) this.stats.reversed++
        pair.target = target
        pair.progress = clamp(pair.progress + (target ? 1 : -1) * Math.max(0, now - pair.lastTime) / this.duration)
        pair.lastTime = now
        if (pair.progress === pair.target) this.retire(key, 'complete')
      }

      // Step through true adjacent parent/child meshes, rather than stacking
      // several generations in one region after a large zoom.
      for (const goal of goals) {
        let child = goal
        for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
          if (previous.some(entry => entry.tile === parent && intersect(entry.region, child.rectangle))) {
            this.tryStart(parent, child, 1, now, goals)
            // Native selection can jump several levels before intermediate
            // imagery/VAOs are ready. Keep the old surface briefly, rather than
            // losing its ancestry and popping straight to the deepest mesh.
            if (!realMeshReady(child) && realMeshReady(parent)) {
              const id = keyOf(child)
              const since = this.waiting.get(id) ?? now
              const heldParents = new Set([...pending.map(entry => entry.tile), ...[...this.pairs.values()].map(pair => pair.parent), parent])
              const bytes = [...heldParents].reduce((sum, tile) => sum + meshBytes(tile), 0)
              if (now - since < 2000 && waiting.size + this.pairs.size < this.maxPairs && bytes <= this.maxExtraBytes) {
                waiting.set(id, since)
                for (const entry of previous.filter(entry => entry.tile === parent)) {
                  const region = intersect(entry.region, goal.rectangle)
                  if (region) pending.push({ tile: parent, region })
                }
              }
            }
            break
          }
        }
      }
      for (const entry of previous) {
        const child = entry.tile
        const parent = child.parent
        if (parent && goals.some(goal => ancestorOf(goal, parent))) this.tryStart(parent, child, 0, now, goals)
      }
    }

    const primary = []
    const secondary = []
    for (const goal of goals) {
      let regions = [{ ...goal.rectangle }]
      for (const pair of this.pairs.values()) regions = regions.flatMap(region => subtract(region, pair.child.rectangle))
      for (const hold of pending) regions = regions.flatMap(region => subtract(region, hold.region))
      for (const region of regions) primary.push({ tile: goal, region, role: 'primary', weight: 1 })
    }
    for (const hold of pending) {
      let regions = [hold.region]
      for (const pair of this.pairs.values()) regions = regions.flatMap(region => subtract(region, pair.child.rectangle))
      for (const region of regions) primary.push({ tile: hold.tile, region, role: 'primary', weight: 1 })
    }
    for (const pair of this.pairs.values()) {
      const roles = describePair(pair.progress, pair.parent, pair.child)
      const common = { region: { ...pair.child.rectangle }, pairId: pair.id, generation: pair.generation, progress: pair.progress }
      primary.push({ ...common, tile: roles.primary, role: 'primary', weight: 1 })
      if (roles.secondary) secondary.push({ ...common, tile: roles.secondary, role: 'secondary', weight: roles.weight })
      this.events.push({ frame, id: pair.id, generation: pair.generation, parent: keyOf(pair.parent), child: keyOf(pair.child), progress: pair.progress, target: pair.target, primary: keyOf(roles.primary), secondary: roles.secondary ? keyOf(roles.secondary) : null, weight: roles.weight ?? 0 })
    }
    let entries = [...primary, ...secondary]
    const retainedParents = new Set([...this.pairs.values()].map(pair => pair.parent))
    for (const hold of pending) retainedParents.add(hold.tile)
    const retainedBytes = [...retainedParents].reduce((sum, tile) => sum + meshBytes(tile), 0)
    if (entries.length > this.maxCommands || retainedBytes > this.maxExtraBytes) {
      for (const key of [...this.pairs.keys()]) this.retire(key, entries.length > this.maxCommands ? 'commands' : 'bytes')
      waiting.clear()
      entries = goals.map(tile => ({ tile, region: { ...tile.rectangle }, role: 'primary', weight: 1 }))
    }
    const held = new Set()
    if (this.enabled) for (const entry of entries) pin(held, entry.tile)
    release(this.frameHeld)
    this.frameHeld = held
    this.previous = this.enabled ? entries.filter(entry => entry.role === 'primary') : []
    this.cached = entries
    this.waiting = waiting
    this.lastFrame = frame
    const extra = new Set([...this.pairs.values()].map(pair => pair.parent))
    if (waiting.size) for (const hold of pending) extra.add(hold.tile)
    this.stats.active = this.pairs.size
    this.stats.waiting = waiting.size
    this.stats.primary = entries.filter(entry => entry.role === 'primary').length
    this.stats.secondary = entries.length - this.stats.primary
    this.stats.extraMeshBytes = [...extra].reduce((sum, tile) => sum + meshBytes(tile), 0)
    this.stats.pinnedMeshes = held.size
    this.stats.levels = [...new Set(entries.filter(entry => entry.role === 'primary').map(entry => entry.tile.level))]
    if (this.events.length > 1000) this.events.splice(0, 500)
    return entries
  }

  destroy() {
    this.clear('destroy')
    this.enabled = false
  }
}
