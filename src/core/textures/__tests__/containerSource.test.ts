import { getApp } from '@test-utils';
import { Container, Graphics, Ticker } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { ContainerSource } from '~/core/textures/ContainerSource';
import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { Material3D } from '~/materials/pbr/Material3D';

// Construction is CPU-only (no renderer), so these run without GPU. They guard the option-defaulting that the
// visual scenes never exercise (every scene passes resolution explicitly).
describe('ContainerSource construction', () => {
  it('defaults resolution to 1 when omitted — never a NaN-sized target', () => {
    const src = new ContainerSource({ container: new Container(), width: 16, height: 16 });

    expect(src.pixelWidth).toBe(16);
    expect(src.pixelHeight).toBe(16);
    expect(Number.isNaN(src.pixelWidth)).toBe(false);
  });

  it('multiplies pixel dimensions by resolution', () => {
    const src = new ContainerSource({ container: new Container(), width: 16, height: 16, resolution: 2 });

    expect(src.pixelWidth).toBe(32);
    expect(src.pixelHeight).toBe(32);
  });

  it('measures size from the container when dimensions are omitted', () => {
    const container = new Container();
    container.addChild(new Graphics().rect(0, 0, 40, 24).fill(0xffffff));
    const src = new ContainerSource({ container });

    expect(src.width).toBe(40);
    expect(src.height).toBe(24);
  });

  it('clamps a zero-bounds container to 1×1 instead of a degenerate target', () => {
    const src = new ContainerSource({ container: new Container() });

    expect(src.width).toBe(1);
    expect(src.height).toBe(1);
  });

  it('exposes and swaps its container', () => {
    const first = new Container();
    const src = new ContainerSource({ container: first, width: 8, height: 8 });
    expect(src.container).toBe(first);

    const second = new Container();
    src.setContainer(second);
    expect(src.container).toBe(second);
  });
});

// destroy() is CPU-only here (no GPU resource is allocated until render()), so these run without a renderer.
// They pin the pixi `destroySource` contract: the boolean gates the SOURCE (render target), never the wrapper,
// so material teardown that calls `texture.destroy(false)` keeps the shareable source alive.
describe('ContainerTexture / ContainerSource destroy', () => {
  function makeContainerTexture(): ContainerTexture {
    const container = new Container();
    container.addChild(new Graphics().rect(0, 0, 16, 16).fill(0xff0000));
    return new ContainerTexture({ container, width: 16, height: 16 });
  }

  it('destroy() / destroy(false) keeps the backing source alive (sources are shareable)', () => {
    const texture = makeContainerTexture();
    const source = texture.containerSource;

    texture.destroy();

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);

    source.destroy();
  });

  it('destroy(true) frees the backing source (pixi destroySource semantics)', () => {
    const texture = makeContainerTexture();
    const source = texture.containerSource;

    texture.destroy(true);

    expect(source.destroyed).toBe(true);
  });

  it('destroy({ container: true }) frees the source and the reparented container', () => {
    const texture = makeContainerTexture();
    const source = texture.containerSource;
    const container = texture.container;

    texture.destroy({ container: true });

    expect(source.destroyed).toBe(true);
    expect(container.destroyed).toBe(true);
  });

  it('material.destroy({ texture: true }) keeps the ContainerSource, not just the wrapper', () => {
    const texture = makeContainerTexture();
    const source = texture.containerSource;
    const material = new Material3D({ baseColorTexture: texture });

    material.destroy({ texture: true });

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);

    source.destroy();
  });

  it('material.destroy({ texture, textureSource }) frees the ContainerSource exactly once (no double-destroy)', () => {
    const texture = makeContainerTexture();
    const source = texture.containerSource;
    const material = new Material3D({ baseColorTexture: texture });

    expect(() => material.destroy({ texture: true, textureSource: true })).not.toThrow();
    expect(source.destroyed).toBe(true);
  });
});

