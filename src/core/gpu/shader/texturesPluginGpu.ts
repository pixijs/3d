import { MAX_BATCH_TEXTURES } from '../../batcher/batchConstants';
import type { BindingGroup } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * How `sampleBatchSlotGrad` picks the batch texture a fragment samples
 *
 * - `'branch'`: a `switch` on the slot with one `textureSampleGrad` per arm; only the taken
 *   slot is fetched.
 * - `'select'`: every slot is fetched and the result is chosen with `select`; no control flow
 *   surrounds the fetches.
 * @internal
 */
type BatchTextureSelect = 'branch' | 'select';

/** Reserved slots the batcher hands out for its built-in textures: EMPTY, WHITE, NORMAL_MAP */
const RESERVED_SLOTS: readonly [slot: number, value: string][] = [
  [13, 'vec4<f32>(0.0)'],
  [14, 'vec4<f32>(1.0)'],
  [15, 'vec4<f32>(0.5, 0.5, 1.0, 1.0)'],
];

const sampleSlot = (slot: number) => `textureSampleGrad(uBatchTexture${slot}, uSampler, uv, uvDx, uvDy)`;

const slotIndices = Array.from({ length: MAX_BATCH_TEXTURES }, (_, i) => i);

/** The batch bind group's texture bindings, `uBatchTexture0` upwards, one per slot */
const batchTextureBindings: BindingGroup = Object.fromEntries(
  slotIndices.map((i) => [`uBatchTexture${i}`, 'texture_2d<f32>'] as const),
);

const WGSL_SAMPLE_BRANCH = `fn sampleBatchSlotGrad(
  slot: u32,
  uv: vec2<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>,
) -> vec4<f32> {
  // Constant black, white, and flat-normal slots bypass texture selection.
  if (slot >= 13u) {
    let value = select(1.0, 0.0, slot == 13u);
    let xy = value * select(1.0, 0.5, slot == 15u);
    return vec4<f32>(xy, xy, value, value);
  }

  // Pixi-style: switch on a *flat* interpolated value (uniform per primitive).
  switch (slot) {
${slotIndices.map((i) => `    case ${i}u: { return ${sampleSlot(i)}; }`).join('\n')}
    default: { return ${sampleSlot(MAX_BATCH_TEXTURES - 1)}; }
  }
}`;

const WGSL_SAMPLE_SELECT = `fn sampleBatchSlotGrad(
  slot: u32,
  uv: vec2<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>,
) -> vec4<f32> {
  // Every slot is fetched and the result picked without branching: see prefersSelectSampler.
  var result = ${sampleSlot(MAX_BATCH_TEXTURES - 1)};
${slotIndices
  .slice(0, -1)
  .map((i) => `  result = select(result, ${sampleSlot(i)}, slot == ${i}u);`)
  .join('\n')}
${RESERVED_SLOTS.map(([slot, value]) => `  result = select(result, ${value}, slot == ${slot}u);`).join('\n')}
  return result;
}`;

const batchTextureHelpers = (select: BatchTextureSelect) => `
//=============================================================================
// BATCH TEXTURE HELPERS
//=============================================================================
var<private> _textureSlots: u32;

fn _unpackSlot(slots: u32, shift: u32) -> u32 {
  return (slots >> shift) & 0xFu;
}

${select === 'select' ? WGSL_SAMPLE_SELECT : WGSL_SAMPLE_BRANCH}

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
 * What {@link prefersSelectSampler} decides on
 * @internal
 */
interface BatchTextureSelectContext {
  /** The adapter's `info`, absent on browsers that predate it */
  adapter: Pick<GPUAdapterInfo, 'vendor'> | undefined;
  /** Whether the renderer's canvas is multisampled (`antialias`) */
  antialias: boolean;
  /** The browser's user agent */
  userAgent: string;
}

/**
 * Whether a renderer's batch sampler should be the `'select'` one
 *
 * `true` on an Apple GPU with a multisampled canvas, outside Firefox. There, a texture sample
 * inside any branch of a fragment shader stalls for milliseconds per call site, on desktop and on
 * phones. Firefox's WGSL compiler produces code that does not stall. Everywhere else `'branch'` is
 * faster, because it fetches one slot where `'select'` fetches them all.
 *
 * A renderer makes this choice once, from its canvas, so two kinds of view get the other sampler.
 * A view that draws into single-sample targets on a multisampled canvas, one with post effects,
 * pays for the extra fetches with no stall to avoid. A view that draws into a multisampled render
 * texture on a single-sample canvas still stalls. Both want the choice made per view, from the
 * sample count of the view's target.
 *
 * Firefox on iOS is WebKit, not Gecko, and its user agent says `FxiOS`. The `Firefox` check misses
 * it, so it keeps `'select'`, the right sampler on WebKit.
 *
 * If the browsers fix the stall, `'select'` is pure cost. Re-measure with MSAA on and drop it.
 * @param context - What the choice depends on
 * @param context.adapter - The adapter's `info`, absent on browsers that predate it
 * @param context.antialias - Whether the renderer's canvas is multisampled
 * @param context.userAgent - The browser's user agent
 * @returns `true` when `'select'` is the faster sampler
 * @internal
 */
export function prefersSelectSampler({ adapter, antialias, userAgent }: BatchTextureSelectContext): boolean {
  return antialias && adapter?.vendor === 'apple' && !userAgent.includes('Firefox');
}

/**
 * Builds the WGSL compiler plugin that collects `textures` from each bit and generates one
 * `sampleX(uv)` function per declared slot
 *
 * The plugin also auto-injects the batch texture bindings into the shader before the core WGSL
 * plugins process them.
 * @param select - How the generated sampler picks its slot; see {@link BatchTextureSelect}
 * @returns The plugin
 * @internal
 */
export function createTexturesPluginGpu(select: BatchTextureSelect): ShaderCompilerPlugin {
  const header = batchTextureHelpers(select);

  return {
    collectData(context) {
      if (!context.bits.some((b) => b.name === 'batchTexturesBindings')) {
        context.bits.unshift({
          name: 'batchTexturesBindings',
          bindings: { batch: batchTextureBindings },
          gpu: { header },
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
}
