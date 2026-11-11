import { stubGlobalTextureBindings } from '@test-utils';
import type { BindableTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GraphRenderPass } from '~/core/render-graph/GraphRenderPass';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { TransientTextureOptions } from '~/core/render-graph/ResourceHandle';
import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';

const noTexture = (): BindableTexture => undefined as unknown as BindableTexture;
const desc: TransientTextureOptions = { width: 1, height: 1, resolution: 1, format: 'rgba8unorm' };

const SESSION = {} as RenderSession;

const makeGraph = (): RenderGraph =>
  new RenderGraph({
    globalTextureBindings: stubGlobalTextureBindings(),
    defaultColor: noTexture,
    defaultDepth: noTexture,
  });

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

  it('keeps a pass with a side effect and what feeds it, though nothing reads what it does', () => {
    const g = makeGraph();
    const ids = g.createColor(desc);
    g.addPass(pass('ids', (b) => b.writeColor(ids)));
    g.addPass(
      pass('readback', (b) => {
        b.read(ids);
        b.sideEffect();
      }),
    );
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual(['ids', 'readback']);
  });

  it('leaves the condition in charge of a pass with a side effect, so what only feeds it skips too', () => {
    const g = makeGraph();
    const ids = g.createColor(desc);
    g.addPass(pass('ids', (b) => b.writeColor(ids)));
    g.addPass(
      pass(
        'readback',
        (b) => {
          b.read(ids);
          b.sideEffect();
        },
        false,
      ),
    );
    g.compile();
    g.resolve(SESSION);
    expect(activeNames(g)).toEqual([]);
  });
});

describe('RenderGraph compile rejects a global-group sample of an attached transient', () => {
  it("throws, naming both passes, when a pass samples through the view's global group what another attaches", () => {
    const g = makeGraph();
    const depth = g.createDepth(desc);
    g.addPass(pass('scene', (b) => b.writeDepth(depth)));
    g.addPass(pass('effect', (b) => b.sample(depth, b.globalTextureBindings.opaqueDepth)));
    expect(() => g.compile()).toThrow(
      /"effect" samples resource \d+ through the view's global bind group, and pass "scene" attaches it/,
    );
  });
});

describe('RenderGraph scene outputs', () => {
  const sceneGraph = (sceneOutputs?: readonly SceneOutput[]): RenderGraph =>
    new RenderGraph({
      globalTextureBindings: stubGlobalTextureBindings(),
      defaultColor: noTexture,
      defaultDepth: noTexture,
      sceneColor: {},
      sceneDepth: {},
      sceneOutputs,
    });
  const maskOutput: SceneOutput = { name: 'mask', format: 'r8unorm' };
  const motionOutput: SceneOutput = { name: 'motion', format: 'rg16float' };

  it('needs a scene colour to attach outputs beside, and says so', () => {
    expect(
      () =>
        new RenderGraph({
          globalTextureBindings: stubGlobalTextureBindings(),
          defaultColor: noTexture,
          defaultDepth: noTexture,
          sceneOutputs: [maskOutput],
        }),
    ).toThrow(/sceneOutputs need a sceneColor/);
  });

  it('attaches none by default, and says how to get one it lacks', () => {
    const graph = sceneGraph();

    expect(graph.sceneOutputs).toEqual([]);
    expect(() => graph.getSceneOutput(motionOutput)).toThrow(
      /doesn't attach 'motion'\. List it in the pass's `requiredOutputs`/,
    );
  });
});
