import { MAX_BATCH_TEXTURES } from '../../batcher/batchConstants';
import type { BindingGroup } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * How the generated samplers pick the batch texture a fragment samples
 *
 * - `'branch'`: a `switch` on the slot with one sample per arm; only the taken slot is fetched.
 * - `'select'`: every slot is fetched and the result is chosen with `select`; no control flow
 *   surrounds the fetches.
 *
 * Fragment samples take the implicit level of detail in both forms. Inside the switch that is only
 * legal under the `derivative_uniformity` directive `compileWgslSource` prepends to every module.
 * The directive's doc there says why.
 * @internal
 */
type BatchTextureSelect = 'branch' | 'select';

/** Reserved slots the batcher hands out for its built-in textures: EMPTY, WHITE, NORMAL_MAP */
const RESERVED_SLOTS: readonly [slot: number, value: string][] = [
  [13, 'vec4<f32>(0.0)'],
  [14, 'vec4<f32>(1.0)'],
  [15, 'vec4<f32>(0.5, 0.5, 1.0, 1.0)'],
];

type SampleSlot = (slot: number) => string;

const sampleSlotGrad: SampleSlot = (slot) => `textureSampleGrad(uBatchTexture${slot}, uSampler, uv, uvDx, uvDy)`;
const sampleSlot: SampleSlot = (slot) => `textureSample(uBatchTexture${slot}, uSampler, uv)`;

const slotIndices = Array.from({ length: MAX_BATCH_TEXTURES }, (_, i) => i);

/**
 * The WGSL that reads one texture's 4-bit slot out of the packed `_textureSlots`
 * @param shift - The slot's bit offset, four per texture in declaration order
 */
const slotOf = (shift: number) => `(_textureSlots >> ${shift}u) & 0xFu`;

/** The batch bind group's texture bindings, `uBatchTexture0` upwards, one per slot */
const batchTextureBindings: BindingGroup = Object.fromEntries(
  slotIndices.map((i) => [`uBatchTexture${i}`, 'texture_2d<f32>'] as const),
);

/**
 * The switch form's body, one arm per slot fetching with `sample`
 *
 * The reserved slots return a constant before the switch. The switch is on a flat varying,
 * uniform per primitive.
 * @param sample - The WGSL that fetches one slot
 */
const branchBody = (sample: SampleSlot) => `  if (slot >= 13u) {
    let value = select(1.0, 0.0, slot == 13u);
    let xy = value * select(1.0, 0.5, slot == 15u);
    return vec4<f32>(xy, xy, value, value);
  }

  switch (slot) {
${slotIndices.map((i) => `    case ${i}u: { return ${sample(i)}; }`).join('\n')}
    default: { return ${sample(MAX_BATCH_TEXTURES - 1)}; }
  }`;

/**
 * The select form's body, which fetches every slot with `sample` and picks the result without
 * branching; see {@link prefersSelectSampler}
 * @param sample - The WGSL that fetches one slot
 */
const selectBody = (sample: SampleSlot) => `  var result = ${sample(MAX_BATCH_TEXTURES - 1)};
${slotIndices
  .slice(0, -1)
  .map((i) => `  result = select(result, ${sample(i)}, slot == ${i}u);`)
  .join('\n')}
${RESERVED_SLOTS.map(([slot, value]) => `  result = select(result, ${value}, slot == ${slot}u);`).join('\n')}
  return result;`;

/**
 * Both samplers of one form: `sampleBatchSlotGrad`, which the `Direct` getters call with zero
 * gradients, and `sampleBatchSlot`, which the fragment getters call
 * @param body - The form's body, given the fetch it should use
 */
const samplers = (body: (sample: SampleSlot) => string) => `fn sampleBatchSlotGrad(
  slot: u32,
  uv: vec2<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>,
) -> vec4<f32> {
${body(sampleSlotGrad)}
}

fn sampleBatchSlot(slot: u32, uv: vec2<f32>) -> vec4<f32> {
${body(sampleSlot)}
}`;

const WGSL_SAMPLE_BRANCH = samplers(branchBody);
const WGSL_SAMPLE_SELECT = samplers(selectBody);

const batchTextureHelpers = (select: BatchTextureSelect) => `
var<private> _textureSlots: u32;

${select === 'select' ? WGSL_SAMPLE_SELECT : WGSL_SAMPLE_BRANCH}
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
 * phones, in Chrome and in Safari. Firefox's WGSL compiler produces code that does not stall.
 * Everywhere else `'branch'` is faster, because it fetches one slot where `'select'` fetches
 * them all.
 *
 * Measure this in an installed browser. The Chromium build Playwright bundles compiles the branch
 * without the stall on the same GPU, so the test suite cannot see it. Installed Chrome shows the
 * stall even when run headless.
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
 * Builds the WGSL compiler plugin that collects `textures` from each bit and generates a
 * fragment-only `sampleX(uv)` and a `sampleXDirect(uv)` for both stages per declared texture
 *
 * `sampleX` takes its mip level from the fragment's derivatives. `sampleXDirect` passes zero
 * gradients, which reads mip 0 and is legal in the vertex stage.
 *
 * The plugin also adds a bit holding the batch texture bindings and the `sampleBatchSlot`
 * functions, before the core WGSL plugins collect the bits. It adds it to the caller's `bits` array
 * in place, and skips an array that already has one, so each compile needs its own array.
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

          lines.push(
            `fn ${funcName}Direct(uv: vec2<f32>) -> vec4<f32> {`,
            `  return sampleBatchSlotGrad(${slotOf(shift)}, uv, vec2<f32>(0.0), vec2<f32>(0.0));`,
            `}`,
          );

          lines.push(
            `fn ${funcName}(uv: vec2<f32>) -> vec4<f32> {`,
            `  return sampleBatchSlot(${slotOf(shift)}, uv);`,
            `}`,
          );

          nextIndex++;
        }
      }

      return { textureGetters: lines.join('\n') };
    },
  };
}
