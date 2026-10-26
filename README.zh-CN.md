# cesium-lod-transitions

CesiumJS **影像瓦片渐变 + 地形 LOD 渐变**独立插件，默认每级 **0.8 秒**，支持分别开关。

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

## 常用能力

- 影像：同图层不同精度瓦片交接，保留旧纹理，在当前网格上按覆盖范围逐渐淡出；不改变整个图层的透明度。
- 地形：保留真实父、子网格，每级分别交接，过渡中点交换写入深度的主网格；不做顶点形变。
- 生命周期：支持中途开关、反向切换、资源预算、按需渲染、销毁后恢复、同页多个 Viewer 隔离。
- 控制：`setEnabled`、`setImageryEnabled`、`setTerrainEnabled`、`setDuration`、`setDebug`、`reset`、`getStats`、`destroy`。
- 默认尊重系统“减少动态效果”；演示页显式开启动画。应用可设置 `respectReducedMotion: false`，或通过开关方法明确启用。

默认限制：64 对地形网格、32 MiB 附加父网格缓冲、512 条规划绘制命令、每个影像目标最多 8 个旧来源区域。超出过渡预算时回退原始覆盖，不丢弃原本需要绘制的地形。统计的网格缓冲大小不等于总显存。

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

详细选项、技术实现和限制见 [English README](README.md)，验证记录见 [VALIDATION.md](VALIDATION.md)。
