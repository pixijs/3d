import type { ColorSource } from 'pixi.js';
import { Color } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { ShaderDescriptorOptions } from '../../../core/shader/ShaderDescriptor';

/**
 * The flat-colour draw as one bit, for a pass at the `'shape'` level
 *
 * It pushes each vertex `SOLID_EXTRUDE` local units along its normal, after the material's own
 * vertex bits have placed it, and gives every fragment the one colour. Colour and extrusion are
 * shader constants, pipeline overrides on WebGPU and `#define`s on WebGL: they are fixed per pass,
 * so a constant is cheaper than a uniform block.
 */
const solidMeshBit: ShaderBit = {
  name: 'solidMesh',
  overrideDefs: {
    SOLID_EXTRUDE: { type: 'f32', default: 0 },
    SOLID_R: { type: 'f32', default: 0 },
    SOLID_G: { type: 'f32', default: 0 },
    SOLID_B: { type: 'f32', default: 0 },
  },
  gpu: {
    vertex: { beforeTransform: 'position = vec4<f32>(position.xyz + normalize(normal) * SOLID_EXTRUDE, 1.0);' },
    fragment: { end: 'finalColor = vec3<f32>(SOLID_R, SOLID_G, SOLID_B); alpha = 1.0;' },
  },
  gl: {
    vertex: { beforeTransform: 'position.xyz += normalize(normal) * SOLID_EXTRUDE;' },
    fragment: { end: 'finalColor = vec3(SOLID_R, SOLID_G, SOLID_B); alpha = 1.0;' },
  },
};

/**
 * Options for {@link solidMeshDescriptor}
 * @category extras:post-processing
 * @advanced
 */
export interface SolidMeshDescriptorOptions {
  /**
   * Colour the meshes draw in
   * @default 0x000000
   */
  color?: ColorSource;
  /**
   * How far each vertex is pushed out along its normal, in the mesh's local units
   * @default 0
   */
  extrude?: number;
}

/**
 * Shader recipe for a {@link MeshPass} at the `'shape'` level that draws meshes in one flat colour
 *
 * {@link OutlinePass} and {@link WireframePass} draw with it, and it suits any flat-colour redraw
 * such as a selection mask. It is one bit added to each material's own vertex bits, so skinning,
 * morph targets, billboards and a material's own vertex bits all apply, with no lighting, no
 * textures, and an optional push along the normal.
 *
 * It has no template of its own, so the pass must set `level: 'shape'`, whether the recipe is the
 * pass's own or comes from a material's `passes` entry.
 *
 * Each colour and extrusion pair compiles its own shader, so pick them once per pass rather than
 * animating them.
 * @example
 * ```ts
 * new MeshPass({
 *   name: 'mask',
 *   level: 'shape',
 *   descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xffffff }) },
 * });
 * ```
 * @param options - Colour and extrusion.
 * @returns The `shaderDescriptor` for a pass's `descriptor` or a material's `passes` entry.
 * @category extras:post-processing
 * @advanced
 */
export function solidMeshDescriptor(options: SolidMeshDescriptorOptions = {}): ShaderDescriptorOptions {
  const color = Color.shared.setValue(options.color ?? 0x000000);
  return {
    bitsGpu: [solidMeshBit],
    bitsGl: [solidMeshBit],
    overrides: {
      SOLID_EXTRUDE: options.extrude ?? 0,
      SOLID_R: color.red,
      SOLID_G: color.green,
      SOLID_B: color.blue,
    },
  };
}
