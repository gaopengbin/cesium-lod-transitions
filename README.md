# cesium-lod-transitions

[中文说明](README.zh-CN.md)

Per-Viewer **imagery tile cross-fading** and **experimental terrain LOD handoffs** for CesiumJS. Default duration: **800 ms**. ESM, CommonJS, browser script and TypeScript declarations included. No engine fork, build transform, `eval`, global prototype patch or `node_modules` rewrite.

**Compatibility: CesiumJS 1.145.x; tested with 1.145.0 / engine 26.3.0.** The adapter uses private globe internals and rejects other Cesium minor versions. Terrain transitions are experimental: this package does not claim universally seamless terrain, vertex geomorphing, or Google Earth parity.

## Install

This release is distributed through GitHub Releases. It is **not published to the npm registry**.

```sh
npm install https://github.com/gaopengbin/cesium-lod-transitions/releases/download/v0.1.0/cesium-lod-transitions-0.1.0.tgz cesium@1.145.0 @cesium/engine@26.3.0 @cesium/widgets@16.2.0
```

Alternatively install the tagged Git repository; built files are committed, so consumers do not need to run a build:

```sh
npm install github:gaopengbin/cesium-lod-transitions#v0.1.0 cesium@1.145.0 @cesium/engine@26.3.0 @cesium/widgets@16.2.0
```

## ESM / Vite / application code

Pin the engine/widgets versions shown above. An unconstrained Cesium 1.145.0 installation was observed resolving engine 26.4.0, whose exports broke that Cesium wrapper's ESM build. The plugin's peer constraints and these explicit install versions preserve the tested combination. If your lockfile still nests a different engine under Cesium, use npm `overrides` to pin `@cesium/engine` to `26.3.0` and `@cesium/widgets` to `16.2.0` throughout your application.

Use your normal Cesium Viewer and asset/worker configuration. Pass the **same Cesium namespace** that created it; the plugin does not bundle a second engine.

```js
import * as Cesium from 'cesium'
import { CesiumLodTransitions } from 'cesium-lod-transitions'

const viewer = new Cesium.Viewer('map', { /* your existing configuration */ })
const transitions = new CesiumLodTransitions(viewer, {
  Cesium,
  duration: 800,
  imagery: true,
  terrain: true,
})

transitions.setImageryEnabled(false)
transitions.setTerrainEnabled(true)
transitions.setDuration(800)
console.log(transitions.getStats())

// On component unmount. Viewer.destroy() also detaches the plugin automatically.
transitions.destroy()
```

Importing the package has no side effects. In Vue/React, create it after the Viewer mounts and call `destroy()` before discarding that Viewer. Do not install two instances on the same globe. Different Viewers have independent hooks, history and budgets.

## Browser script

Load your unmodified Cesium 1.145.x build first, then the plugin's `dist/cesium-lod-transitions.global.js` from the release archive (or your own static assets):

```html
<script src="/cesium/Cesium.js"></script>
<script src="/plugins/cesium-lod-transitions.global.js"></script>
<script>
  const viewer = new Cesium.Viewer('map', { /* your configuration */ })
  const transitions = new CesiumLodTransitions.CesiumLodTransitions(viewer, {
    duration: 800,
    imagery: true,
    terrain: true,
  })
</script>
```

For CommonJS: `const { CesiumLodTransitions } = require('cesium-lod-transitions')`; supply `{ Cesium }` in its options.

## Options and API

| Option | Default | Meaning |
| --- | --- | --- |
| `Cesium` | `globalThis.Cesium` | Same engine namespace as the Viewer |
| `duration` | `800` | Milliseconds per adjacent LOD handoff, 0–60000 |
| `imagery` | `true` | Boolean or `{ enabled, duration, maxLayers }` |
| `terrain` | `true` | Boolean or `{ enabled, duration, maxPairs, maxExtraBytes, maxCommands }` |
| `debug` | `false` | Teal primary / orange secondary terrain coverage |
| `respectReducedMotion` | `true` | Initially disable both effects when the OS requests reduced motion; explicit enable calls opt in |

