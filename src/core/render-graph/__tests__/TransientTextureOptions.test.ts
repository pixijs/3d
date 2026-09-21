import { Rectangle } from 'pixi.js';
import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { RenderGraphOptions } from '~/core/render-graph/RenderGraph';
import type { ResourceDescriptor, ResourceHandle } from '~/core/render-graph/ResourceHandle';
import type { RenderSession } from '~/core/render-passes/RenderSession';

/**
 * `createColor` / `createDepth` options expand into the per-frame descriptor the pool consumes,
 * by pixi's rule: texels = logical size × resolution. The logical size defaults to the view's
 * viewport and the resolution to the target's own, so `{}` is the physical viewport.
 */

const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;

// A DPR-2 target: 400x300 physical viewport on an 800x600 framebuffer.
const SESSION = {
  viewport: { x: 0, y: 0, width: 400, height: 300 },
  defaultTarget: {
    colorTexture: { source: { resolution: 2, pixelWidth: 800, pixelHeight: 600, format: 'rgba8unorm' } },
  },
} as unknown as RenderSession;

const makeGraph = (options?: Partial<RenderGraphOptions>): RenderGraph =>
  new RenderGraph({ defaultColor: noTexture, defaultDepth: noTexture, ...options });

/** The per-frame descriptor a handle's transient expands to, evaluated against `SESSION` */
function describeOf(graph: RenderGraph, handle: ResourceHandle): ResourceDescriptor {
  const entry = graph['_resources'][handle._id];
  if (entry.kind !== 'transient') throw new Error('expected a transient');
  return entry.describe(SESSION);
}

describe('TransientTextureOptions shorthand', () => {
  it("'inherit' is the physical viewport, in the target's format", () => {
    const g = makeGraph();
    const d = describeOf(g, g.createColor({ label: 'scratch' }));
    // The descriptor is the content size only. Which texture it lands in is the pool's call,
    // made against the screen sizes registered with it.
    expect(d).toEqual({
      width: 400,
      height: 300,
      format: 'rgba8unorm',
      autoGenerateMipmaps: false,
      label: 'scratch',
    });
    expect('scaleMode' in d).toBe(false);
  });

  it('resolution has pixi meaning: 1 is one texel per logical pixel, half of a DPR-2 viewport', () => {
    const g = makeGraph();
    const d = describeOf(g, g.createColor({ resolution: 1 }));
    expect([d.width, d.height]).toEqual([200, 150]);
    expect(d.label).toBe('colorTransient');
  });

  it('depth defaults to depth24plus-stencil8 and nearest sampling', () => {
    const g = makeGraph();
    const d = describeOf(g, g.createDepth({ label: 'depthCopy' }));
    expect(d.format).toBe('depth24plus-stencil8');
    expect(d.scaleMode).toBe('nearest');
    expect(d.autoGenerateMipmaps).toBe(false);
  });

  it('explicit fields win over the defaults', () => {
    const g = makeGraph();
    const d = describeOf(g, g.createColor({ format: 'rgba16float', autoGenerateMipmaps: true, scaleMode: 'nearest' }));
    expect(d.format).toBe('rgba16float');
    expect(d.autoGenerateMipmaps).toBe(true);
    expect(d.scaleMode).toBe('nearest');
  });

  it('an explicit size is logical and multiplied by resolution', () => {
    const g = makeGraph();
    const fixed = describeOf(g, g.createColor({ width: 256, height: 256, resolution: 1 }));
    expect([fixed.width, fixed.height]).toEqual([256, 256]);
    // inherit on a DPR-2 target doubles a logical size into texels, as a pixi render texture would
    const inherited = describeOf(g, g.createColor({ width: 100, height: 50 }));
    expect([inherited.width, inherited.height]).toEqual([200, 100]);
  });

  it('the scene targets accept the shorthand too', () => {
    const g = makeGraph({
      sceneColor: { autoGenerateMipmaps: true, label: 'sceneColor' },
      sceneDepth: { label: 'sceneDepth' },
    });
    expect(describeOf(g, g.sceneColor).autoGenerateMipmaps).toBe(true);
    expect(describeOf(g, g.sceneDepth).format).toBe('depth24plus-stencil8');
  });
});

describe('RenderGraph.sceneViewport', () => {
  // The view sits off the target's origin, which is what tells the two modes apart.
  const session = { ...SESSION, viewport: { x: 60, y: 40, width: 400, height: 300 } } as unknown as RenderSession;

  it("is the view's place on its target when the scene draws straight to it", () => {
    const rect = makeGraph().sceneViewport(session, new Rectangle());

    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([60, 40, 400, 300]);
  });

  it("starts at the transient's origin, with the transient's own size, in composite mode", () => {
    const g = makeGraph({
      sceneColor: { label: 'sceneColor', resolution: 1 },
      sceneDepth: { label: 'sceneDepth', resolution: 1 },
    });
    const rect = g.sceneViewport(session, new Rectangle());

    // 400x300 physical on a DPR-2 target is 200x150 logical, and one texel per logical pixel.
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([0, 0, 200, 150]);
  });
});
