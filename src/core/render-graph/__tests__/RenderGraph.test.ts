import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GraphRenderPass } from '~/core/render-graph/GraphRenderPass';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { TransientTextureOptions } from '~/core/render-graph/ResourceHandle';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';

/** A texture getter for imports; `compile()` and `resolve()` never call it, only `execute()` does */
const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;
const desc: TransientTextureOptions = { width: 1, height: 1, resolution: 1, format: 'rgba8unorm' };

/** An empty session: `resolve()` reads it only through `pass.condition`, which the stub passes ignore */
const SESSION = {} as RenderSession;

const makeGraph = (): RenderGraph => new RenderGraph({ defaultColor: noTexture, defaultDepth: noTexture });

/** A stub pass with no GPU work; `condition` is the constant its `condition()` returns, omitted to always run */
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

describe('RenderGraph cull, with stub passes and no GPU', () => {
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
    const dependencyNames = out.dependsOn.map((declarationIndex) => snapshot.passes[declarationIndex].name);
    expect(dependencyNames).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('keeps every live writer of a read transient, skipping a condition-culled one mid-chain', () => {
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
