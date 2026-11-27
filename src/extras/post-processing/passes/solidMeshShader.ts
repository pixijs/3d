import type { ColorSource } from 'pixi.js';
import { Color } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { ShaderDescriptorOptions } from '../../../core/shader/ShaderDescriptor';

/** Override constants rather than uniforms, since each pass fixes them: cheaper than a uniform block */
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
 * Shader recipe for a {@link MeshPass} that draws meshes in one flat colour, such as a selection mask
 *
 * It has no template, so the pass needs a `level`: at `'shape'` each mesh keeps its skinning, morph
 * targets, billboard and its material's `'shape'` bits. Lighting and textures don't apply. Each
 * colour and extrusion pair compiles its own shader, so pick them once per pass rather than
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
