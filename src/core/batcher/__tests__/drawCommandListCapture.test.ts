import { Buffer, BufferUsage, Geometry, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MAX_BATCH_TEXTURES } from '~/core/batcher/batchConstants';
import { DrawCommandList } from '~/core/batcher/DrawCommandList';
import { Buffer3D } from '~/core/buffers/Buffer3D';
import { Geometry3D } from '~/geometry/Geometry3D';

const VERTEX = BufferUsage.VERTEX | BufferUsage.COPY_DST;

function makeSource(): TextureSource {
  return new TextureSource({ width: 2, height: 2 });
}

function makeGeometry(buffer: Buffer = new Buffer({ data: new Float32Array(9), usage: VERTEX })): Geometry {
  return new Geometry({ attributes: { aPosition: { buffer, format: 'float32x3' } } });
}

/** The list's capture map, reached for its size and membership. */
function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

describe('DrawCommandList captures', () => {
  it('captures a batch texture with one change listener and stamps it on touch', () => {
    const list = new DrawCommandList();
    const source = makeSource();
    const listeners = source.listenerCount('change');

    const bg = list.nextBatchBindGroup([source], 1);
    list.endBuild();

    expect(bg.getResource(0)).toBe(source);
    // Remaining slots are padded so the bind group is always fully populated.
    expect(bg.getResource(MAX_BATCH_TEXTURES - 1)).toBe(Texture.EMPTY.source);
    // One listener from the list, one from the bind group slot that holds the source.
    expect(source.listenerCount('change')).toBe(listeners + 2);
    expect(captures(list).has(source)).toBe(true);

    source._gcLastUsed = 5;
    list.touch(42);
    expect(source._gcLastUsed).toBe(42);

    list.destroy();
    source.destroy();
  });

  it('never captures an engine-owned Buffer3D', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const buffer = new Buffer3D({ data: new Float32Array(9), usage: VERTEX });
    const geometry = makeGeometry(buffer);

    list.captureGeometry(geometry);
    list.endBuild();
    expect(captures(list).size).toBe(0);

    buffer._gcLastUsed = 5;
    list.touch(42);
    expect(buffer._gcLastUsed).toBe(5);

    buffer.unload();
    expect(onCaptureLost).not.toHaveBeenCalled();

    list.destroy();
    geometry.destroy(true);
  });

  it('drops only the recorded GPU layout of the geometries that used a lost buffer', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;

    // A Geometry3D's own unload also vacates its atlas range and unloads every buffer it owns —
    // far more than one lost buffer calls for.
    const geometry = new Geometry3D({ positions: new Float32Array(9) });
    const fullUnload = vi.spyOn(geometry, 'unload');
    const layoutDropped = vi.fn<() => void>();
    geometry.on('unload', layoutDropped);

    list.captureGeometry(geometry);
    list.endBuild();
    geometry.buffers[0].unload();

    expect(onCaptureLost).toHaveBeenCalledTimes(1);
    expect(layoutDropped).toHaveBeenCalledTimes(1);
    expect(fullUnload).not.toHaveBeenCalled();

    list.destroy();
    geometry.destroy(true);
  });

  it('sweeps the captures a rebuild did not record again', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const kept = makeGeometry();
    const dropped = makeGeometry();

    list.captureGeometry(kept);
    list.captureGeometry(dropped);
    list.endBuild();
    expect(captures(list).size).toBe(2);

    list.clear();
    list.captureGeometry(kept);
    list.endBuild();
    expect(captures(list).size).toBe(1);

    dropped.buffers[0].unload();
    expect(onCaptureLost).not.toHaveBeenCalled();
    kept.buffers[0].unload();
    expect(onCaptureLost).toHaveBeenCalledTimes(1);

    list.destroy();
    kept.destroy(true);
    dropped.destroy(true);
  });

  it('keeps the captures through a clear until the rebuild ends', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const geometry = makeGeometry();

    list.captureGeometry(geometry);
    list.endBuild();

    // A cleared list that never rebuilt (a culled pass) still bakes the resource, so it still reports.
    list.clear();
    geometry.buffers[0].unload();
    expect(onCaptureLost).toHaveBeenCalledTimes(1);

    list.destroy();
    geometry.destroy(true);
  });

  it('re-recording the same resources adds no listeners and no captures', () => {
    const list = new DrawCommandList();
    const source = makeSource();
    const geometry = makeGeometry();
    const buffer = geometry.buffers[0];

    list.nextBatchBindGroup([source], 1);
    list.captureGeometry(geometry);
    list.endBuild();
    const sourceListeners = source.listenerCount('change');
    const bufferListeners = buffer.listenerCount('change');

    for (let i = 0; i < 3; i++) {
      list.clear();
      list.nextBatchBindGroup([source], 1);
      list.captureGeometry(geometry);
      list.endBuild();
    }

    expect(source.listenerCount('change')).toBe(sourceListeners);
    expect(buffer.listenerCount('change')).toBe(bufferListeners);
    expect(captures(list).size).toBe(2);

    list.destroy();
    source.destroy();
    geometry.destroy(true);
  });

  it('pools bind groups by flush order and empties the ones a smaller rebuild leaves unused', () => {
    const list = new DrawCommandList();
    const a = makeSource();
    const b = makeSource();

    const first = list.nextBatchBindGroup([a], 1);
    const second = list.nextBatchBindGroup([b], 1);
    list.endBuild();
    expect(second).not.toBe(first);

    list.clear();
    expect(list.nextBatchBindGroup([a], 1)).toBe(first);
    list.endBuild();

    // The unused second group let go of `b`, so destroying `b` is not a bound-resource destroy.
    expect(second.getResource(0)).toBe(Texture.EMPTY.source);
    expect(captures(list).has(b)).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      b.destroy();
      expect(warn.mock.calls.filter((call) => String(call[1]).includes('BindGroup'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }

    list.destroy();
    a.destroy();
  });

  it('releases every capture and empties every pooled group when a build is not coming back', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const source = makeSource();
    const geometry = makeGeometry();
    const sourceListeners = source.listenerCount('change');

    list.next();
    const bg = list.nextBatchBindGroup([source], 1);
    list.captureGeometry(geometry);
    list.endBuild();
    expect(list.count).toBe(1);

    list.releaseCaptures();

    expect(list.count).toBe(0);
    expect(captures(list).size).toBe(0);
    expect(bg.getResource(0)).toBe(Texture.EMPTY.source);
    expect(source.listenerCount('change')).toBe(sourceListeners);
    source.unload();
    geometry.buffers[0].unload();
    expect(onCaptureLost).not.toHaveBeenCalled();

    list.destroy();
    source.destroy();
    geometry.destroy(true);
  });
});
