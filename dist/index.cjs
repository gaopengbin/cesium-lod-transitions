var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  CesiumLodTransitions: () => CesiumLodTransitions,
  VERSION: () => VERSION,
  createLodTransitions: () => createLodTransitions
});
module.exports = __toCommonJS(index_exports);

// src/imagery-controller.js
var clamp = (value) => Math.max(0, Math.min(1, value));
var mercator = (latitude) => Math.log(Math.tan(Math.PI / 4 + Math.max(-1.4844222297, Math.min(1.4844222297, latitude)) / 2));
var inverseMercator = (value) => 2 * Math.atan(Math.exp(value)) - Math.PI / 2;
function coverageFromUv(rectangle, uv, webMercator) {
  const south = webMercator ? mercator(rectangle.south) : rectangle.south;
  const north = webMercator ? mercator(rectangle.north) : rectangle.north;
  const latitude = (t) => webMercator ? inverseMercator(south + (north - south) * t) : south + (north - south) * t;
  return {
    west: rectangle.west + (rectangle.east - rectangle.west) * uv.x,
    south: latitude(uv.y),
    east: rectangle.west + (rectangle.east - rectangle.west) * uv.z,
    north: latitude(uv.w)
  };
}
function uvFromCoverage(rectangle, coverage, webMercator) {
  const south = webMercator ? mercator(rectangle.south) : rectangle.south;
  const north = webMercator ? mercator(rectangle.north) : rectangle.north;
  const latitude = (value) => ((webMercator ? mercator(value) : value) - south) / (north - south);
  return {
    x: clamp((coverage.west - rectangle.west) / (rectangle.east - rectangle.west)),
    y: clamp(latitude(coverage.south)),
    z: clamp((coverage.east - rectangle.west) / (rectangle.east - rectangle.west)),
    w: clamp(latitude(coverage.north))
  };
}
function intersection(a, b) {
  const west = Math.max(a.west, b.west);
  const south = Math.max(a.south, b.south);
  const east = Math.min(a.east, b.east);
  const north = Math.min(a.north, b.north);
  if (east - west <= 1e-10 || north - south <= 1e-10) return void 0;
  return { west, south, east, north };
}
function retain(images, imagery) {
  if (images.has(imagery)) return;
  imagery.addReference();
  images.add(imagery);
}
function release(images) {
  for (const imagery of images) imagery.releaseReference();
  images.clear();
}
function subtractRectangle(source, cover) {
  const overlap = intersection(source, cover);
  if (!overlap) return [source];
  const result = [];
  if (source.west < overlap.west) result.push({ ...source, east: overlap.west });
  if (overlap.east < source.east) result.push({ ...source, west: overlap.east });
  if (source.south < overlap.south) result.push({ west: overlap.west, east: overlap.east, south: source.south, north: overlap.south });
  if (overlap.north < source.north) result.push({ west: overlap.west, east: overlap.east, south: overlap.north, north: source.north });
  return result;
}
function visibleSources(sources) {
  const visible = [];
  for (let i = 0; i < sources.length; i++) {
    let regions = [sources[i].coverage];
    for (let j = i + 1; j < sources.length && regions.length; j++) {
      if (sources[j].alpha < 0.9999) continue;
      regions = regions.flatMap((region) => subtractRectangle(region, sources[j].coverage));
    }
    for (const coverage of regions) visible.push({ ...sources[i], coverage });
  }
  return visible;
}
function coalesceSources(sources) {
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  const result = sources.map((source) => ({ ...source, coverage: { ...source.coverage } }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        if (a.imagery !== b.imagery || a.webMercator !== b.webMercator || Math.abs(a.alpha - b.alpha) > 1e-4) continue;
        const p = a.coverage;
        const q = b.coverage;
        const horizontal = close(p.south, q.south) && close(p.north, q.north) && p.west <= q.east + 1e-9 && q.west <= p.east + 1e-9;
        const vertical = close(p.west, q.west) && close(p.east, q.east) && p.south <= q.north + 1e-9 && q.south <= p.north + 1e-9;
        if (!horizontal && !vertical) continue;
        a.coverage = { west: Math.min(p.west, q.west), south: Math.min(p.south, q.south), east: Math.max(p.east, q.east), north: Math.max(p.north, q.north) };
        result.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return result;
}
var TileFadeController = class {
  constructor({ now = () => performance.now(), duration = 800, maxLayers = 32 } = {}) {
    this.now = now;
    this.duration = duration;
    this.maxLayers = maxLayers;
    this.enabled = true;
    this.frame = -1;
    this.previousDraws = [];
    this.currentDraws = [];
    this.previousHeld = /* @__PURE__ */ new Set();
    this.currentHeld = /* @__PURE__ */ new Set();
    this.previousTargets = /* @__PURE__ */ new Map();
    this.currentTargets = /* @__PURE__ */ new Map();
    this.states = /* @__PURE__ */ new Map();
    this.stats = { started: 0, completed: 0, zoomIn: 0, zoomOut: 0, budgetSkips: 0, active: 0, extraSamplers: 0, levels: [] };
    this.samples = [];
  }
  beginFrame(frame) {
    if (frame === this.frame) return;
    release(this.previousHeld);
    this.previousDraws = this.currentDraws;
    this.previousHeld = this.currentHeld;
    this.currentDraws = [];
    this.currentHeld = /* @__PURE__ */ new Set();
    this.previousTargets = this.currentTargets;
    this.currentTargets = /* @__PURE__ */ new Map();
    this.frame = frame;
    this.stats.extraSamplers = 0;
    this.stats.levels = [];
    for (const [key, state] of this.states) {
      if (state.frame < frame - 1 || this.now() - state.start >= this.duration) {
        release(state.held);
        this.states.delete(key);
        this.stats.completed++;
      }
    }
    this.stats.active = this.states.size;
  }
  record(tile, item, alpha = 1) {
    const imagery = item.readyImagery;
    if (!imagery || alpha <= 0) return;
    const texture = item.useWebMercatorT ? imagery.textureWebMercator : imagery.texture;
    if (!texture) return;
    const coverage = coverageFromUv(tile.rectangle, item.textureCoordinateRectangle, item.useWebMercatorT);
    this.currentDraws.push({ imagery, coverage, alpha, webMercator: item.useWebMercatorT });
    retain(this.currentHeld, imagery);
  }
  expand(tile, original, frameState) {
    this.beginFrame(frameState.frameNumber);
    if (!this.enabled) return original;
    if (this.duration <= 0) {
      for (let index = 0; index < original.length; index++) {
        const item = original[index];
        this.record(tile, item);
        this.currentTargets.set(`${tile.level}/${tile.x}/${tile.y}/${index}`, item.readyImagery);
        const level = item.readyImagery?.level;
        if (level !== void 0 && !this.stats.levels.includes(level)) this.stats.levels.push(level);
      }
      return original;
    }
    const output = [];
    for (let index = 0; index < original.length; index++) {
      const item = original[index];
      const imagery = item.readyImagery;
      output.push(item);
      this.record(tile, item);
      if (!imagery || imagery.imageryLayer.alpha !== 1) continue;
      if (!this.stats.levels.includes(imagery.level)) this.stats.levels.push(imagery.level);
      const targetCoverage = coverageFromUv(tile.rectangle, item.textureCoordinateRectangle, item.useWebMercatorT);
      const key = `${tile.level}/${tile.x}/${tile.y}/${index}`;
      const stableTarget = this.previousTargets.get(key) === imagery;
      this.currentTargets.set(key, imagery);
      let state = this.states.get(key);
      if (state && state.target !== imagery) {
        release(state.held);
        this.states.delete(key);
        state = void 0;
      }
      const previous = this.previousDraws.filter((draw) => draw.imagery.imageryLayer === imagery.imageryLayer && intersection(draw.coverage, targetCoverage));
      const changed = previous.some((draw) => draw.imagery !== imagery);
      if (!state && changed && !stableTarget) {
        const sources = coalesceSources(visibleSources(previous.map((draw) => ({ ...draw, coverage: intersection(draw.coverage, targetCoverage) }))));
        if (sources.length >= this.maxLayers) {
          this.stats.budgetSkips++;
          continue;
        }
        const held = /* @__PURE__ */ new Set();
        for (const source of sources) retain(held, source.imagery);
        state = { target: imagery, start: this.now(), frame: this.frame, sources, held };
        this.states.set(key, state);
        this.stats.started++;
        const sourceLevel = Math.max(...sources.map((source) => source.imagery.level));
        if (sourceLevel < imagery.level) this.stats.zoomIn++;
        if (sourceLevel > imagery.level) this.stats.zoomOut++;
      }
      if (!state) continue;
      state.frame = this.frame;
      const linear = clamp((this.now() - state.start) / this.duration);
      const progress = linear * linear * (3 - 2 * linear);
      for (const source of state.sources) {
        const alpha = source.alpha * (1 - progress);
        if (alpha < 1e-3) continue;
        const entry = {
          readyImagery: source.imagery,
          loadingImagery: void 0,
          useWebMercatorT: source.webMercator,
          textureCoordinateRectangle: uvFromCoverage(tile.rectangle, source.coverage, source.webMercator),
          textureTranslationAndScale: void 0,
          _tileFadeAlpha: alpha
        };
        entry.textureTranslationAndScale = imagery.imageryLayer._calculateTextureTranslationAndScale(tile, entry);
        output.push(entry);
        this.record(tile, entry, alpha);
        this.stats.extraSamplers++;
        this.samples.push({ frame: this.frame, from: source.imagery.level, to: imagery.level, alpha: Number(alpha.toFixed(4)) });
        if (this.samples.length > 400) this.samples.splice(0, 200);
      }
    }
    this.stats.active = this.states.size;
    return output;
  }
  setEnabled(enabled) {
    this.reset();
    this.enabled = enabled;
  }
  reset() {
    for (const state of this.states.values()) release(state.held);
    this.states.clear();
    this.stats.active = 0;
    this.stats.extraSamplers = 0;
    release(this.previousHeld);
    release(this.currentHeld);
    this.previousDraws = [];
    this.currentDraws = [];
    this.previousTargets.clear();
    this.currentTargets.clear();
    this.frame = -1;
  }
  destroy() {
    this.setEnabled(false);
    release(this.previousHeld);
    release(this.currentHeld);
    this.previousDraws = [];
    this.currentDraws = [];
    this.previousTargets.clear();
    this.currentTargets.clear();
  }
};

// src/terrain-controller.js
var clamp2 = (value) => Math.max(0, Math.min(1, value));
var keyOf = (tile) => `${tile.level}/${tile.x}/${tile.y}`;
function describePair(progress, parent, child) {
  if (progress <= 0) return { primary: parent };
  if (progress >= 1) return { primary: child };
  const u = progress * progress * (3 - 2 * progress);
  const epsilon = 1 / 64;
  if (u < 0.5) return { primary: parent, secondary: child, weight: epsilon + (1 - epsilon) * 2 * u };
  const t = 2 * u - 1;
  return { primary: child, secondary: parent, weight: 1 - t + epsilon * t };
}
function intersect(a, b) {
  const result = { west: Math.max(a.west, b.west), east: Math.min(a.east, b.east), south: Math.max(a.south, b.south), north: Math.min(a.north, b.north) };
  return result.east - result.west > 1e-12 && result.north - result.south > 1e-12 ? result : void 0;
}
function subtract(source, cover) {
  const overlap = intersect(source, cover);
  if (!overlap) return [source];
  const result = [];
  if (source.west < overlap.west) result.push({ ...source, east: overlap.west });
  if (overlap.east < source.east) result.push({ ...source, west: overlap.east });
  if (source.south < overlap.south) result.push({ west: overlap.west, east: overlap.east, south: source.south, north: overlap.south });
  if (overlap.north < source.north) result.push({ west: overlap.west, east: overlap.east, south: overlap.north, north: source.north });
  return result;
}
function ancestorOf(ancestor, tile) {
  for (let node = tile; node && node.level >= ancestor.level; node = node.parent) if (node === ancestor) return true;
  return false;
}
function realMeshReady(tile) {
  const data = tile?.data;
  if (!data?.vertexArray || !data.mesh || !data.terrainData || data.vertexArray.isDestroyed?.()) return false;
  if (tile.upsampledFromParent || data.terrainData.wasCreatedByUpsampling?.()) return false;
  return data.imagery.some((item) => item.readyImagery?.texture || item.readyImagery?.textureWebMercator);
}
function meshBytes(tile) {
  return (tile.data?.mesh?.vertices?.byteLength || 0) + (tile.data?.mesh?.indices?.byteLength || 0);
}
function pin(set, tile) {
  const data = tile.data;
  if (!data?.vertexArray || set.has(data)) return;
  data._terrainLodRefs = (data._terrainLodRefs || 0) + 1;
  set.add(data);
}
function release2(set) {
  for (const data of set) data._terrainLodRefs = Math.max(0, (data._terrainLodRefs || 0) - 1);
  set.clear();
}
var TerrainLodTransition = class {
  constructor({ now = () => performance.now(), duration = 800, maxPairs = 64, maxExtraBytes = 32 * 1024 * 1024, maxCommands = 512 } = {}) {
    this.now = now;
    this.duration = duration;
    this.maxPairs = maxPairs;
    this.maxExtraBytes = maxExtraBytes;
    this.maxCommands = maxCommands;
    this.enabled = true;
    this.pairs = /* @__PURE__ */ new Map();
    this.previous = [];
    this.frameHeld = /* @__PURE__ */ new Set();
    this.waiting = /* @__PURE__ */ new Map();
    this.lastFrame = -1;
    this.cached = [];
    this.generation = 0;
    this.events = [];
    this.stats = { active: 0, waiting: 0, started: 0, reversed: 0, completed: 0, primary: 0, secondary: 0, extraMeshBytes: 0, pinnedMeshes: 0, endReasons: {}, levels: [] };
  }
  retire(key, reason) {
    const pair = this.pairs.get(key);
    if (!pair) return;
    release2(pair.held);
    this.pairs.delete(key);
    this.stats.endReasons[reason] = (this.stats.endReasons[reason] || 0) + 1;
    if (reason === "complete") this.stats.completed++;
  }
  clear(reason = "reset") {
    for (const key of [...this.pairs.keys()]) this.retire(key, reason);
    release2(this.frameHeld);
    this.previous = [];
    this.waiting.clear();
    this.cached = [];
    this.lastFrame = -1;
    this.stats.active = this.stats.waiting = this.stats.secondary = this.stats.extraMeshBytes = this.stats.pinnedMeshes = 0;
    this.stats.primary = 0;
    this.stats.levels = [];
  }
  setEnabled(enabled) {
    this.clear(enabled ? "enable" : "disabled");
    this.enabled = enabled;
  }
  tryStart(parent, child, target, now, goals) {
    const id = keyOf(child);
    if (this.pairs.has(id) || !realMeshReady(parent) || !realMeshReady(child)) return;
    if (child.parent !== parent) return;
    if ([...this.pairs.values()].some((pair2) => intersect(pair2.child.rectangle, child.rectangle))) return;
    const extra = new Set([...this.pairs.values()].map((pair2) => pair2.parent));
    extra.add(parent);
    if (this.pairs.size >= this.maxPairs || [...extra].reduce((sum, tile) => sum + meshBytes(tile), 0) > this.maxExtraBytes) {
      this.stats.endReasons.budget = (this.stats.endReasons.budget || 0) + 1;
      return;
    }
    if (!goals.some((goal) => intersect(goal.rectangle, child.rectangle))) return;
    const held = /* @__PURE__ */ new Set();
    pin(held, parent);
    pin(held, child);
    const pair = {
      id,
      generation: ++this.generation,
      parent,
      child,
      target,
      progress: target ? 0 : 1,
      lastTime: now,
      parentVertexArray: parent.data.vertexArray,
      childVertexArray: child.data.vertexArray,
      held
    };
    this.pairs.set(id, pair);
    this.stats.started++;
  }
  plan(goals, frame) {
    if (frame === this.lastFrame) return this.cached;
    const now = this.now();
    const previous = this.previous;
    const pending = [];
    const waiting = /* @__PURE__ */ new Map();
    if (this.enabled && this.duration > 0) {
      for (const [key, pair] of this.pairs) {
        if (pair.parent.data?.vertexArray !== pair.parentVertexArray || pair.child.data?.vertexArray !== pair.childVertexArray || !realMeshReady(pair.parent) || !realMeshReady(pair.child)) {
          this.retire(key, "generation");
          continue;
        }
        const relevant = goals.filter((goal) => intersect(goal.rectangle, pair.child.rectangle));
        if (!relevant.length) {
          this.retire(key, "invisible");
          continue;
        }
        const target = relevant.some((goal) => ancestorOf(pair.child, goal)) ? 1 : 0;
        if (target !== pair.target) this.stats.reversed++;
        pair.target = target;
        pair.progress = clamp2(pair.progress + (target ? 1 : -1) * Math.max(0, now - pair.lastTime) / this.duration);
        pair.lastTime = now;
        if (pair.progress === pair.target) this.retire(key, "complete");
      }
      for (const goal of goals) {
        let child = goal;
        for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
          if (previous.some((entry) => entry.tile === parent && intersect(entry.region, child.rectangle))) {
            this.tryStart(parent, child, 1, now, goals);
            if (!realMeshReady(child) && realMeshReady(parent)) {
              const id = keyOf(child);
              const since = this.waiting.get(id) ?? now;
              const heldParents = /* @__PURE__ */ new Set([...pending.map((entry) => entry.tile), ...[...this.pairs.values()].map((pair) => pair.parent), parent]);
              const bytes = [...heldParents].reduce((sum, tile) => sum + meshBytes(tile), 0);
              if (now - since < 2e3 && waiting.size + this.pairs.size < this.maxPairs && bytes <= this.maxExtraBytes) {
                waiting.set(id, since);
                for (const entry of previous.filter((entry2) => entry2.tile === parent)) {
                  const region = intersect(entry.region, goal.rectangle);
                  if (region) pending.push({ tile: parent, region });
                }
              }
            }
            break;
          }
        }
      }
      for (const entry of previous) {
        const child = entry.tile;
        const parent = child.parent;
        if (parent && goals.some((goal) => ancestorOf(goal, parent))) this.tryStart(parent, child, 0, now, goals);
      }
    }
    const primary = [];
    const secondary = [];
    for (const goal of goals) {
      let regions = [{ ...goal.rectangle }];
      for (const pair of this.pairs.values()) regions = regions.flatMap((region) => subtract(region, pair.child.rectangle));
      for (const hold of pending) regions = regions.flatMap((region) => subtract(region, hold.region));
      for (const region of regions) primary.push({ tile: goal, region, role: "primary", weight: 1 });
    }
    for (const hold of pending) {
      let regions = [hold.region];
      for (const pair of this.pairs.values()) regions = regions.flatMap((region) => subtract(region, pair.child.rectangle));
      for (const region of regions) primary.push({ tile: hold.tile, region, role: "primary", weight: 1 });
    }
    for (const pair of this.pairs.values()) {
      const roles = describePair(pair.progress, pair.parent, pair.child);
      const common = { region: { ...pair.child.rectangle }, pairId: pair.id, generation: pair.generation, progress: pair.progress };
      primary.push({ ...common, tile: roles.primary, role: "primary", weight: 1 });
      if (roles.secondary) secondary.push({ ...common, tile: roles.secondary, role: "secondary", weight: roles.weight });
      this.events.push({ frame, id: pair.id, generation: pair.generation, parent: keyOf(pair.parent), child: keyOf(pair.child), progress: pair.progress, target: pair.target, primary: keyOf(roles.primary), secondary: roles.secondary ? keyOf(roles.secondary) : null, weight: roles.weight ?? 0 });
    }
    let entries = [...primary, ...secondary];
    const retainedParents = new Set([...this.pairs.values()].map((pair) => pair.parent));
    for (const hold of pending) retainedParents.add(hold.tile);
    const retainedBytes = [...retainedParents].reduce((sum, tile) => sum + meshBytes(tile), 0);
    if (entries.length > this.maxCommands || retainedBytes > this.maxExtraBytes) {
      for (const key of [...this.pairs.keys()]) this.retire(key, entries.length > this.maxCommands ? "commands" : "bytes");
      waiting.clear();
      entries = goals.map((tile) => ({ tile, region: { ...tile.rectangle }, role: "primary", weight: 1 }));
    }
    const held = /* @__PURE__ */ new Set();
    if (this.enabled) for (const entry of entries) pin(held, entry.tile);
    release2(this.frameHeld);
    this.frameHeld = held;
    this.previous = this.enabled ? entries.filter((entry) => entry.role === "primary") : [];
    this.cached = entries;
    this.waiting = waiting;
    this.lastFrame = frame;
    const extra = new Set([...this.pairs.values()].map((pair) => pair.parent));
    if (waiting.size) for (const hold of pending) extra.add(hold.tile);
    this.stats.active = this.pairs.size;
    this.stats.waiting = waiting.size;
    this.stats.primary = entries.filter((entry) => entry.role === "primary").length;
    this.stats.secondary = entries.length - this.stats.primary;
    this.stats.extraMeshBytes = [...extra].reduce((sum, tile) => sum + meshBytes(tile), 0);
    this.stats.pinnedMeshes = held.size;
    this.stats.levels = [...new Set(entries.filter((entry) => entry.role === "primary").map((entry) => entry.tile.level))];
    if (this.events.length > 1e3) this.events.splice(0, 500);
    return entries;
  }
  destroy() {
    this.clear("destroy");
    this.enabled = false;
  }
};

// src/shader.js
var marker = "// cesium-lod-transitions:terrain-v1";
function wrapTerrainFragment(source) {
  if (source.includes(marker)) return source;
  if ((source.match(/void\s+main\s*\(\s*\)/g) || []).length !== 1) throw new Error("Unsupported Cesium globe fragment shader");
  return `${marker}
uniform vec4 u_lodRegion;
uniform float u_lodWeight;
uniform vec4 u_lodTint;
${source.replace(/void\s+main\s*\(\s*\)/, "void lodOriginalMain()")}
void main() {
  vec2 uv = v_textureCoordinates.xy;
  if ((u_lodRegion.x > 0.0 && uv.x < u_lodRegion.x) ||
      (u_lodRegion.y > 0.0 && uv.y < u_lodRegion.y) ||
      (u_lodRegion.z < 1.0 && uv.x >= u_lodRegion.z) ||
      (u_lodRegion.w < 1.0 && uv.y >= u_lodRegion.w)) discard;
  lodOriginalMain();
  out_FragColor.rgb = mix(out_FragColor.rgb, u_lodTint.rgb, u_lodTint.a);
  out_FragColor *= u_lodWeight;
}
`;
}
function patchFragmentSources(shaderSource) {
  const indices = shaderSource.sources.map((source, index) => /void\s+main\s*\(\s*\)/.test(source) ? index : -1).filter((index) => index >= 0);
  if (indices.length !== 1) throw new Error("Expected one Cesium globe fragment main");
  const clone = shaderSource.clone();
  clone.sources[indices[0]] = wrapTerrainFragment(clone.sources[indices[0]]);
  return clone;
}

// src/imagery-adapter.js
function weightImagery(items) {
  return items.map((item) => {
    if (item._tileFadeAlpha === void 0 || !item.readyImagery) return item;
    const original = item.readyImagery;
    const layer = Object.create(original.imageryLayer);
    Object.defineProperty(layer, "alpha", { value: original.imageryLayer.alpha * item._tileFadeAlpha });
    const imagery = Object.create(original);
    Object.defineProperty(imagery, "imageryLayer", { value: layer });
    return { ...item, readyImagery: imagery };
  });
}

// src/index.js
var VERSION = "0.1.0";
var instances = /* @__PURE__ */ new WeakMap();
var fullRegion = { x: 0, y: 0, z: 1, w: 1 };
var noTint = { x: 0, y: 0, z: 0, w: 0 };
var feature = (value) => typeof value === "object" && value !== null ? { enabled: true, ...value } : { enabled: value !== false };
var own = (object, name) => Object.getOwnPropertyDescriptor(object, name);
function positive(value, name, max = Infinity) {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`${name} must be finite and between 0 and ${max}`);
  return value;
}
function restore(object, name, descriptor) {
  if (descriptor) Object.defineProperty(object, name, descriptor);
  else delete object[name];
}
var CesiumLodTransitions = class {
  constructor(viewer, options = {}) {
    const C = options.Cesium ?? globalThis.Cesium;
    if (!C || !/^1\.145\./.test(C.VERSION)) throw new Error("cesium-lod-transitions 0.1 supports CesiumJS 1.145.x (tested 1.145.0); pass { Cesium } from your Viewer module");
    if (viewer?.isDestroyed?.()) throw new Error("Cannot attach to a destroyed Viewer");
    const scene = viewer?.scene;
    const globe = scene?.globe;
    const quadtree = globe?._surface;
    const provider = quadtree?._tileProvider;
    const shaders = provider?._surfaceShaderSet;
    if (!provider || !shaders?.getShaderProgram || !provider.endUpdate || !provider.updateForPick || !Array.isArray(provider._drawCommands) || !quadtree.forEachLoadedTile) {
      throw new Error("Unsupported Cesium globe internals; no hooks were installed");
    }
    if (instances.has(globe)) throw new Error("This Viewer already has CesiumLodTransitions; destroy the previous instance first");
    patchFragmentSources(shaders.baseFragmentShaderSource);
    const duration = positive(options.duration ?? 800, "duration", 6e4);
    const image = feature(options.imagery);
    const terrain = feature(options.terrain);
    for (const [name, value] of Object.entries({ imageryDuration: image.duration ?? duration, terrainDuration: terrain.duration ?? duration })) positive(value, name, 6e4);
    positive(image.maxLayers ?? 8, "imagery.maxLayers", 8);
    for (const [name, value] of Object.entries({ maxPairs: terrain.maxPairs ?? 64, maxCommands: terrain.maxCommands ?? 512, maxExtraBytes: terrain.maxExtraBytes ?? 32 * 1024 * 1024 })) positive(value, `terrain.${name}`);
    this._C = C;
    this._viewer = viewer;
    this._scene = scene;
    this._globe = globe;
    this._quadtree = quadtree;
    this._provider = provider;
    this._shaders = shaders;
    this._imagery = new TileFadeController({ duration: image.duration ?? duration, maxLayers: image.maxLayers ?? 8 });
    this._terrain = new TerrainLodTransition({ duration: terrain.duration ?? duration, maxPairs: terrain.maxPairs, maxExtraBytes: terrain.maxExtraBytes, maxCommands: terrain.maxCommands });
    const reduced = options.respectReducedMotion !== false && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this._wanted = { imagery: !!image.enabled && !reduced, terrain: !!terrain.enabled && !reduced };
    this._imagery.setEnabled(this._wanted.imagery);
    this._terrain.setEnabled(this._wanted.terrain);
    this._debug = !!options.debug;
    this._destroyed = false;
    this._suspended = [];
    this._pins = /* @__PURE__ */ new Map();
    this._bases = /* @__PURE__ */ new Map();
    this._patchedBase = void 0;
    this._states = /* @__PURE__ */ new Map();
    this._tail = 0;
    this._commands = 0;
    this._terrainProvider = globe.terrainProvider;
    this._removers = [];
    const gl = scene.context?._gl;
    this._textureLimit = gl ? Math.max(1, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) - 4) : 12;
    const end = provider.endUpdate;
    const pick = provider.updateForPick;
    const destroy = viewer.destroy;
    this._originalEnd = end;
    this._originalPick = pick;
    this._originalDestroy = destroy;
    this._descriptors = { end: own(provider, "endUpdate"), pick: own(provider, "updateForPick"), destroy: own(viewer, "destroy") };
    const plugin = this;
    this._endHook = function(frame) {
      return plugin._render(frame, end, this);
    };
    this._pickHook = function(frame) {
      if (plugin._destroyed) return pick.call(this, frame);
      const all = this._drawCommands;
      const count = this._usedDrawCommands;
      const filtered = all.slice(0, count).filter((command) => command._lodRole !== "secondary");
      this._drawCommands = filtered;
      this._usedDrawCommands = filtered.length;
      try {
        return pick.call(this, frame);
      } finally {
        this._drawCommands = all;
        this._usedDrawCommands = count;
      }
    };
    this._destroyHook = function(...args) {
      plugin.destroy();
      return destroy.apply(this, args);
    };
    provider.endUpdate = this._endHook;
    provider.updateForPick = this._pickHook;
    viewer.destroy = this._destroyHook;
    instances.set(globe, this);
    this._listen(scene.postRender, () => {
      if (this._imagery.stats.active || this._terrain.stats.active || this._terrain.stats.waiting) this._tail = 2;
      if (this._tail > 0) {
        this._tail--;
        scene.requestRender();
      }
    });
    for (const name of ["layerAdded", "layerRemoved", "layerMoved", "layerShownOrHidden"]) this._listen(viewer.imageryLayers[name], () => this.reset());
    this._lost = () => this.reset();
    scene.canvas.addEventListener("webglcontextlost", this._lost);
    scene.requestRender();
  }
  _listen(event, callback) {
    if (event?.addEventListener) this._removers.push(event.addEventListener(callback));
  }
  _invalidateShaders() {
    const caches = this._shaders._shadersByTexturesFlags;
    for (const byFlags of Object.values(caches)) {
      if (!byFlags) continue;
      for (const shader of Object.values(byFlags)) if (shader?.shaderProgram && !shader.shaderProgram.isDestroyed()) shader.shaderProgram.destroy();
    }
    this._shaders._shadersByTexturesFlags = [];
    this._quadtree.forEachLoadedTile((tile) => {
      if (tile.data) tile.data.surfaceShader = void 0;
    });
  }
  _ensureShader() {
    const base = this._shaders.baseFragmentShaderSource;
    if (base === this._patchedBase) return;
    const patched = patchFragmentSources(base);
    this._invalidateShaders();
    this._bases.clear();
    this._bases.set(patched, base);
    this._shaders.baseFragmentShaderSource = patched;
    this._patchedBase = patched;
  }
  _syncPins() {
    const held = new Set(this._terrain.frameHeld);
    for (const pair of this._terrain.pairs.values()) for (const data of pair.held) held.add(data);
    for (const data of held) {
      if (this._pins.has(data)) continue;
      const descriptor = own(data, "eligibleForUnloading");
      let prototype = data;
      let original;
      while (prototype && !original) {
        original = own(prototype, "eligibleForUnloading");
        prototype = Object.getPrototypeOf(prototype);
      }
      if (!original?.get) throw new Error("Unsupported Cesium surface unload guard");
      Object.defineProperty(data, "eligibleForUnloading", { configurable: true, get() {
        return this._terrainLodRefs > 0 ? false : original.get.call(this);
      } });
      this._pins.set(data, descriptor);
    }
    for (const [data, descriptor] of this._pins) {
      if ((data._terrainLodRefs || 0) > 0) continue;
      restore(data, "eligibleForUnloading", descriptor);
      this._pins.delete(data);
    }
  }
  _support(frame) {
    const reasons = [];
    const shown = [];
    for (let i = 0; i < this._viewer.imageryLayers.length; i++) {
      const layer = this._viewer.imageryLayers.get(i);
      if (layer.show) shown.push(layer);
    }
    if (frame.mode !== this._C.SceneMode.SCENE3D) reasons.push("3D globe only");
    if (shown.length !== 1 || shown[0]?.alpha !== 1) reasons.push("one opaque imagery layer required");
    if (this._globe.translucency?.enabled) reasons.push("globe translucency");
    if (this._globe.material) reasons.push("custom globe material");
    if (this._scene.shadowMap?.enabled) reasons.push("shadows");
    if (this._globe.terrainProvider?.hasWaterMask) reasons.push("water masks");
    if (this._globe.clippingPlanes?.length || this._globe.clippingPolygons?.length) reasons.push("globe clipping");
    if (this._quadtree._tilesToRender?.some((tile) => tile.data?.vectorData?.show)) reasons.push("vector globe features");
    this._suspended = reasons;
    return reasons.length === 0;
  }
  _render(frame, original, receiver) {
    if (this._destroyed) return original.call(receiver, frame);
    if (this._terrainProvider !== this._globe.terrainProvider) {
      this.reset();
      this._terrainProvider = this._globe.terrainProvider;
    }
    const supported = this._support(frame);
    const imageEnabled = supported && this._wanted.imagery;
    const terrainEnabled = supported && this._wanted.terrain;
    if (this._imagery.enabled !== imageEnabled) this._imagery.setEnabled(imageEnabled);
    if (this._terrain.enabled !== terrainEnabled) this._terrain.setEnabled(terrainEnabled);
    const groups = this._provider._tilesToRenderByTextureCount;
    const goals = groups.flat().filter(Boolean);
    this._imagery.beginFrame(frame.frameNumber);
    let entries = terrainEnabled ? this._terrain.plan(goals, frame.frameNumber) : goals.map((tile) => ({ tile, region: tile.rectangle, role: "primary", weight: 1 }));
    this._syncPins();
    const changed = /* @__PURE__ */ new Map();
    const byTile = /* @__PURE__ */ new Map();
    try {
      if (imageEnabled) {
        for (const { tile } of entries) {
          if (byTile.has(tile)) continue;
          const expanded = this._imagery.expand(tile, tile.data.imagery, frame);
          byTile.set(tile, weightImagery(expanded));
        }
        if ([...byTile.values()].some((items) => items.filter((item) => item.readyImagery).length > this._textureLimit)) {
          byTile.clear();
          this._imagery.reset();
          this._suspended.push("imagery texture budget exceeded");
        }
      }
      if (terrainEnabled && entries.some(({ tile }) => (byTile.get(tile) || tile.data.imagery).filter((item) => item.readyImagery).length > this._textureLimit)) {
        this._terrain.clear("texture-budget");
        this._syncPins();
        entries = goals.map((tile) => ({ tile, region: tile.rectangle, role: "primary", weight: 1 }));
        this._suspended.push("terrain texture budget exceeded");
      }
      for (const [tile, items] of byTile) {
        changed.set(tile.data, tile.data.imagery);
        tile.data.imagery = items;
      }
      const owners = /* @__PURE__ */ new WeakMap();
      const draws = entries.map((entry) => {
        const tile = new Proxy(entry.tile, {});
        owners.set(tile, entry);
        return tile;
      });
      this._ensureShader();
      this._provider._tilesToRenderByTextureCount = [draws];
      const result = original.call(receiver, frame);
      this._commands = this._provider._usedDrawCommands;
      for (let i = 0; i < this._commands; i++) {
        const command = this._provider._drawCommands[i];
        const entry = owners.get(command.owner);
        this._style(command, entry, terrainEnabled);
        if (entry) command.owner = entry.tile;
      }
      return result;
    } finally {
      this._provider._tilesToRenderByTextureCount = groups;
      for (const [data, imagery] of changed) data.imagery = imagery;
    }
  }
  _style(command, entry, terrainEnabled) {
    const C = this._C;
    const role = entry?.role || "primary";
    command._lodRole = role;
    if (terrainEnabled && entry) {
      const key = `${command.renderState.id}/${role}`;
      if (!this._states.has(key)) {
        const state = C.RenderState.getState(command.renderState);
        state.depthTest = { enabled: true, func: C.DepthFunction.LESS_OR_EQUAL };
        state.depthMask = role === "primary";
        if (role === "secondary") state.blending = C.BlendingState.PRE_MULTIPLIED_ALPHA_BLEND;
        this._states.set(key, C.RenderState.fromCache(state));
      }
      command.renderState = this._states.get(key);
      if (role === "secondary") command.castShadows = false;
    }
    let region = fullRegion;
    if (entry?.pairId || terrainEnabled && entry) {
      const r = entry.region;
      const t = entry.tile.rectangle;
      region = { x: (r.west - t.west) / (t.east - t.west), y: (r.south - t.south) / (t.north - t.south), z: (r.east - t.west) / (t.east - t.west), w: (r.north - t.south) / (t.north - t.south) };
    }
    const weight = entry?.weight ?? 1;
    const tint = !this._debug || !entry?.pairId ? noTint : role === "secondary" ? { x: 1, y: 0.48, z: 0.16, w: 0.3 } : { x: 0.12, y: 0.85, z: 0.7, w: 0.3 };
    command.uniformMap = { ...command.uniformMap, u_lodRegion: () => region, u_lodWeight: () => weight, u_lodTint: () => tint };
    command.dirty = true;
  }
  _assertAlive() {
    if (this._destroyed) throw new Error("CesiumLodTransitions has been destroyed");
  }
  setEnabled(enabled) {
    this._assertAlive();
    this._wanted = { imagery: !!enabled, terrain: !!enabled };
    return this.reset();
  }
  setImageryEnabled(enabled) {
    this._assertAlive();
    this._wanted.imagery = !!enabled;
    this._imagery.setEnabled(!!enabled);
    this._scene.requestRender();
    return this;
  }
  setTerrainEnabled(enabled) {
    this._assertAlive();
    this._wanted.terrain = !!enabled;
    this._terrain.setEnabled(!!enabled);
    this._syncPins();
    this._scene.requestRender();
    return this;
  }
  setDuration(milliseconds) {
    this._assertAlive();
    positive(milliseconds, "duration", 6e4);
    this._imagery.duration = this._terrain.duration = milliseconds;
    this._scene.requestRender();
    return this;
  }
  setDebug(enabled) {
    this._assertAlive();
    this._debug = !!enabled;
    this._scene.requestRender();
    return this;
  }
  reset() {
    this._assertAlive();
    this._imagery.setEnabled(this._wanted.imagery);
    this._terrain.setEnabled(this._wanted.terrain);
    this._syncPins();
    this._scene.requestRender();
    return this;
  }
  getStats() {
    return {
      cesiumVersion: this._C.VERSION,
      destroyed: this._destroyed,
      enabled: { ...this._wanted },
      suspended: [...this._suspended],
      imagery: { ...this._imagery.stats, levels: [...this._imagery.stats.levels] },
      terrain: { ...this._terrain.stats, levels: [...this._terrain.stats.levels], endReasons: { ...this._terrain.stats.endReasons } },
      commands: this._commands
    };
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    if (this._destroyed) return;
    this._imagery.destroy();
    this._terrain.destroy();
    this._syncPins();
    this._destroyed = true;
    for (const remove of this._removers) remove();
    this._scene.canvas.removeEventListener("webglcontextlost", this._lost);
    if (this._provider.endUpdate === this._endHook) restore(this._provider, "endUpdate", this._descriptors.end);
    if (this._provider.updateForPick === this._pickHook) restore(this._provider, "updateForPick", this._descriptors.pick);
    if (this._viewer.destroy === this._destroyHook) restore(this._viewer, "destroy", this._descriptors.destroy);
    if (this._bases.has(this._shaders.baseFragmentShaderSource)) {
      this._shaders.baseFragmentShaderSource = this._bases.get(this._shaders.baseFragmentShaderSource);
      this._invalidateShaders();
    }
    for (const command of this._provider._drawCommands) delete command._lodRole;
    this._bases.clear();
    this._states.clear();
    this._commands = 0;
    this._wanted = { imagery: false, terrain: false };
    instances.delete(this._globe);
    this._scene.requestRender();
  }
};
function createLodTransitions(viewer, options) {
  return new CesiumLodTransitions(viewer, options);
}
//# sourceMappingURL=index.cjs.map
