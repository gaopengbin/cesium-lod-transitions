const marker = '// cesium-lod-transitions:terrain-v1'

export function wrapTerrainFragment(source) {
  if (source.includes(marker)) return source
  if ((source.match(/void\s+main\s*\(\s*\)/g) || []).length !== 1) throw new Error('Unsupported Cesium globe fragment shader')
  return `${marker}
uniform vec4 u_lodRegion;
uniform float u_lodWeight;
uniform vec4 u_lodTint;
${source.replace(/void\s+main\s*\(\s*\)/, 'void lodOriginalMain()')}
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
`
}

export function patchFragmentSources(shaderSource) {
  const indices = shaderSource.sources.map((source, index) => /void\s+main\s*\(\s*\)/.test(source) ? index : -1).filter(index => index >= 0)
  if (indices.length !== 1) throw new Error('Expected one Cesium globe fragment main')
  const clone = shaderSource.clone()
  clone.sources[indices[0]] = wrapTerrainFragment(clone.sources[indices[0]])
  return clone
}
