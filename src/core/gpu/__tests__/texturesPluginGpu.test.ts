import { describe, expect, it } from 'vitest';

import { MAX_BATCH_TEXTURES } from '~/core/batcher/batchConstants';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createTexturesPluginGpu, prefersSelectSampler } from '~/core/gpu/shader/texturesPluginGpu';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

import { compilationErrors } from './compilationErrors';

/**
 * A module WebGPU can compile on its own
 *
 * It declares the plugin's batch textures, a sampler for them to use, a fragment entry point that
 * calls both generated getters, and a vertex entry point that calls the `Direct` one. The engine
 * ships one source for both stages, so the module has to be legal for both. `sampleBaseColor`
 * takes derivatives, which only a fragment entry point may reach, and `sampleBaseColorDirect` must
 * take none. The engine's own sampler lives in the global group, which this template does not
 * declare.
 */
const template: ShaderBitTemplate = {
  bindGroups: ['batch'],
  gpu: `{{header}}
{{textureGetters}}

@vertex
fn mainVertex(@location(0) uv: vec2<f32>) -> @builtin(position) vec4<f32> {
  return vec4<f32>(uv + sampleBaseColorDirect(uv).xy, 0.0, 1.0);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return sampleBaseColor(uv) + sampleBaseColorDirect(uv);
}`,
};

const bits: readonly ShaderBit[] = [
  { name: 'test', textures: ['baseColor', 'normal'] },
  { name: 'testSampler', bindings: { batch: { uSampler: 'sampler' } } },
];

/**
 * Compiles the test bits with the plugin in `select` mode, from a fresh copy of `bits`: the plugin
 * adds its bindings bit to the array in place and skips an array that has one, so a shared array
 * would hand the second mode the first mode's sampler
 * @param select - How the generated sampler picks its slot
 */
const compile = (select: 'branch' | 'select') =>
  compileWgslSource({ bits: [...bits], template, extraPlugins: [createTexturesPluginGpu(select)] }).fragment.source;

/** What every compiled module starts with */
const DIRECTIVE = 'diagnostic(off, derivative_uniformity);';

/** What the reserved slots return: 13 EMPTY, 14 WHITE, 15 NORMAL_MAP, the ones Mesh3DBatcher hands out as `13 + uid` */
const RESERVED_VALUES: readonly [slot: number, value: string][] = [
  [13, 'vec4<f32>(0.0)'],
  [14, 'vec4<f32>(1.0)'],
  [15, 'vec4<f32>(0.5, 0.5, 1.0, 1.0)'],
];

/** The same three values as the branch samplers compute them, before the switch fetches anything */
const RESERVED_BRANCH = `if (slot >= 13u) {
    let value = select(1.0, 0.0, slot == 13u);
    let xy = value * select(1.0, 0.5, slot == 15u);
    return vec4<f32>(xy, xy, value, value);
  }`;

/**
 * The source between two generated functions, both of which must be there: without them the
 * slice is meaningless, and a check that something is absent from it would pass for the wrong
 * reason
 */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** The generated `sampleBatchSlotGrad`, the sampler the `Direct` getters call */
const gradSamplerBody = (source: string) => between(source, 'fn sampleBatchSlotGrad', 'fn sampleBatchSlot(');

/** The generated `sampleBatchSlot`, the sampler the fragment getters call */
const fragmentSamplerBody = (source: string) => between(source, 'fn sampleBatchSlot(', 'fn sampleBaseColorDirect(');

/** Every call of `sample` in `body`, so a count can prove one per slot */
const fetches = (body: string, sample: string) => body.match(new RegExp(`${sample}\\(`, 'g'));

/**
 * The switch form: the reserved slots return before the switch fetches anything, then one arm per
 * slot plus `default:` fetches with `sample`, and nothing fetches outside them
 */
function expectBranchSwitch(body: string, sample: string): void {
  expect(body).toContain('switch (slot)');
  expect(body).toContain(RESERVED_BRANCH);
  expect(body.indexOf(RESERVED_BRANCH)).toBeLessThan(body.indexOf('switch (slot)'));
  expect(fetches(body, sample)).toHaveLength(MAX_BATCH_TEXTURES + 1);
  expect(body).not.toMatch(/dpdx|dpdy/);
}

/**
 * The select form: every slot is fetched with `sample` and no control flow surrounds the fetches.
 * Slots past the last texture have no `select` of their own, so they keep the seed value. The seed
 * is the last slot, the same texture branch mode's `default:` arm returns for them. The reserved
 * slots pick a constant over the fetched result.
 */
