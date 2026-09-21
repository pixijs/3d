import type { ColorSource } from 'pixi.js';
import { Color } from 'pixi.js';

import { instanceFetchBitGl } from '../../../core/shader/bits/instanceFetchBitGl';
import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { ShaderBitTemplate } from '../../../core/shader/ShaderBitTemplate';
import type { ShaderDescriptorOptions } from '../../../core/shader/ShaderDescriptor';

// One template for both backends. The vertex stage mirrors the shadow template's shape:
// declare the locals the engine's deform bits write (position / normal / tangent), let
// `{{vertexInput}}` / `{{input}}` decode + skin + morph them, then offset and transform.
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

  // Optional push along the (deformed) normal, in local units — zero is a plain draw.
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

  // Optional push along the (deformed) normal, in local units — zero is a plain draw.
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

// Colour and extrusion ride as specialization constants: fixed per pass instance, so a
// pipeline constant is cheaper than a uniform block.
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
 * Shader recipe for a `MeshPass` that draws meshes in one flat colour
 *
 * The workhorse behind hull outlines, wireframes and selection masks: the engine's forward
 * vertex path (so skinning, morph targets and batching apply) with no lighting, no textures,
 * and an optional push along the normal. One shader for both backends.
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
