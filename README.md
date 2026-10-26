# cesium-lod-transitions · Cesium 影像与地形渐变插件

[English](README.en.md) · [npm 安装包](https://www.npmjs.com/package/cesium-lod-transitions) · [版本下载](https://github.com/gaopengbin/cesium-lod-transitions/releases) · [验证记录](VALIDATION.md)

参考 **Google Earth（谷歌地球）的平滑缩放与细节层次（LOD）过渡效果**，为 **CesiumJS** 实现 **同图层影像瓦片渐变** 和 **地形父子网格渐变交接**。目标是改善缩放和加载细节时的影像突变、地形网格突然切换，让三维地球的细节衔接更平滑。

默认每级过渡 **0.8 秒**，影像和地形可分别开关，也可以同时启用。

## 参考 Google Earth，实现了什么效果？

| 场景 | 插件提供的过渡效果 |
| --- | --- |
| 影像瓦片随缩放更换清晰度 | 保留旧纹理，按其覆盖范围在当前地形网格上渐隐，与新影像逐渐交接；适用于同一个影像图层内部的瓦片切换 |
| 地形 LOD 从粗网格切换到细网格 | 参考对 Google Earth 父子网格交接方式的分析，保留真实父、子地形网格，在过渡中点交换写入深度的主网格，次网格渐隐 |
| 反向缩放或中途切换精度 | 支持地形交接从当前进度反向进行，并为纹理、附加网格和绘制命令设置资源预算 |

这是一个 **Google Earth 风格视觉效果的第三方独立实现**，不是 Google 或 Cesium 官方插件。实际绘制使用应用已有的 Cesium 影像纹理和地形网格，数据由应用自己的影像与地形提供器提供。地形过渡仍为实验功能，参考效果不代表已经完整复现 Google Earth 的渲染器或解决所有地形接缝。

支持 ESM、CommonJS、浏览器脚本和 TypeScript。直接挂接已有 Viewer，无须修改 Cesium 构建文件、配置构建转换器或改写 `node_modules`；不修改全局原型。

**首版限定 Cesium 1.145.x，实际验证版本为 1.145.0 / engine 26.3.0。** 插件依赖引擎内部结构，因此不会声称兼容所有 Cesium 版本；其他次版本会在安装时明确报错。

## 安装与引入

可直接从 **npm 官方源** 安装：

```sh
npm install cesium-lod-transitions@0.1.0 cesium@1.145.0 @cesium/engine@26.3.0 @cesium/widgets@16.2.0
```

也可以安装原始 **GitHub Release** 中的独立包：

```sh
npm install https://github.com/gaopengbin/cesium-lod-transitions/releases/download/v0.1.0/cesium-lod-transitions-0.1.0.tgz cesium@1.145.0 @cesium/engine@26.3.0 @cesium/widgets@16.2.0
```

如果当前网络直连 GitHub 下载超时，可改用公开 API 下载同一安装包，无须 token；此路径已实际下载并校验与发布文件完全一致：

```sh
curl -L -H "Accept: application/octet-stream" https://api.github.com/repos/gaopengbin/cesium-lod-transitions/releases/assets/678027734 -o cesium-lod-transitions-0.1.0.tgz
npm install ./cesium-lod-transitions-0.1.0.tgz cesium@1.145.0 @cesium/engine@26.3.0 @cesium/widgets@16.2.0
```

Windows PowerShell 中请使用 `curl.exe`。发布文件的 SHA256 见 Release 中的 `SHA256SUMS.txt`。

```js
import * as Cesium from 'cesium'
import { CesiumLodTransitions } from 'cesium-lod-transitions'

const transitions = new CesiumLodTransitions(viewer, {
  Cesium, // 必须与创建 viewer 的 Cesium 是同一份
  duration: 800,
  imagery: true,
  terrain: true,
})

transitions.setImageryEnabled(false)
transitions.setTerrainEnabled(true)
transitions.setDuration(800)
console.log(transitions.getStats())

// Vue/React 组件卸载时调用。直接销毁 Viewer 也会自动清理插件。
transitions.destroy()
```

也可安装仓库标签：`npm install github:gaopengbin/cesium-lod-transitions#v0.1.0`。构建产物已包含在仓库中，消费者无须本地构建。建议同时显式安装上面的 Cesium/engine/widgets 版本；仅安装 Cesium 1.145.0 时，其宽松依赖可能拉到不兼容的 engine 26.4.0。插件已声明对应 peer 约束；如果旧锁文件仍嵌套其他版本，请在应用的 npm overrides 中固定这两个引擎包。

浏览器脚本使用 Release 中的 `dist/cesium-lod-transitions.global.js`，先加载原版 Cesium，再调用 `new CesiumLodTransitions.CesiumLodTransitions(viewer, options)`。完整示例见 [examples/global.html](examples/global.html)。

CommonJS 使用 `const { CesiumLodTransitions } = require('cesium-lod-transitions')`，同样在选项中传入创建 Viewer 所用的 `Cesium`。

## 常用能力

- 影像：同图层不同精度瓦片交接，保留旧纹理，在当前网格上按覆盖范围逐渐淡出；不改变整个图层的透明度。
- 地形：保留真实父、子网格，每级分别交接，过渡中点交换写入深度的主网格；不做顶点形变。
- 生命周期：支持中途开关、反向切换、资源预算、按需渲染、销毁后恢复、同页多个 Viewer 隔离。
- 控制：`setEnabled`、`setImageryEnabled`、`setTerrainEnabled`、`setDuration`、`setDebug`、`reset`、`getStats`、`destroy`。
- 默认尊重系统“减少动态效果”；演示页显式开启动画。应用可设置 `respectReducedMotion: false`，或通过开关方法明确启用。

默认限制：64 对地形网格、32 MiB 附加父网格缓冲、512 条规划绘制命令、每个影像目标最多 8 个旧来源区域。超出过渡预算时回退原始覆盖，不丢弃原本需要绘制的地形。统计的网格缓冲大小不等于总显存。

## 配置选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `Cesium` | `globalThis.Cesium` | 与创建 Viewer 相同的 Cesium 命名空间 |
| `duration` | `800` | 每级过渡时长，单位毫秒，范围 0–60000 |
| `imagery` | `true` | 影像渐变开关，或 `{ enabled, duration, maxLayers }` |
| `terrain` | `true` | 地形渐变开关，或 `{ enabled, duration, maxPairs, maxExtraBytes, maxCommands }` |
| `debug` | `false` | 用颜色标出地形交接的主网格、次网格覆盖区域 |
| `respectReducedMotion` | `true` | 初始尊重系统“减少动态效果”；显式开启开关表示主动启用动画 |

`getStats().enabled` 表示请求的开关状态，`getStats().suspended` 说明当前为什么回退原始绘制。`destroy()` 可以重复调用；销毁 Viewer 也会自动清理插件。Vue/React 组件卸载时应销毁相应实例；同一 Viewer 只安装一次，不同 Viewer 的状态独立。

## 使用边界

当前验证范围是 **3D 地球、单个可见不透明影像图层**。多影像图层、透明地球、自定义地球材质、阴影、水体掩码、裁剪和地球矢量要素等场景会自动暂停过渡，原因可在 `getStats().suspended` 中查看。

地形仍是实验功能：局部边界或裙边可能出现细线，尚未保证所有视角无接缝；不包含地形缝合、连续顶点形变、Google Earth 等效渲染。CPU 高度查询、碰撞和贴地对象仍跟随 Cesium 原生选择，不跟随视觉交接主网格。

切换地形提供器或影像图层会自动清理历史；如果同一个提供器内部的数据含义改变，请主动调用 `reset()`。插件停止或销毁会释放持有的资源引用；销毁恢复的是当前 Viewer 的挂接方法、卸载保护和着色器，不影响其他 Viewer。

## 本地运行

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run dev
```

打开 `http://127.0.0.1:19381/`，默认使用程序生成地形和分级诊断影像，无需 token。该示例不代表真实地理数据。压缩版 Cesium + 浏览器脚本示例位于 `/examples/global.html`。

## 验证与性能说明

已验证原版 Cesium 的压缩版、非压缩版、ESM 消费项目、影像与地形同时启用、反向交接、资源释放，以及同页两个 Viewer 的隔离。20 项自动化测试覆盖过渡权重、覆盖区域、预算回退、生命周期与包入口；验证细节见 [VALIDATION.md](VALIDATION.md)。

附加网格缓冲统计不等于总显存；目前没有给出适用于所有场景的 FPS 或 GPU 耗时损失百分比。影像渐变实验的性能数据也不能直接当作影像与地形同时启用时的成本。

## 检索关键词

中文：**Cesium 插件、CesiumJS、Google Earth、谷歌地球、谷歌地球效果、影像渐变、影像瓦片渐变、瓦片缩放过渡、地形渐变、地形 LOD、父子网格交接、平滑缩放、三维地球、地形渲染、地理信息系统**。

English: **Cesium, CesiumJS, Google Earth-inspired, imagery tile crossfade, tile fading, imagery transition, terrain LOD transition, level of detail, parent-child mesh transition, smooth zoom, 3D globe, terrain rendering, WebGL, GIS, TypeScript, npm plugin**.

MIT 许可。项目由 [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) 的影像与地形过渡实验独立整理，技术实现使用 Cesium 自身的绘制管线。完整英文说明见 [README.en.md](README.en.md)。
