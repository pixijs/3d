import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectIO } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassStage } from '~/post-processing/Pass3D';
import { createDefaultGraph3D } from '~/scene/utils/createDefaultGraph3D';
import type { DefaultGraph3DOptions } from '~/scene/utils/createDefaultGraph3D';

/** A scene-stage pass that adds one stub graph pass drawing into the scene colour */
class StubScenePass extends Pass3D {
  constructor(
    public readonly stage: Exclude<PassStage, 'post'>,
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

/** A post effect whose single pass reads its chain input and writes its slot's output */
class StubEffect extends PostEffect {
  constructor(private readonly _name: string) {
    super();
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

/** Claims the post stage without being a post effect */
class RoguePost extends Pass3D {
  public readonly stage = 'post';

  public build(): void {}
}

async function withGraph<T>(
  options: DefaultGraph3DOptions,
  run: (names: string[], graph: RenderGraph) => T,
): Promise<T> {
  const app = await getApp<WebGLRenderer>({
    id: 'default-graph-stages',
    appOptions: { preference: 'webgl', width: 64, height: 64, autoStart: false },
  });
  try {
    const { graph } = createDefaultGraph3D(app.renderer, options);
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
        expect(names[names.length - 1]).toBe('fxB');
        expect(names, 'the last effect presents, so no output blit runs').not.toContain('output');
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
    await withGraph({ passes: [new StubEffect('fx')] }, (names, graph) => {
      expect(graph.sceneColor).not.toBe(graph.defaultColor);
      expect(names).not.toContain('output');
    });
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
