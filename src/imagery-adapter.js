// Give each fading draw a local layer view. The actual shared ImageryLayer,
// image references and GPU textures remain owned by Cesium and the controller.
export function weightImagery(items) {
  return items.map(item => {
    if (item._tileFadeAlpha === undefined || !item.readyImagery) return item
    const original = item.readyImagery
    const layer = Object.create(original.imageryLayer)
    Object.defineProperty(layer, 'alpha', { value: original.imageryLayer.alpha * item._tileFadeAlpha })
    const imagery = Object.create(original)
    Object.defineProperty(imagery, 'imageryLayer', { value: layer })
    return { ...item, readyImagery: imagery }
  })
}
