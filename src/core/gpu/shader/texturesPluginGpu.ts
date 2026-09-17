import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const WGSL_BATCH_TEXTURE_HELPERS = `
//=============================================================================
// BATCH TEXTURE HELPERS
//=============================================================================
var<private> _textureSlots: u32;

fn _unpackSlot(slots: u32, shift: u32) -> u32 {
  return (slots >> shift) & 0xFu;
}

fn sampleBatchSlotGrad(
  slot: u32,
  uv: vec2<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>,
) -> vec4<f32> {
  // Pixi-style: switch on a *flat* interpolated value (uniform per primitive).
  switch (slot) {
    case 0u: { return textureSampleGrad(uBatchTexture0, uSampler, uv, uvDx, uvDy); }
    case 1u: { return textureSampleGrad(uBatchTexture1, uSampler, uv, uvDx, uvDy); }
    case 2u: { return textureSampleGrad(uBatchTexture2, uSampler, uv, uvDx, uvDy); }
    case 3u: { return textureSampleGrad(uBatchTexture3, uSampler, uv, uvDx, uvDy); }
    case 4u: { return textureSampleGrad(uBatchTexture4, uSampler, uv, uvDx, uvDy); }
    case 5u: { return textureSampleGrad(uBatchTexture5, uSampler, uv, uvDx, uvDy); }
    case 6u: { return textureSampleGrad(uBatchTexture6, uSampler, uv, uvDx, uvDy); }
    case 7u: { return textureSampleGrad(uBatchTexture7, uSampler, uv, uvDx, uvDy); }
    case 8u: { return textureSampleGrad(uBatchTexture8, uSampler, uv, uvDx, uvDy); }
    case 9u: { return textureSampleGrad(uBatchTexture9, uSampler, uv, uvDx, uvDy); }
    case 13u: { return vec4<f32>(0.0); }
    case 14u: { return vec4<f32>(1.0); }
    case 15u: { return vec4<f32>(0.5, 0.5, 1.0, 1.0); }
    default: { return textureSampleGrad(uBatchTexture9, uSampler, uv, uvDx, uvDy); }
  }
}

fn sampleBatchTexture(
  slots: u32,
  shift: u32,
  uv: vec2<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>
) -> vec4<f32> {
  return sampleBatchSlotGrad(_unpackSlot(slots, shift), uv, uvDx, uvDy);
}
`;

/**
 * WGSL compiler plugin that collects `textures` from each bit and generates one `sampleX(uv)`
 * function per declared slot
 *
 * Also auto-injects the batch texture bindings into the shader before the core WGSL plugins
 * process them.
 * @internal
 */
export const texturesPluginGpu: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.bits.some((b) => b.name === 'batchTexturesBindings')) {
      context.bits.unshift({
        name: 'batchTexturesBindings',
        bindings: {
          batch: {
            uBatchTexture0: 'texture_2d<f32>',
            uBatchTexture1: 'texture_2d<f32>',
            uBatchTexture2: 'texture_2d<f32>',
            uBatchTexture3: 'texture_2d<f32>',
            uBatchTexture4: 'texture_2d<f32>',
            uBatchTexture5: 'texture_2d<f32>',
            uBatchTexture6: 'texture_2d<f32>',
            uBatchTexture7: 'texture_2d<f32>',
            uBatchTexture8: 'texture_2d<f32>',
            uBatchTexture9: 'texture_2d<f32>',
          },
        },
        gpu: {
          header: WGSL_BATCH_TEXTURE_HELPERS,
        },
      });
    }
  },

  injectCode(context) {
    let nextIndex = 0;
    const lines: string[] = [];

    for (const bit of context.bits) {
      if (!bit.textures) continue;
      for (const name of bit.textures) {
        const funcName = `sample${name[0].toUpperCase()}${name.slice(1)}`;
        const shift = nextIndex * 4;

        // sampleXxxDirect — zero gradients (LOD 0), works in any stage
        lines.push(
          `fn ${funcName}Direct(uv: vec2<f32>) -> vec4<f32> {`,
          `  return sampleBatchTexture(_textureSlots, ${shift}u, uv, vec2<f32>(0.0), vec2<f32>(0.0));`,
          `}`,
        );

        // sampleXxx — auto derivatives for mipmapping, fragment only
        lines.push(
          `fn ${funcName}(uv: vec2<f32>) -> vec4<f32> {`,
          `  return sampleBatchTexture(_textureSlots, ${shift}u, uv, dpdx(uv), dpdy(uv));`,
          `}`,
        );

        nextIndex++;
      }
    }

    return { textureGetters: lines.join('\n') };
  },
};
