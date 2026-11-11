import type { ShaderBit } from '../../../core/shader/ShaderBit';

/** Value noise with a hash free of `sin`, so every GPU and both backends cut the same holes */
const NOISE_WGSL = /* wgsl */ `
const DISSOLVE_HOLE_SIZE: f32 = 0.25;
const DISSOLVE_EDGE: f32 = 0.05;

fn dissolveHash(cell: vec3<f32>) -> f32 {
  var p = fract(cell * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn dissolveNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let x00 = mix(dissolveHash(i), dissolveHash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(dissolveHash(i + vec3<f32>(0.0, 1.0, 0.0)), dissolveHash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(dissolveHash(i + vec3<f32>(0.0, 0.0, 1.0)), dissolveHash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(dissolveHash(i + vec3<f32>(0.0, 1.0, 1.0)), dissolveHash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
`;

const NOISE_GLSL = /* glsl */ `
#define DISSOLVE_HOLE_SIZE 0.25
#define DISSOLVE_EDGE 0.05

float dissolveHash(vec3 cell) {
  vec3 p = fract(cell * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float dissolveNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float x00 = mix(dissolveHash(i), dissolveHash(i + vec3(1.0, 0.0, 0.0)), u.x);
  float x10 = mix(dissolveHash(i + vec3(0.0, 1.0, 0.0)), dissolveHash(i + vec3(1.0, 1.0, 0.0)), u.x);
  float x01 = mix(dissolveHash(i + vec3(0.0, 0.0, 1.0)), dissolveHash(i + vec3(1.0, 0.0, 1.0)), u.x);
  float x11 = mix(dissolveHash(i + vec3(0.0, 1.0, 1.0)), dissolveHash(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
`;

/**
 * Cuts a material's surface away where noise falls below `material.data.dissolve`, with an
 * optional glowing edge along the cut
 *
 * The bit adds three fields to `material.data`, all 0 on a material built or cloned with it, so a
 * new copy draws whole, with no edge and the default hole size:
 *
 * - `dissolve` runs from 0, which draws the surface whole, to 1, which cuts all of it away.
 * - `dissolveEdgeColor` is an RGB colour in linear light added along the cut, and black draws no
 *   edge. A tone curve rolls channels above 1 off; the default `toneMapping: 'none'` clips them.
 * - `dissolveHoleSize` is about how wide a hole is when half the surface is cut, in the mesh's
 *   stored units. 0 means 0.25. The edge widens with the holes.
 *
 * The edge is added after lighting, so the bit works on every engine material, lit or unlit,
 * including the {@link FlatMaterial} the glTF loader builds for unlit materials. The view's
 * exposure, fog and tone mapping apply to the edge as they do to the surface.
 *
 * The noise reads the mesh's vertex positions as stored, before its transform, bones or morph
 * targets move them. So the holes stay on the surface as the model moves and animates, and models
 * built from one source cut the same holes. It's also why `dissolveHoleSize` is in stored units and
 * the holes grow when the model is scaled up. A mesh stored in centimetres, where the default cuts
 * speckle, needs about 25. For a quantized glTF, divide the hole size you want by the scale on its
 * node.
 *
 * Shadows and outlines don't dissolve. The shadow pass and an {@link OutlinePass} draw a mesh with
 * their own shaders, which leave out the material's extra bits. So a half-dissolved mesh still
 * casts a whole shadow, and its outline shows through the holes and stays as a solid silhouette
 * at `dissolve` 1. To drop the outline while a copy dissolves, take the copy out of that pass with
 * {@link BaseMaterial3D#disablePass}: `copy.disablePass('outline')`.
 * @example
 * ```ts
 * enemy.materials = (material) => material.clone({ extraBits: [dissolveBit] });
 *
 * for (const material of enemy.materials) {
 *   material.data.dissolve = progress;
 *   material.data.dissolveEdgeColor = [6, 2, 0.4];
 * }
 * ```
 * @category extras:materials
 * @advanced
 */
export const dissolveBit: ShaderBit = {
  name: 'dissolve',
  interStage: { vDissolvePos: 'vec3<f32>' },
  bindings: { material: { dissolveEdgeColor: 'vec3<f32>', dissolve: 'f32', dissolveHoleSize: 'f32' } },
  gpu: {
    header: NOISE_WGSL,
    vertex: { end: /* wgsl */ 'output.vDissolvePos = vec3<f32>(input.aPosition.xyz);' },
    fragment: {
      material: /* wgsl */ `
  let dissolveHoleSize = select(DISSOLVE_HOLE_SIZE, material.dissolveHoleSize, material.dissolveHoleSize > 0.0);
  let dissolveN = dissolveNoise(input.vDissolvePos / dissolveHoleSize);
  if (dissolveN < material.dissolve) {
    discard;
  }
  let dissolveGlow = material.dissolveEdgeColor
    * (1.0 - smoothstep(0.0, DISSOLVE_EDGE, dissolveN - material.dissolve))
    * step(0.001, material.dissolve);
`,
      end: /* wgsl */ `
  let dissolveEdgeOut = inputTint(
    vec4<f32>(dissolveGlow, 1.0),
    vec4<f32>(pow(dissolveGlow, vec3<f32>(1.0 / 2.2)), 1.0)
  ).rgb;
  finalColor += dissolveEdgeOut * inputExposure(global.uExposure, global.uDisplayExposure);
`,
    },
  },
  gl: {
    vertex: { end: /* glsl */ 'vDissolvePos = vec3(aPosition.xyz);' },
    fragment: {
      header: NOISE_GLSL,
      material: /* glsl */ `
  float dissolveHoleSize = material.dissolveHoleSize > 0.0 ? material.dissolveHoleSize : DISSOLVE_HOLE_SIZE;
  float dissolveN = dissolveNoise(vDissolvePos / dissolveHoleSize);
  if (dissolveN < material.dissolve) discard;
  vec3 dissolveGlow = material.dissolveEdgeColor
    * (1.0 - smoothstep(0.0, DISSOLVE_EDGE, dissolveN - material.dissolve))
    * step(0.001, material.dissolve);
`,
      end: /* glsl */ `
  vec3 dissolveEdgeOut = inputTint(
    vec4(dissolveGlow, 1.0),
    vec4(pow(dissolveGlow, vec3(1.0 / 2.2)), 1.0)
  ).rgb;
  finalColor += dissolveEdgeOut * inputExposure(uExposure, uDisplayExposure);
`,
    },
  },
};
