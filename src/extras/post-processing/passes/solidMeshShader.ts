import type { ColorSource } from 'pixi.js';
import { Color } from 'pixi.js';

import { instanceFetchBitGl } from '../../../core/shader/bits/instanceFetchBitGl';
import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { ShaderBitTemplate } from '../../../core/shader/ShaderBitTemplate';
import type { ShaderDescriptorOptions } from '../../../core/shader/ShaderDescriptor';

/**
 * Vertex stage shaped like the shadow pass's: declare the locals the engine's deform bits write
 * (`position`, `normal`, `tangent`), let `{{vertexInput}}` in WGSL or `{{input}}` in GLSL decode,
 * skin and morph them, then push the position `SOLID_EXTRUDE` local units along the deformed
 * normal and transform it. With `SOLID_EXTRUDE` at 0 that is a plain draw.
 */
const solidMeshTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera'],
  gpu: /* wgsl */ `
{{header}}
{{vertexHeader}}

@vertex
fn mainVertex(
  input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;

  var position: vec4<f32>;
  var normal = input.aNormal;
  var tangent = vec3<f32>(0.0);

  let renderable = uRenderableStorage[uRenderableInstanceStorage[ii].id];
  let batchWorldMatrix = uRenderableStorage[0].transform;
  var modelMatrix = batchWorldMatrix * renderable.transform;

  {{vertexInput}}

  position = vec4<f32>(position.xyz + normalize(normal) * SOLID_EXTRUDE, 1.0);

  let worldPosition = modelMatrix * position;
  output.position = camera.uViewProjectionMatrix * worldPosition;

  {{vertexEnd}}

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  return vec4<f32>(SOLID_R, SOLID_G, SOLID_B, 1.0);
}
`,
  gl: {
    vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  mat4 modelMatrix;
  vec4 position;
  vec3 normal = aNormal;
  vec3 tangent = vec3(0.0);

  {{input}}

  position.xyz += normalize(normal) * SOLID_EXTRUDE;

  vec4 worldPosition = modelMatrix * position;
  gl_Position = uViewProjectionMatrix * worldPosition;

  {{end}}
}`,
    fragment: /* glsl */ `#version 300 es
out vec4 fragColor;

{{header}}

void main() {
  fragColor = vec4(SOLID_R, SOLID_G, SOLID_B, 1.0);
}`,
  },
};

/**
 * Colour and extrusion as shader constants: pipeline overrides on WebGPU, `#define`s on WebGL
 *
 * They are fixed per pass, so a constant is cheaper than a uniform block.
 */
const solidMeshBit: ShaderBit = {
  name: 'solidMesh',
  attributes: {
    aNormal: 'float32x3',
  },
  overrideDefs: {
    SOLID_EXTRUDE: { type: 'f32', default: 0 },
    SOLID_R: { type: 'f32', default: 0 },
    SOLID_G: { type: 'f32', default: 0 },
    SOLID_B: { type: 'f32', default: 0 },
  },
};

/**
 * Options for {@link solidMeshDescriptor}
 * @category extras:post-processing
 * @advanced
 */
export interface SolidMeshDescriptorOptions {
  /**
   * Flat colour every fragment outputs
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
 * Shader recipe for a {@link MeshPass} that draws meshes in one flat colour
 *
 * {@link OutlinePass} and {@link WireframePass} draw with it, and it suits any flat-colour redraw
 * such as a selection mask. It runs the engine's own vertex path, so skinning, morph targets and
 * batching apply, with no lighting, no textures, and an optional push along the normal.
 *
 * Colour and extrusion are baked in as shader constants, so every distinct pair is a separate
 * shader. Pick them once per pass rather than animating them.
 * @example
 * ```ts
 * new MeshPass({ name: 'mask', descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xffffff }) } });
 * ```
 * @param options - Colour and extrusion.
 * @returns Descriptor options ready for a pass or material `passes` entry.
 * @category extras:post-processing
 * @advanced
 */
export function solidMeshDescriptor(options: SolidMeshDescriptorOptions = {}): ShaderDescriptorOptions {
  const color = Color.shared.setValue(options.color ?? 0x000000);
  return {
    bitsGpu: [solidMeshBit],
    bitsGl: [instanceFetchBitGl, solidMeshBit],
    template: solidMeshTemplate,
    overrides: {
      SOLID_EXTRUDE: options.extrude ?? 0,
      SOLID_R: color.red,
      SOLID_G: color.green,
      SOLID_B: color.blue,
    },
  };
}
