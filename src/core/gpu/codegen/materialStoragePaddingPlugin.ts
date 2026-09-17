import { MATERIAL_STRIDE_BYTES } from '../../buffers/MaterialDataStoreBuffer';
import { createStructLayout, formatStructLayout } from '../../shader/codegen/structLayout';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * WGSL compiler plugin that pads the Material struct to match the CPU-side
 * storage buffer stride so that GPU array indexing aligns with
 * `MaterialDataStoreBuffer`
 *
 * Runs in `preCompile` — after struct data has been collected but before
 * any WGSL source is generated.
 * @internal
 */
export const materialStoragePaddingPlugin: ShaderCompilerPlugin = {
  preCompile(context: ShaderCompilerContext) {
    const structs = context.data.structs;
    if (!structs?.Material) return;

    const layout = createStructLayout(structs.Material);

    // Hard fail: an overflowing struct indexes past its slot in the storage
    // buffer, silently reading the neighbouring material's data. Throwing at
    // shader-variant build time surfaces it immediately with the full layout.
    if (layout.size > MATERIAL_STRIDE_BYTES) {
      throw new Error(
        `[materialStoragePadding] Material struct is ${layout.size} bytes, ` +
          `which exceeds the storage buffer stride of ${MATERIAL_STRIDE_BYTES} bytes — ` +
          `material data would bleed into adjacent material slots. ` +
          `Trim or pack material fields:\n${formatStructLayout(layout)}`,
      );
    }

    if (layout.size === MATERIAL_STRIDE_BYTES) return;

    const padFloats = (MATERIAL_STRIDE_BYTES - layout.size) / 4;
    structs.Material._pad = padFloats === 1 ? 'f32' : `array<f32, ${padFloats}>`;
  },
};
