import type * as Cesium from 'cesium'

export interface FeatureOptions {
  enabled?: boolean
  duration?: number
}
export interface ImageryOptions extends FeatureOptions {
  maxLayers?: number
}
export interface TerrainOptions extends FeatureOptions {
  maxPairs?: number
  maxExtraBytes?: number
  maxCommands?: number
}
export interface TransitionOptions {
  /** Pass the same namespace used to create this Viewer. Defaults to window.Cesium. */
  Cesium?: typeof Cesium
  /** Milliseconds, default 800. */
  duration?: number
  imagery?: boolean | ImageryOptions
  terrain?: boolean | TerrainOptions
  debug?: boolean
  /** Respect prefers-reduced-motion at installation (default true). Explicit enable calls opt in. */
  respectReducedMotion?: boolean
}
export interface TransitionStats {
  active: number
  started: number
  completed: number
  levels: number[]
  [key: string]: unknown
}
export interface TransitionStatus {
  cesiumVersion: string
  destroyed: boolean
  enabled: { imagery: boolean, terrain: boolean }
  suspended: string[]
  imagery: TransitionStats & { zoomIn: number, zoomOut: number, budgetSkips: number, extraSamplers: number }
  terrain: TransitionStats & { waiting: number, reversed: number, primary: number, secondary: number, extraMeshBytes: number, pinnedMeshes: number, endReasons: Record<string, number> }
  commands: number
}
export class CesiumLodTransitions {
  constructor(viewer: Cesium.Viewer, options?: TransitionOptions)
  setEnabled(enabled: boolean): this
  setImageryEnabled(enabled: boolean): this
  setTerrainEnabled(enabled: boolean): this
  setDuration(milliseconds: number): this
  setDebug(enabled: boolean): this
  /** Clear held resources after changing source interpretation. */
  reset(): this
  getStats(): TransitionStatus
  destroy(): void
  isDestroyed(): boolean
}
export function createLodTransitions(viewer: Cesium.Viewer, options?: TransitionOptions): CesiumLodTransitions
export const VERSION: string