function expectSelectChain(body: string, sample: string): void {
  expect(body).not.toMatch(/switch|if \(|dpdx|dpdy/);
  expect(fetches(body, sample)).toHaveLength(MAX_BATCH_TEXTURES);
  expect(body).toContain(`var result = ${sample}(uBatchTexture${MAX_BATCH_TEXTURES - 1}, uSampler, uv`);
  for (let slot = 0; slot < MAX_BATCH_TEXTURES; slot++) {
    expect(body).toContain(`${sample}(uBatchTexture${slot}, uSampler, uv`);
  }
  for (const [slot, value] of RESERVED_VALUES) {
    expect(body).toContain(`result = select(result, ${value}, slot == ${slot}u);`);
  }
}

describe('texturesPluginGpu', () => {
  it('generates WGSL a real device accepts in both stages, whichever sampler it picks, and only under the directive', async () => {
    const gpu = navigator.gpu;
    expect(gpu).toBeTruthy();
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const device = await adapter!.requestDevice();

    try {
      const branch = compile('branch');

      expect(await compilationErrors(device, branch), 'the Direct getter reaches no fragment-only builtin').toEqual([]);
      expect(await compilationErrors(device, compile('select'))).toEqual([]);

      expect(branch.startsWith(DIRECTIVE)).toBe(true);
      const errors = await compilationErrors(device, branch.replace(DIRECTIVE, ''));
      expect(
        errors.some((e) => e.includes('uniform')),
        'without the directive, the device refuses a sample inside a switch on a varying',
      ).toBe(true);
    } finally {
      device.destroy();
    }
  });

  it('branch mode reaches one slot through a switch, past the reserved slots, in both samplers', () => {
    const source = compile('branch');

    expectBranchSwitch(gradSamplerBody(source), 'textureSampleGrad');

    const fragment = fragmentSamplerBody(source);
    expectBranchSwitch(fragment, 'textureSample');
    expect(fragment).not.toContain('textureSampleGrad(');
  });

  it('select mode fetches every slot with no control flow, in both samplers', () => {
    const source = compile('select');

    expectSelectChain(gradSamplerBody(source), 'textureSampleGrad');

    const fragment = fragmentSamplerBody(source);
    expectSelectChain(fragment, 'textureSample');
    expect(fragment).not.toContain('textureSampleGrad(');
  });

  it('the fragment getter takes the implicit path, the Direct getter keeps the zero gradients the vertex stage needs, and each texture shifts four bits', () => {
    const source = compile('branch');

    expect(source).toContain('return sampleBatchSlot((_textureSlots >> 0u) & 0xFu, uv);');
    expect(source).toContain(
      'return sampleBatchSlotGrad((_textureSlots >> 0u) & 0xFu, uv, vec2<f32>(0.0), vec2<f32>(0.0));',
    );

    expect(source).toContain('return sampleBatchSlot((_textureSlots >> 4u) & 0xFu, uv);');
    expect(source).toContain(
      'return sampleBatchSlotGrad((_textureSlots >> 4u) & 0xFu, uv, vec2<f32>(0.0), vec2<f32>(0.0));',
    );
  });

  it('prefers select only on Apple GPUs, outside Firefox, with MSAA on', () => {
    const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    const safari = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
    const firefox = 'Mozilla/5.0 (Macintosh; rv:156.0) Gecko/20100101 Firefox/156.0';
    const chromeIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1';
    const firefoxIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/156.0 Mobile/15E148 Safari/605.1.15';
    const apple = { vendor: 'apple' };

    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: chrome })).toBe(true);
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: safari })).toBe(true);

    const webkitOnIos = 'every iOS browser is WebKit, and neither user agent says Firefox';
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: chromeIos }), webkitOnIos).toBe(true);
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: firefoxIos }), webkitOnIos).toBe(true);

    expect(
      prefersSelectSampler({ adapter: apple, antialias: true, userAgent: firefox }),
      'Gecko compiles the branch without the stall',
    ).toBe(false);
    expect(
      prefersSelectSampler({ adapter: apple, antialias: false, userAgent: chrome }),
      'without MSAA there is no stall to avoid',
    ).toBe(false);
    expect(prefersSelectSampler({ adapter: { vendor: 'nvidia' }, antialias: true, userAgent: chrome })).toBe(false);

    const unknownAdapter = 'a masked or missing adapter info keeps the portable sampler';
    expect(prefersSelectSampler({ adapter: { vendor: '' }, antialias: true, userAgent: chrome }), unknownAdapter).toBe(
      false,
    );
    expect(prefersSelectSampler({ adapter: undefined, antialias: true, userAgent: chrome }), unknownAdapter).toBe(
      false,
    );
  });
});
