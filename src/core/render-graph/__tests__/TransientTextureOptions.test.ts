import { stubGlobalTextureBindings } from '@test-utils';
import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { RenderGraphOptions } from '~/core/render-graph/RenderGraph';
import type { ResourceDescriptor, ResourceHandle } from '~/core/render-graph/ResourceHandle';
import type { RenderSession } from '~/core/render-passes/RenderSession';

const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;

const SESSION = {
  viewport: { x: 0, y: 0, width: 400, height: 300 },
  defaultTarget: {
    colorTexture: { source: { resolution: 2, pixelWidth: 800, pixelHeight: 600, format: 'rgba8unorm' } },
  },
  defaultFrontFaceInverted: false,
} as unknown as RenderSession;

function makeGraph(options?: Partial<RenderGraphOptions>): RenderGraph {
  const graph = new RenderGraph({
    globalTextureBindings: stubGlobalTextureBindings(),
    defaultColor: noTexture,
    defaultDepth: noTexture,
    ...options,
  });
  graph.resolution = 2;
  return graph;
}

function describeOf(graph: RenderGraph, handle: ResourceHandle): ResourceDescriptor {
  const entry = graph['_resources'][handle._id];
  if (entry.kind !== 'transient') throw new Error('expected a transient');
  return entry.describe(SESSION);
}

const sizeOf = (graph: RenderGraph, handle: ResourceHandle): [number, number] => {
  const d = describeOf(graph, handle);
  return [d.width, d.height];
};

describe('TransientTextureOptions expand to a pool request, texels = logical size × resolution', () => {
  it("'inherit' is the physical viewport, in the target's format, as a content size the pool fits a texture to", () => {
    const g = makeGraph();
    const d = describeOf(g, g.createColor({ label: 'scratch' }));
    expect(d).toEqual({
      width: 400,
      height: 300,
      format: 'rgba8unorm',
      autoGenerateMipmaps: false,
      label: 'scratch',
    });
    expect('scaleMode' in d).toBe(false);
  });

  it('depth defaults to depth24plus-stencil8 and nearest sampling', () => {
    const g = makeGraph();
    const d = describeOf(g, g.createDepth({ label: 'depthCopy' }));
    expect(d.format).toBe('depth24plus-stencil8');
    expect(d.scaleMode).toBe('nearest');
    expect(d.autoGenerateMipmaps).toBe(false);
  });

  it('an explicit size is logical and multiplied by resolution', () => {
    const g = makeGraph();
    const fixed = describeOf(g, g.createColor({ width: 256, height: 256, resolution: 1 }));
    expect([fixed.width, fixed.height]).toEqual([256, 256]);
    const inherited = describeOf(g, g.createColor({ width: 100, height: 50 }));
    expect([inherited.width, inherited.height], 'the inherited DPR 2 doubles it').toEqual([200, 100]);
  });
});

describe("resolution: 'inherit' follows RenderGraph.resolution", () => {
  it('sizes the scene targets, their outputs and any other texture at it, and leaves a number absolute', () => {
    const g = makeGraph({ sceneColor: {}, sceneDepth: {}, sceneOutputs: [{ name: 'mask', format: 'r8unorm' }] });
    g.resolution = 1;
    const output = g.getSceneOutput({ name: 'mask', format: 'r8unorm' });

    for (const handle of [g.sceneColor, g.sceneDepth, g.createColor(), output]) {
      expect(sizeOf(g, handle)).toEqual([200, 150]);
    }
    expect(sizeOf(g, g.createColor({ resolution: 2 })), 'a number stays absolute').toEqual([400, 300]);
  });
});
