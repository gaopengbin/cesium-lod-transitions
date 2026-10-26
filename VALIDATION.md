# Validation record — 0.1.0

Validated locally on 2026-10-26. Cesium 1.145.0 / engine 26.3.0; NVIDIA RTX 5090 through ANGLE/WebGL2; desktop viewport 1280×720.

## Source and package checks

- 20 Node tests pass, covering controller coverage/weights, old-texture references, interruption, Mercator coordinates, terrain reversal, adjacent-level waiting, memory/command budgets, transactional shader validation, per-Viewer hooks, independent feature switches, pick filtering, native-array restoration, fallback and cleanup.
- ESM, CommonJS and browser-global entries load successfully without loading or bundling a Cesium engine.
- TypeScript usage compiles against actual Cesium declarations (`skipLibCheck: false`).
- The release tarball was installed into an isolated consumer. ESM and CommonJS imports, installed build hashes and consumer TypeScript usage passed. A real ESM Cesium consumer was bundled with esbuild and exercised in the browser: refine/coarsen completed without render errors.
- An unconstrained fresh installation resolved engine 26.4.0 and failed to build Cesium 1.145.0's ESM wrapper due to missing engine exports. Pinning engine 26.3.0 and widgets 16.2.0 restored the build. Those versions are explicit plugin peers and documented install arguments; the isolated consumer confirmed deduplication.

## Actual browser checks

Both unmodified Cesium distributions were used: `Build/CesiumUnminified/Cesium.js` with the ESM plugin and `Build/Cesium/Cesium.js` with the browser-global plugin. The preview server reads and serves the Cesium files unchanged.

- Synthetic terrain plus diagnostic imagery: refine → coarsen completed with both effects active; no render errors. One recorded unminified route peaked at 45 terrain pairs, 33 imagery transitions, 112 commands and 2,844,864 bytes of extra retained parent mesh buffers. Budget skips were observed and native fallback preserved rendering.
- Browser-global/minified-engine route completed refine → coarsen with no render errors; final active imagery/terrain transitions, secondary terrain commands and extra retained parent buffers were zero.
- Actual GL draw readbacks showed `[depth-write=true, LEQUAL, blend=false]` for primary terrain and `[depth-write=false, LEQUAL, blend=true, ONE, ONE_MINUS_SRC_ALPHA]` for secondary terrain, both in globe pass 2. 893 weighted draw submissions were observed in a bounded audit. Audit instrumentation was removed afterwards; it is not part of the library.
- Destroyed the first plugin during three active terrain handoffs. All five inspected held surface references reached zero; its provider method restored to the native function. A second real Viewer and plugin on the same page remained attached, rendered without fallback, and were subsequently destroyed. The global DrawCommand prototype remained unchanged by the plugin.

Local JSON evidence and screenshots are kept under the ignored `artifacts/` directory. Unit tests simulate context-loss delivery to test reference release; they do not establish full GPU context restoration behavior. Browser checks establish the recorded scenes, not universal provider/version support or seam-free rendering.

## Performance interpretation

Mesh bytes count retained parent vertex/index buffers, not textures, shader allocations or total GPU VRAM. This release does not publish an FPS or GPU-time overhead percentage. In particular, earlier measurements for an imagery-only experiment do not establish the combined plugin's cost.
