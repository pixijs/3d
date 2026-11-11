import { getApp, stubGlobalTextureBindings } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { BloomEffect } from '~/extras/post-processing/effects/BloomEffect';
import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectIO } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { EffectStage, SceneStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { createDefaultGraph3D } from '~/scene/utils/createDefaultGraph3D';
import type { DefaultGraph3DOptions } from '~/scene/utils/createDefaultGraph3D';

class StubScenePass extends Pass3D {
  constructor(
    public readonly stage: SceneStage,
    private readonly _name: string,
  ) {
    super();
  }

  public build(graph: RenderGraph): void {
    graph.addPass({
      name: this._name,
      setup: (b: PassBuilder) => {
        b.writeColor(b.targetColor);
      },
      render() {},
    });
  }
}

class StubEffect extends PostEffect {
  constructor(
    private readonly _name: string,
    stage: EffectStage = 'beforeToneMapping',
  ) {
    super({ stage });
  }

  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass({
      name: this._name,
      setup: (b: PassBuilder) => {
        b.read(io.input);
        b.writeColor(io.output ?? b.defaultColor);
      },
      render() {},
    });
  }
}

class RoguePost extends Pass3D {
  public readonly stage = 'beforeToneMapping';

  public build(): void {}
}

async function withGraph<T>(
  options: Omit<DefaultGraph3DOptions, 'globalTextureBindings' | 'toneMapping'> &
    Partial<Pick<DefaultGraph3DOptions, 'toneMapping'>>,
  run: (names: string[], graph: RenderGraph) => T,
): Promise<T> {
  const app = await getApp<WebGLRenderer>({
    id: 'default-graph-stages',
    appOptions: { preference: 'webgl', width: 64, height: 64, autoStart: false },
  });
  try {
    const { graph } = createDefaultGraph3D(app.renderer, {
      toneMapping: 'aces',
      ...options,
      globalTextureBindings: stubGlobalTextureBindings(),
    });
    try {
      return run(
        graph.passes.map((p) => p.name),
        graph,
      );
    } finally {
      graph.destroy();
    }
  } finally {
    app.destroy();
  }
}

describe('createDefaultGraph3D stages, the contract every pass author writes against', () => {
  it('places each pass at its stage whatever the array order, then the post chain in array order', async () => {
    await withGraph(
      {
        passes: [
          new StubEffect('aa', 'afterToneMapping'),
          new StubEffect('fxA'),
          new StubScenePass('afterTransparent', 'late'),
          new StubScenePass('afterOpaque', 'early'),
          new StubScenePass('beforeOpaque', 'feed'),
          new StubEffect('fxB'),
        ],
      },
      (names) => {
        const at = (name: string) => {
          const i = names.indexOf(name);
          expect(i, name).toBeGreaterThanOrEqual(0);
          return i;
        };
        expect(at('feed')).toBeGreaterThan(at('shadow'));
        expect(at('feed')).toBeLessThan(at('depthClear'));
        expect(at('early')).toBeGreaterThan(at('opaque'));
        expect(at('early')).toBeLessThan(at('copyDepth'));
        expect(at('late')).toBeGreaterThan(at('transparent'));
        expect(at('late')).toBeLessThan(at('fxA'));
        expect(at('fxA')).toBeLessThan(at('fxB'));
        expect(at('fxB'), 'the tone curve runs after the last linear effect').toBeLessThan(at('output'));
        expect(names[names.length - 1], 'an afterToneMapping effect runs after the curve').toBe('aa');
      },
    );
  });

  it('derives composite mode from the chain', async () => {
    await withGraph({}, (names, graph) => {
      expect(graph.sceneColor).toBe(graph.defaultColor);
      expect(names).not.toContain('output');
    });
    await withGraph({ composite: true }, (names, graph) => {
      expect(graph.sceneColor).not.toBe(graph.defaultColor);
      expect(names[names.length - 1]).toBe('output');
    });
    await withGraph({ passes: [new StubEffect('fx', 'afterToneMapping')] }, (names, graph) => {
      expect(graph.sceneColor).not.toBe(graph.defaultColor);
      expect(names, 'the curve stays in the materials, and the effect presents').not.toContain('output');
    });
    await withGraph({ passes: [new StubEffect('fx')], toneMapping: 'custom' }, (names) => {
      expect(names[names.length - 1], "'custom' leaves the curve to the effects").toBe('fx');
    });
  });

  it('puts each effect at the stage its class picks, which one instance can move', () => {
    expect(new BloomEffect().stage).toBe('beforeToneMapping');
    expect(new FxaaEffect().stage, 'antialiasing judges the picture').toBe('afterToneMapping');
    expect(new TintEffect().stage).toBe('afterToneMapping');
    expect(new TintEffect({ stage: 'beforeToneMapping' }).stage, 'tinting the light instead').toBe('beforeToneMapping');
    // @ts-expect-error a MeshPass draws meshes, so it takes a scene stage only
    expect(new MeshPass({ name: 'misplaced', stage: 'afterToneMapping' })).toBeDefined();
  });

  it('skips disabled passes', async () => {
    const off = new StubScenePass('afterOpaque', 'off');
    off.enabled = false;
    await withGraph({ passes: [off, new StubScenePass('afterOpaque', 'on')] }, (names) => {
      expect(names).toContain('on');
      expect(names).not.toContain('off');
    });
  });

  it('refuses the post stage to anything that is not a post effect', async () => {
    await expect(withGraph({ passes: [new RoguePost()] }, () => {})).rejects.toThrow(/reserved for PostEffect/);
  });
});