Imagery defaults to at most eight old source regions per target (a transition at/over the source budget is skipped). Terrain defaults to 64 active pairs, 32 MiB of retained parent vertex/index buffers and 512 planned commands. The texture budget also accounts for available fragment samplers. Exceeding a transition budget falls back to native coverage; native commands are never forcibly dropped to meet the transition cap. Mesh-buffer statistics are **not total GPU VRAM**.

Methods: `setEnabled(boolean)`, `setImageryEnabled(boolean)`, `setTerrainEnabled(boolean)`, `setDuration(ms)`, `setDebug(boolean)`, `reset()`, `getStats()`, `isDestroyed()`, `destroy()`. Setters return the instance. Destroy is idempotent. `getStats().suspended` explains automatic fallback; `enabled` records requested feature switches.

## Scope and limits

Currently supported: **3D opaque globe, one visible opaque imagery layer**, ordinary terrain and imagery providers. The demo uses URL-template imagery and a custom heightmap provider. Both effects can run together or independently. `requestRenderMode` is supported; active transitions request frames.

Automatically suspend effects for non-3D views, multiple/transparent imagery layers, globe translucency, custom globe material, shadows, terrain water masks, globe clipping and active globe vector features. The adapter resumes after those conditions clear. Imagery is intended for non-wrapping base coverage; antimeridian transitions are not certified.

Terrain transitions keep actual adjacent parent/child meshes, clip their coverage and switch the opaque depth-writing primary at the midpoint. The secondary mesh uses LEQUAL, no depth writes and premultiplied blending. This is **cross-fading, not vertex morphing or terrain stitching**. Depth/occlusion can change at the midpoint, and region boundaries or skirts can still show fine seams. Fill/upsampled meshes are not accepted as real transition endpoints. If an intermediate mesh is loading, the old parent may be held for up to two seconds before native fallback.

Secondary terrain commands are excluded from the separate globe pick list. CPU height queries, `globe.pick`, `getHeight`, terrain sampling, collision and terrain-clamped objects still follow Cesium's native terrain selection; they are not synchronized to the visual primary. Classification, clamped objects, shadow continuity and 2D are not certified.

Terrain-provider identity changes and imagery layer collection changes reset history. Call `reset()` yourself after changing source interpretation without replacing a provider. Context loss releases held references; restoration behavior still depends on Cesium. `destroy()` restores instance hooks, surface unload getters and original shader sources, invalidates the relevant shader cache and releases retained resources. The adapter does not replace the Viewer or its layers.

## Examples and development

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run dev
```

- <http://127.0.0.1:19381/> — ESM plugin + unmodified unminified Cesium, synthetic terrain / diagnostic imagery.
- <http://127.0.0.1:19381/examples/global.html> — browser-script plugin + unmodified minified Cesium.
- Optional local fixture: set `TERRAIN_DATA_DIR` to a directory containing `manifest.json`, `heights.f32`, `mont-blanc.jpg`, then open `/?fixture`. This data is not included in the package or repository. The fixture path is a local development feature, not a download service.

The diagnostic example deliberately uses artificial level colors and terrain. It does not contact Cesium ion or require a token. Configure your own providers, credentials and attribution in your application.

## Validation

Node tests cover controller coverage/weights, sampler clipping, reverse progress, per-frame updates, budget fallback, resource release, native-array restoration, lifecycle hooks, independent Viewers, primary-only picks, unsupported scenes and all three package entries. The TypeScript usage example compiles against Cesium's actual declarations.

Browser validation and packed-install checks are described in [VALIDATION.md](VALIDATION.md). These checks establish the recorded scenes and builds; they are not a GPU-time benchmark or a compatibility claim for arbitrary Cesium versions/providers.

MIT. Initially extracted from the [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) imagery/terrain experiments, then adapted to work with the unmodified engine at runtime.
