import { materialBindingsBit } from '../../shader/bits/materialBindingsBit';
import type { MaterialShaderForm } from '../../shader/bits/materialBindingsBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * `sampleXDirect` passes zero gradients so it is legal in the vertex stage; `index` must number
 * textures as `materialBindingsBit` does
 */
function textureGetters(funcName: string, index: number): string[] {
  const pair = `uMaterialTexture${index}, uMaterialSampler${index}`;

  return [
    `fn ${funcName}Direct(uv: vec2<f32>) -> vec4<f32> {`,
    `  return textureSampleGrad(${pair}, uv, vec2<f32>(0.0), vec2<f32>(0.0));`,
    `}`,
    `fn ${funcName}(uv: vec2<f32>) -> vec4<f32> {`,
    `  return textureSample(${pair}, uv);`,
    `}`,
  ];
}

/**
 * Puts the form's `materialBindingsBit` at the front of `context.bits`, a list `compileWgslSource`
 * builds per compile, so the caller's array is untouched
 * @internal
 */
export function createTexturesPluginGpu(form: MaterialShaderForm): ShaderCompilerPlugin {
  return {
    collectData(context) {
      if (!context.bits.some((b) => b.name.startsWith('materialBindings:'))) {
        context.bits.unshift(materialBindingsBit(context.bits, form));
      }
    },

    injectCode(context) {
      let nextIndex = 0;
      const lines: string[] = [];

      for (const bit of context.bits) {
        if (!bit.textures) continue;
        for (const name of bit.textures) {
          const funcName = `sample${name[0].toUpperCase()}${name.slice(1)}`;
          lines.push(...textureGetters(funcName, nextIndex));
          nextIndex++;
        }
      }

      return { textureGetters: lines.join('\n') };
    },
  };
}
