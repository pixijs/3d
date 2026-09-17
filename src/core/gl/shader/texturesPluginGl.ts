import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const header = `
//=============================================================================
// BATCH TEXTURE HELPERS
//=============================================================================
uint _unpackSlot(uint slots, uint shift) {
  return (slots >> shift) & 15u;
}

vec4 sampleBatchSlotGrad(uint slot, vec2 uv, vec2 uvDx, vec2 uvDy) {
  if (slot == 0u) return textureGrad(uBatchTexture0, uv, uvDx, uvDy);
  if (slot == 1u) return textureGrad(uBatchTexture1, uv, uvDx, uvDy);
  if (slot == 2u) return textureGrad(uBatchTexture2, uv, uvDx, uvDy);
  if (slot == 3u) return textureGrad(uBatchTexture3, uv, uvDx, uvDy);
  if (slot == 4u) return textureGrad(uBatchTexture4, uv, uvDx, uvDy);
  if (slot == 5u) return textureGrad(uBatchTexture5, uv, uvDx, uvDy);
  if (slot == 6u) return textureGrad(uBatchTexture6, uv, uvDx, uvDy);
  if (slot == 7u) return textureGrad(uBatchTexture7, uv, uvDx, uvDy);
  if (slot == 8u) return textureGrad(uBatchTexture8, uv, uvDx, uvDy);
  if (slot == 9u) return textureGrad(uBatchTexture9, uv, uvDx, uvDy);

  // Reserved slots (match Mesh3DBatcher: slot = 13 + uid; uid: 0=EMPTY, 1=WHITE, 2=NORMAL)
  if (slot == 13u) return vec4(0.0);
  if (slot == 14u) return vec4(1.0);
  if (slot == 15u) return vec4(0.5, 0.5, 1.0, 1.0);

  return textureGrad(uBatchTexture9, uv, uvDx, uvDy);
}

vec4 sampleBatchTexture(uint slots, uint shift, vec2 uv, vec2 uvDx, vec2 uvDy) {
  return sampleBatchSlotGrad(_unpackSlot(slots, shift), uv, uvDx, uvDy);
}
`;

/**
 * GLSL compiler plugin that collects `textures` from each bit and generates one `sampleX(uv)`
 * function per declared slot in the `textureGetters` slot (both vertex and fragment stages)
 *
 * Also auto-injects the batch texture bindings before the core GLSL plugins process them.
 * @internal
 */
export const texturesPluginGl: ShaderCompilerPlugin = {
  collectData(context) {
    // Auto-inject the batch texture bindings (if not already present).
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
        gl: {
          header,
        },
      });
    }
  },

  injectCode(context): Record<string, string> {
    let nextIndex = 0;
    const lines: string[] = [];
    const isFragment = context.stage === 'fragment';

    for (const bit of context.bits) {
      if (!bit.textures) continue;
      for (const name of bit.textures) {
        const funcName = `sample${name[0].toUpperCase()}${name.slice(1)}`;
        const shift = nextIndex * 4;

        // sampleXxxDirect — zero gradients (LOD 0), works in any stage
        lines.push(
          `vec4 ${funcName}Direct(vec2 uv) {`,
          `  return sampleBatchTexture(vTextureSlots, ${shift}u, uv, vec2(0.0), vec2(0.0));`,
          `}`,
        );

        // sampleXxx — auto derivatives for mipmapping, fragment only
        if (isFragment) {
          lines.push(
            `vec4 ${funcName}(vec2 uv) {`,
            `  return sampleBatchTexture(vTextureSlots, ${shift}u, uv, dFdx(uv), dFdy(uv));`,
            `}`,
          );
        }

        nextIndex++;
      }
    }

    return { textureGetters: lines.join('\n') };
  },
};
