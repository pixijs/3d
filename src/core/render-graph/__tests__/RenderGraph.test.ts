import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GraphRenderPass } from '~/core/render-graph/GraphRenderPass';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { TransientTextureOptions } from '~/core/render-graph/ResourceHandle';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';

/**
 * Cull / dependency-keeping tests for the render graph.
 *
 * `resolve()`'s flood-fill is pure logic — it only touches the session through
 * `pass.condition` — so these drive it with stub passes (no GPU, no real
 * textures). A pass is just `{ name, setup, render }`; `setup` declares its
 * reads/writes against handles, and `condition()` decides per-frame survival.
 *
 * The headline case is the one composite exposed: a colour buffer written by
 * several passes in sequence, read once at the end, with an *optional* writer
 * (condition-culled) in the middle. Every still-live writer must survive. The
 * old code kept only the last writer plus a write-after-write chain, which
 * snapped at the culled pass and dropped every writer upstream of it (the skybox).
 */

// Texture getters / transient descriptors are never invoked by compile() or
// resolve() — only execute() resolves real textures — so stubs are safe.
const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;
const desc: TransientTextureOptions = { width: 1, height: 1, resolution: 1, format: 'rgba8unorm' };

// resolve() reads the session only via pass.condition(); the stubs below ignore it.
const SESSION = {} as RenderSession;

const makeGraph = (): RenderGraph => new RenderGraph({ defaultColor: noTexture, defaultDepth: noTexture });

/** A stub pass. `condition` is the constant its `condition()` returns; omit for "always run". */
function pass(name: string, setup: (b: PassBuilder) => void, condition?: boolean): GraphRenderPass {
  return {
    name,
    setup,
    render() {},
    ...(condition === undefined ? {} : { condition: () => condition }),
  };
}

const activeNames = (g: RenderGraph): string[] =>
  captureGraphDebugSnapshot(g)
    .passes.filter((p) => p.active)
    .map((p) => p.name)
    .sort();

describe('RenderGraph cull', () => {
  it('preserves optional pass descriptions for graph tooling', () => {
    const g = makeGraph();
    const screen = g.importColor(noTexture);
    g.addPass({
      ...pass('writer', (b) => b.writeColor(screen)),
      description: 'Writes the final color target.',
    });
    g.compile();

    expect(captureGraphDebugSnapshot(g).passes[0].description).toBe('Writes the final color target.');
  });

  it('keeps a pass that writes an imported (anchor) resource, even with no reader', () => {
    const g = makeGraph();
    const screen = g.importColor(noTexture);
    g.addPass(pass('writer', (b) => b.writeColor(screen)));
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual(['writer']);
  });

  it('culls a pass whose only output is a transient nobody reads', () => {
    const g = makeGraph();
    const scratch = g.createColor(desc);
    g.addPass(pass('writer', (b) => b.writeColor(scratch)));
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual([]);
  });

  it('keeps a transient writer once something downstream reads it', () => {
    const g = makeGraph();
    const scene = g.createColor(desc);
    const screen = g.importColor(noTexture);
    g.addPass(pass('writer', (b) => b.writeColor(scene)));
    g.addPass(
      pass('out', (b) => {
        b.read(scene);
        b.writeColor(screen);
      }),
    );
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual(['out', 'writer']);
  });

  it('makes a read depend on every writer of the resource, not just the last', () => {
    const g = makeGraph();
    const scene = g.createColor(desc);
    const screen = g.importColor(noTexture);
    g.addPass(pass('a', (b) => b.writeColor(scene)));
    g.addPass(pass('b', (b) => b.writeColor(scene)));
    g.addPass(
      pass('out', (b) => {
        b.read(scene);
        b.writeColor(screen);
      }),
    );
    g.compile();
    const snapshot = captureGraphDebugSnapshot(g);
    const out = snapshot.passes.find((p) => p.name === 'out')!;
    // `dependsOn` holds declaration indices, so resolve them back to names for the assert.
    expect(out.dependsOn.map((idx) => snapshot.passes[idx].name)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('keeps every live writer of a read transient, skipping a condition-culled one mid-chain', () => {
    // The composite skybox regression: `out` reads `scene`; `optional` (e.g. a
    // glass pass with no glass) culls out in the *middle*. a/b/c must still survive.
    const g = makeGraph();
    const scene = g.createColor(desc);
    const screen = g.importColor(noTexture);
    g.addPass(pass('a', (b) => b.writeColor(scene)));
    g.addPass(pass('b', (b) => b.writeColor(scene)));
    g.addPass(pass('optional', (b) => b.writeColor(scene), false));
    g.addPass(pass('c', (b) => b.writeColor(scene)));
    g.addPass(
      pass('out', (b) => {
        b.read(scene);
        b.writeColor(screen);
      }),
    );
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual(['a', 'b', 'c', 'out']);
  });

  it('survives even when the last writer of a read transient is condition-culled', () => {
    const g = makeGraph();
    const scene = g.createColor(desc);
    const screen = g.importColor(noTexture);
    g.addPass(pass('a', (b) => b.writeColor(scene)));
    g.addPass(pass('b', (b) => b.writeColor(scene)));
    g.addPass(pass('lastOptional', (b) => b.writeColor(scene), false));
    g.addPass(
      pass('out', (b) => {
        b.read(scene);
        b.writeColor(screen);
      }),
    );
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual(['a', 'b', 'out']);
  });
});