// Renderer retention / firstRender / autoUpdate are CPU-observable without a GPU: we assert what is retained,
// that misuse warns instead of throwing, and that autoUpdate connects/disconnects a `Ticker.shared` listener
// (observed via `Ticker.shared.count`). A no-op stub renderer keeps a real per-frame tick harmless.
describe('ContainerSource renderer retention & autoUpdate', () => {
  type DestroyHook = { destroy: () => void };
  type BatcherRegistry = Record<number, Record<string, DestroyHook>>;
  type StubRenderer = Renderer & { hooks: DestroyHook[]; batchers: BatcherRegistry; batcherDestroy: () => void };

  // Mirrors the renderer surfaces the source touches: render() (which, like pixi's, makes the capture root a
  // render group, points its instruction set at the render pipes and caches a batcher entry under its uid), the
  // batch pipe's `destroyInstructionSet` hook (which pixi's `InstructionSet.destroy` calls on every pipe to free
  // that entry), and the destroy runner hooked to observe renderer teardown (`hooks` holds its items).
  // `destroy()` tears down like pixi's Renderer: the runner emits over a cached length, then the pipes are gone.
  const stubRenderer = (render?: (options: { container: Container }) => void): StubRenderer => {
    const hooks: DestroyHook[] = [];
    const batchers: BatcherRegistry = {};
    const batcherDestroy = vi.fn<() => void>();
    const renderPipes = {
      batch: {
        destroyInstructionSet: ({ uid }: { uid: number }) => {
          const entry = batchers[uid];
          if (!entry) return;
          for (const key in entry) entry[key].destroy();
          delete batchers[uid];
        },
      },
    };
    const stub: Record<string, unknown> = {
      hooks,
      batchers,
      batcherDestroy,
      render:
        render ??
        (({ container }: { container: Container }) => {
          container.enableRenderGroup();
          const { instructionSet } = container.renderGroup;
          instructionSet.renderPipes = renderPipes;
          batchers[instructionSet.uid] ??= { default: { destroy: batcherDestroy } };
        }),
      renderPipes,
      runners: {
        destroy: {
          add: (item: DestroyHook) => void hooks.push(item),
          remove: (item: DestroyHook) => {
            const i = hooks.indexOf(item);
            if (i !== -1) hooks.splice(i, 1);
          },
        },
      },
      destroy: () => {
        for (const hook of hooks) hook.destroy();
        stub.renderPipes = null;
      },
    };
    return stub as unknown as StubRenderer;
  };

  it('retains a renderer passed in options and clears it on destroy', () => {
    const renderer = stubRenderer();
    const src = new ContainerSource({ container: new Container(), width: 8, height: 8, renderer });

    expect(src.renderer).toBe(renderer);

    src.destroy();
    expect(src.renderer).toBeNull();
  });

  it('render() with no retained renderer warns and is a no-op (does not throw)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new ContainerSource({ container: new Container(), width: 8, height: 8 });

    expect(() => src.render()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    src.destroy();
  });

  it('firstRender defaults to true: renders once during construction when a renderer is retained', () => {
    const render = vi.fn<() => void>();
    const renderer = stubRenderer(render);

    const src = new ContainerSource({ container: new Container(), width: 8, height: 8, renderer });

    expect(render).toHaveBeenCalledTimes(1);

    src.destroy();
  });

  it('firstRender: false skips the construction render even with a renderer', () => {
    const render = vi.fn<() => void>();
    const renderer = stubRenderer(render);

    const src = new ContainerSource({ container: new Container(), width: 8, height: 8, renderer, firstRender: false });

    expect(render).not.toHaveBeenCalled();

    src.destroy();
  });

  it('default firstRender without a renderer is a silent no-op (only explicit true warns)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No renderer, no explicit firstRender → the default must not warn (nothing to render with).
    new ContainerSource({ container: new Container(), width: 8, height: 8 });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('explicit firstRender: true without a renderer warns instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      () => new ContainerSource({ container: new Container(), width: 8, height: 8, firstRender: true }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('autoUpdate connects to Ticker.shared with a renderer, and destroy disconnects', () => {
    const base = Ticker.shared.count;
    const src = new ContainerSource({
      container: new Container(),
      width: 8,
      height: 8,
      renderer: stubRenderer(),
      autoUpdate: true,
    });

    expect(src.autoUpdate).toBe(true);
    expect(Ticker.shared.count).toBe(base + 1);

    src.destroy();
    expect(src.autoUpdate).toBe(false);
    expect(Ticker.shared.count).toBe(base);
  });

  it('autoUpdate without a renderer warns and defers connecting until one is set', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = Ticker.shared.count;
    const src = new ContainerSource({ container: new Container(), width: 8, height: 8 });

    src.autoUpdate = true;
    expect(src.autoUpdate).toBe(true);
    expect(Ticker.shared.count).toBe(base); // deferred — no renderer yet
    expect(warnSpy).toHaveBeenCalled();

    src.renderer = stubRenderer();
    expect(Ticker.shared.count).toBe(base + 1);

    warnSpy.mockRestore();
    src.destroy();
    expect(Ticker.shared.count).toBe(base);
  });

  it('toggling autoUpdate off disconnects the ticker', () => {
    const base = Ticker.shared.count;
    const src = new ContainerSource({
      container: new Container(),
      width: 8,
      height: 8,
      renderer: stubRenderer(),
      autoUpdate: true,
    });
    expect(Ticker.shared.count).toBe(base + 1);

    src.autoUpdate = false;
    expect(Ticker.shared.count).toBe(base);

    src.destroy();
  });

  it('clearing the renderer halts an active autoUpdate', () => {
    const base = Ticker.shared.count;
    const src = new ContainerSource({
      container: new Container(),
      width: 8,
      height: 8,
      renderer: stubRenderer(),
      autoUpdate: true,
    });
    expect(Ticker.shared.count).toBe(base + 1);

    src.renderer = null;
    expect(Ticker.shared.count).toBe(base); // autoUpdate still true, but nothing to drive it

    src.destroy();
  });

  it('a retained renderer being destroyed halts autoUpdate, drops the reference, and keeps destroy() safe', () => {
    const base = Ticker.shared.count;
    const renderer = stubRenderer();
    const src = new ContainerSource({
      container: new Container(),
      width: 8,
      height: 8,
      renderer,
      autoUpdate: true,
    });
    expect(Ticker.shared.count).toBe(base + 1);
    // The retention hook is the only thing the source registers with a renderer.
    expect(renderer.hooks.length).toBe(1);

    renderer.destroy();

    expect(src.renderer).toBeNull();
    expect(Ticker.shared.count).toBe(base); // no tick left to render through a dead renderer
    expect(renderer.hooks.length).toBe(1); // the hook body never mutates the runner mid-emit

    // Nothing reaches into the torn-down renderer: the capture root's instruction set still carries the pipes it
    // was built with, so pixi's hook frees the entry regardless of retention.
    expect(() => src.destroy()).not.toThrow();
    expect(renderer.batchers).toEqual({});
  });

  it("destroy() frees the capture root's batcher entry through pixi's destroyInstructionSet hook", () => {
    const renderer = stubRenderer();
    const src = new ContainerSource({ container: new Container(), width: 8, height: 8, renderer });
    expect(Object.keys(renderer.batchers)).toHaveLength(1);

    src.destroy();

    expect(renderer.batcherDestroy).toHaveBeenCalledTimes(1);
    expect(renderer.batchers).toEqual({});
  });

  it('destroy() and renderer swaps unhook from the retained renderer', () => {
    const first = stubRenderer();
    const second = stubRenderer();
    const src = new ContainerSource({ container: new Container(), width: 8, height: 8, renderer: first });
    expect(first.hooks.length).toBe(1);

    src.renderer = second;
    expect(first.hooks.length).toBe(0);
    expect(second.hooks.length).toBe(1);

    src.destroy();
    expect(second.hooks.length).toBe(0);
  });
});

// Against real renderers: pixi's `BatcherPipe.destroyInstructionSet` must drop the capture root's entry (its
// batchers and their GPU buffers) when the source destroys the root.
for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`ContainerSource batcher release (${preference})`, () => {
    it("destroy() removes the capture root's entry from the renderer's batch pipe", async () => {
      const app = await getApp<Renderer>({
        id: `container-source-batchers-${preference}`,
        appOptions: { preference, width: 64, height: 64 },
      });
      try {
        const { _batchersByInstructionSet: registry } = app.renderer.renderPipes.batch as unknown as {
          _batchersByInstructionSet: Record<number, unknown>;
        };
        const before = Object.keys(registry).length;
        const container = new Container();
        container.addChild(new Graphics().rect(0, 0, 16, 16).fill(0xff0000));
        const src = new ContainerSource({ container, width: 16, height: 16, renderer: app.renderer });
        expect(Object.keys(registry)).toHaveLength(before + 1);

        src.destroy();

        expect(Object.keys(registry)).toHaveLength(before);
      } finally {
        app.destroy();
      }
    });
  });
}
