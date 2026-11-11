import { afterEach, describe, expect, it } from 'vitest';

import type { ShaderDescriptorOptions } from '~/core/shader/ShaderDescriptor';
import { BloomEffect } from '~/extras/post-processing/effects/BloomEffect';
import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { WireframePass } from '~/extras/post-processing/passes/WireframePass';
import type { MeshPassOptions } from '~/post-processing/passes/MeshPass';

function solidOverrides(pass: OutlinePass | WireframePass): Record<string, number> {
  const options = (pass as unknown as { _options: MeshPassOptions })._options;
  const shader = options.descriptor!.shaderDescriptor as ShaderDescriptorOptions;

  return shader.overrides as Record<string, number>;
}

describe('post-processing defaultOptions', () => {
  const bloom = { ...BloomEffect.defaultOptions };
  const fxaa = { ...FxaaEffect.defaultOptions };
  const tint = { ...TintEffect.defaultOptions };
  const tiltShift = { ...TiltShiftEffect.defaultOptions };
  const ssao = { ...SsaoEffect.defaultOptions };
  const outline = { ...OutlinePass.defaultOptions };
  const wireframe = { ...WireframePass.defaultOptions };

  afterEach(() => {
    BloomEffect.defaultOptions = { ...bloom };
    FxaaEffect.defaultOptions = { ...fxaa };
    TintEffect.defaultOptions = { ...tint };
    TiltShiftEffect.defaultOptions = { ...tiltShift };
    SsaoEffect.defaultOptions = { ...ssao };
    OutlinePass.defaultOptions = { ...outline };
    WireframePass.defaultOptions = { ...wireframe };
  });

  it('TintEffect reads its defaults from defaultOptions', () => {
    expect(new TintEffect().tint).toBe(0xffffff);

    TintEffect.defaultOptions.tint = 0xff8800;
    expect(new TintEffect().tint).toBe(0xff8800);
    expect(new TintEffect({ tint: undefined }).tint).toBe(0xff8800);
    expect(new TintEffect({ tint: 0x00ff00 }).tint).toBe(0x00ff00);
  });

  it('BloomEffect writes every default into its uniforms and fixes the pyramid shape at construction', () => {
    const effect = new BloomEffect();

    expect([effect.threshold, effect.intensity, effect.levels, effect.resolution]).toEqual([1, 1, 5, 0.5]);
    expect(effect.radius).toBeCloseTo(0.6);

    BloomEffect.defaultOptions.threshold = 0.6;
    const overridden = new BloomEffect({ threshold: undefined, intensity: 2 });
    expect(overridden.threshold).toBeCloseTo(0.6);
    expect(overridden.intensity).toBe(2);
    expect(new BloomEffect({ levels: 2.6 }).levels).toBe(3);
    expect(new BloomEffect({ levels: 0 }).levels).toBe(1);
  });

  it('FxaaEffect writes every default into its uniforms', () => {
    const effect = new FxaaEffect();

    expect(effect.edgeThreshold).toBeCloseTo(0.125);
    expect(effect.edgeThresholdMin).toBeCloseTo(0.05);
    expect(effect.edgeSharpness).toBe(8);

    FxaaEffect.defaultOptions.edgeSharpness = 4;
    const overridden = new FxaaEffect({ edgeSharpness: undefined, edgeThreshold: 0.166 });
    expect(overridden.edgeSharpness).toBe(4);
    expect(overridden.edgeThreshold).toBeCloseTo(0.166);
  });

  it('TiltShiftEffect writes every default into its uniforms', () => {
    const effect = new TiltShiftEffect();

    expect([effect.focalDepth, effect.focalNear, effect.focalFar, effect.maxBlur]).toEqual([35, 3, 14, 12]);
    expect(effect.debug).toBe(false);

    TiltShiftEffect.defaultOptions.maxBlur = 6;
    expect(new TiltShiftEffect({ maxBlur: undefined, focalDepth: 10 })).toMatchObject({ maxBlur: 6, focalDepth: 10 });
  });

  it('SsaoEffect reads its defaults and derives maxDistance from the resolved radius', () => {
    const effect = new SsaoEffect();

    expect(effect.radius).toBeCloseTo(0.35);
    expect(effect.maxDistance).toBeCloseTo(0.35 * 0.65);
    expect(effect.intensity).toBeCloseTo(0.9);
    expect(effect.bias).toBeCloseTo(0.025);
    expect(effect.power).toBeCloseTo(1.5);
    expect(effect.samples).toBe(16);
    expect(effect.blurStep).toBeCloseTo(1.5);

    SsaoEffect.defaultOptions.radius = 1;
    expect(new SsaoEffect().maxDistance).toBeCloseTo(0.65);
    expect(new SsaoEffect({ maxDistance: 0.1 }).maxDistance).toBeCloseTo(0.1);
  });

  it('OutlinePass builds its hull from defaultOptions', () => {
    const pass = new OutlinePass();

    expect(pass.stage).toBe('afterOpaque');
    expect(solidOverrides(pass)).toMatchObject({ SOLID_EXTRUDE: 0.03, SOLID_R: 0, SOLID_G: 0, SOLID_B: 0 });

    OutlinePass.defaultOptions.width = 0.1;
    OutlinePass.defaultOptions.color = 0xff0000;
    expect(solidOverrides(new OutlinePass({ width: undefined }))).toMatchObject({ SOLID_EXTRUDE: 0.1, SOLID_R: 1 });
  });

  it('WireframePass draws after transparents in green by default', () => {
    const pass = new WireframePass();

    expect(pass.stage).toBe('afterTransparent');
    expect(solidOverrides(pass)).toMatchObject({ SOLID_R: 0, SOLID_G: 1, SOLID_B: 0 });

    WireframePass.defaultOptions.stage = 'afterOpaque';
    expect(new WireframePass({ stage: undefined }).stage).toBe('afterOpaque');
  });
});
