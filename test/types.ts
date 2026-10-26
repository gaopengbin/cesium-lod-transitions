import * as Cesium from 'cesium'
import { CesiumLodTransitions, createLodTransitions, type TransitionStatus } from '../dist/index.js'
declare const viewer: Cesium.Viewer
const plugin = new CesiumLodTransitions(viewer, { Cesium, duration: 800, imagery: true, terrain: { enabled: true, maxPairs: 32 } })
plugin.setDuration(300).setImageryEnabled(false).setTerrainEnabled(true).setDebug(true).reset()
const stats: TransitionStatus = plugin.getStats()
const active: number = stats.terrain.active
const extra: unknown = stats.terrain.extraMeshBytes
createLodTransitions(viewer, { Cesium }).destroy()
void active
void extra
