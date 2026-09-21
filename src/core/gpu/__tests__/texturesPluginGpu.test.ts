import { describe, expect, it } from 'vitest';

import { MAX_BATCH_TEXTURES } from '~/core/batcher/batchConstants';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createTexturesPluginGpu, prefersSelectSampler } from '~/core/gpu/shader/texturesPluginGpu';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

/**
 * A module WebGPU can compile on its own
 *
 * It declares the plugin's batch textures, a sampler for them to use, and a fragment entry point
 * that calls both generated getters. The engine's own sampler lives in the global group, which this
 * template does not declare. `sampleBaseColor` takes derivatives, which are only legal in a
 * function a fragment entry point can reach.
 */
const template: ShaderBitTemplate = {
  bindGroups: ['batch'],
  gpu: `{{header}}
{{textureGetters}}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return sampleBaseColor(uv) + sampleBaseColorDirect(uv);
}`,
};

const bits: readonly ShaderBit[] = [
  { name: 'test', textures: ['baseColor'] },
  { name: 'testSampler', bindings: { batch: { uSampler: 'sampler' } } },
];

// The plugin adds its bindings bit to the bit array it gets, and skips an array that already has
// one. So each compile needs its own copy. Otherwise the second mode inherits the first mode's
// header.
const compile = (select: 'branch' | 'select') =>
  compileWgslSource({ bits: [...bits], template, extraPlugins: [createTexturesPluginGpu(select)] }).fragment.source;

/** The generated `sampleBatchSlotGrad`, the one function the two modes write differently */
function samplerBody(source: string): string {
  const start = source.indexOf('fn sampleBatchSlotGrad');
  const end = source.indexOf('fn sampleBatchTexture');

  // Without both markers the slice is meaningless, and a check that something is absent from it
  // would pass for the wrong reason.
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** Every error WebGPU reports for `code`, as `line:column message` */
async function compilationErrors(device: GPUDevice, code: string): Promise<string[]> {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const scoped = await device.popErrorScope();

  const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);

  if (scoped) errors.push(scoped.message);

  return errors;
}

describe('texturesPluginGpu', () => {
  it('generates WGSL a real device accepts, whichever sampler it picks', async () => {
    const gpu = navigator.gpu;
    expect(gpu).toBeTruthy();
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const device = await adapter!.requestDevice();

    try {
      expect(await compilationErrors(device, compile('branch'))).toEqual([]);
      expect(await compilationErrors(device, compile('select'))).toEqual([]);
    } finally {
      device.destroy();
    }
  });

  it('branch mode reaches one slot through a switch, past the reserved slots', () => {
    const body = samplerBody(compile('branch'));

    expect(body).toContain('switch (slot)');
    // The switch has one arm per slot plus a `default:` arm, and nothing fetches outside them.
    expect(body.match(/textureSampleGrad\(/g)).toHaveLength(MAX_BATCH_TEXTURES + 1);

    // The reserved slots are constants, so they return before the switch fetches anything.
    expect(body).toContain('if (slot >= 13u)');
    expect(body.indexOf('if (slot >= 13u)')).toBeLessThan(body.indexOf('switch (slot)'));
  });

  it('select mode fetches every slot with no control flow', () => {
    const body = samplerBody(compile('select'));

    expect(body).not.toMatch(/switch|if \(/);
    expect(body.match(/textureSampleGrad\(/g)).toHaveLength(MAX_BATCH_TEXTURES);
    for (let slot = 0; slot < MAX_BATCH_TEXTURES; slot++) expect(body).toContain(`uBatchTexture${slot},`);

    // Slots past the last texture have no `select` of their own, so they keep the seed value. That
    // is the last slot, the same texture branch mode's `default:` arm returns for them.
    expect(body).toMatch(new RegExp(`var result = textureSampleGrad\\(uBatchTexture${MAX_BATCH_TEXTURES - 1},`));

    // Slots 13 EMPTY, 14 WHITE and 15 NORMAL_MAP pick a constant over the fetched result.
    for (const slot of [13, 14, 15]) {
      expect(body).toMatch(new RegExp(`select\\(result, vec4<f32>\\([^)]*\\), slot == ${slot}u\\)`));
    }
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

    // Every iOS browser is WebKit, whatever its name, and neither user agent contains `Firefox`.
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: chromeIos })).toBe(true);
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: firefoxIos })).toBe(true);

    // Gecko compiles the branching sampler without the stall, so `'select'` would be pure cost.
    expect(prefersSelectSampler({ adapter: apple, antialias: true, userAgent: firefox })).toBe(false);
    // With MSAA off there is no stall to trade the extra fetches for.
    expect(prefersSelectSampler({ adapter: apple, antialias: false, userAgent: chrome })).toBe(false);
    expect(prefersSelectSampler({ adapter: { vendor: 'nvidia' }, antialias: true, userAgent: chrome })).toBe(false);

    // A browser that masks its adapter info, or predates `info`, keeps the portable sampler.
    expect(prefersSelectSampler({ adapter: { vendor: '' }, antialias: true, userAgent: chrome })).toBe(false);
    expect(prefersSelectSampler({ adapter: undefined, antialias: true, userAgent: chrome })).toBe(false);
  });
});
