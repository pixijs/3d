import { stubGlobalTextureBindings } from '@test-utils';
import { BindGroup } from 'pixi.js';
import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GraphRenderPass } from '~/core/render-graph/GraphRenderPass';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { TransientTextureOptions } from '~/core/render-graph/ResourceHandle';

const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;
const desc: TransientTextureOptions = { width: 1, height: 1, resolution: 1, format: 'rgba8unorm' };

const makeGraph = (): RenderGraph =>
  new RenderGraph({
    globalTextureBindings: stubGlobalTextureBindings(),
    defaultColor: noTexture,
    defaultDepth: noTexture,
  });

function pass(name: string, setup: (b: PassBuilder) => void): GraphRenderPass {
  return { name, setup, render() {} };
}

describe('PassBuilder.sample bindings, with stub passes and no GPU', () => {
  it('rejects a depth handle bound with a sampler slot, since a depth view has no sampler', () => {
    const g = makeGraph();
    const depth = g.createDepth(desc);
    const own = new BindGroup({ uDepth: null, uDepthSampler: null });
    expect(() =>
      g.addPass(pass('effect', (b) => b.sample(depth, { group: own, slot: 'uDepth', styleSlot: 'uDepthSampler' }))),
    ).toThrow(/no sampler to bind beside it/);
  });

  it('accepts a colour handle with a sampler slot and a depth handle without one, and compiles', () => {
    const g = makeGraph();
    const color = g.createColor(desc);
    const depth = g.createDepth(desc);
    const own = new BindGroup({ uTexture: null, uTextureSampler: null, uDepth: null });
    g.addPass(
      pass('producer', (b) => {
        b.produce(color);
        b.produce(depth);
      }),
    );
    expect(() =>
      g.addPass(
        pass('reader', (b) => {
          b.sample(color, { group: own, slot: 'uTexture', styleSlot: 'uTextureSampler' });
          b.sample(depth, { group: own, slot: 'uDepth' });
        }),
      ),
    ).not.toThrow();
    expect(() => g.compile()).not.toThrow();
  });
});
