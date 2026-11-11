import { Buffer, BufferUsage, Geometry, Texture, TextureSource, TextureStyle } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { DrawCommandList } from '~/core/batcher/DrawCommandList';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';

const VERTEX = BufferUsage.VERTEX | BufferUsage.COPY_DST;

function makeSource(): TextureSource {
  return new TextureSource({ width: 2, height: 2 });
}

function makeGeometry(buffer: Buffer = new Buffer({ data: new Float32Array(9), usage: VERTEX })): Geometry {
  return new Geometry({ attributes: { aPosition: { buffer, format: 'float32x3' } } });
}

function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

function materialOf(...textures: Texture[]): BaseMaterial3D {
  return { _textures: textures, _refreshTextureBindings: () => {} } as unknown as BaseMaterial3D;
}

describe('DrawCommandList captures', () => {
  it('captures a material’s own textures, skipping the shared defaults, and sweeps them like any capture', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const source = makeSource();
    const listeners = source.listenerCount('change');
    const styleListeners = source.listenerCount('styleChange');
    const material = materialOf(new Texture({ source }), Texture.WHITE, Texture.EMPTY);

    list.captureMaterialTextures(material);
    list.endBuild();

    expect(captures(list).has(source)).toBe(true);
    expect(source.listenerCount('styleChange'), 'and watches its style through it').toBe(styleListeners + 1);
    expect(captures(list).size, 'Texture.WHITE and Texture.EMPTY are never captured').toBe(1);
    expect(source.listenerCount('change')).toBe(listeners + 1);

    source._gcLastUsed = 5;
    list.touch(42);
    expect(source._gcLastUsed).toBe(42);

    list.clear();
    list.captureMaterialTextures(material);
    list.endBuild();
    expect(source.listenerCount('change'), 'recording it again adds no listener').toBe(listeners + 1);

    source.unload();
    expect(onCaptureLost).toHaveBeenCalledTimes(1);

    list.clear();
    list.endBuild();
    expect(captures(list).size, 'a build that no longer samples it sweeps the capture').toBe(0);
    expect(source.listenerCount('change')).toBe(listeners);
    expect(source.listenerCount('styleChange')).toBe(styleListeners);

    list.destroy();
    source.destroy();
  });

  it('keeps watching a style shared by two sources after one of them is swept', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const a = makeSource();
    const b = makeSource();
    b.style = a.style;

    list.captureMaterialTextures(materialOf(new Texture({ source: a })));
    list.captureMaterialTextures(materialOf(new Texture({ source: b })));
    list.endBuild();

    list.clear();
    list.captureMaterialTextures(materialOf(new Texture({ source: b })));
    list.endBuild();
    onCaptureLost.mockClear();

    a.style.update();
    expect(onCaptureLost, 'b still hears its style').toHaveBeenCalled();

    list.destroy();
    a.destroy();
    b.destroy();
  });

  it('keeps the captures through a clear until the rebuild ends', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const geometry = makeGeometry();

    list.captureGeometry(geometry);
    list.endBuild();

    list.clear();
    geometry.buffers[0].unload();
    expect(
      onCaptureLost,
      'a cleared list that never rebuilt, like a culled pass, still holds the buffer',
    ).toHaveBeenCalledTimes(1);

    list.destroy();
    geometry.destroy(true);
  });

  it('reports a captured texture whose style changes, and stops once the capture is swept or released', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const source = makeSource();
    const material = materialOf(new Texture({ source }));
    const styleListeners = source.listenerCount('styleChange');

    list.captureMaterialTextures(material);
    list.endBuild();

    source.style.scaleMode = 'nearest';
    source.style.update();
    expect(onCaptureLost, 'a WebGPU bundle replays the sampler it recorded').toHaveBeenCalledTimes(1);

    source.style = new TextureStyle({ addressMode: 'repeat' });
    expect(onCaptureLost, 'a new style object is reported too').toHaveBeenCalledTimes(2);

    list.clear();
    list.endBuild();
    source.style.update();
    expect(onCaptureLost, 'a rebuild that no longer samples it stops listening').toHaveBeenCalledTimes(2);

    list.captureMaterialTextures(material);
    list.endBuild();
    list.releaseCaptures();
    source.style.update();
    expect(onCaptureLost, 'a released build stops listening').toHaveBeenCalledTimes(2);

    list.captureMaterialTextures(material);
    list.endBuild();
    list.destroy();
    source.style.update();
    expect(onCaptureLost, 'a destroyed list stops listening').toHaveBeenCalledTimes(2);
    expect(source.listenerCount('styleChange')).toBe(styleListeners);

    source.destroy();
  });

  it('captures a geometry another list ticked, and one recorded again after a release', () => {
    const first = new DrawCommandList();
    const second = new DrawCommandList();
    const geometry = makeGeometry();
    const buffer = geometry.buffers[0];

    first.captureGeometry(geometry);
    second.captureGeometry(geometry);
    expect(captures(first).has(buffer)).toBe(true);
    expect(captures(second).has(buffer), 'another list’s tick never matches this one’s build').toBe(true);

    second.releaseCaptures();
    second.captureGeometry(geometry);
    expect(captures(second).has(buffer), 'a release takes a fresh tick, so the next record captures').toBe(true);

    first.destroy();
    second.destroy();
    geometry.destroy(true);
  });

  it('releases every capture when a build is not coming back', () => {
    const list = new DrawCommandList();
    const onCaptureLost = vi.fn<() => void>();
    list.onCaptureLost = onCaptureLost;
    const source = makeSource();
    const geometry = makeGeometry();
    const sourceListeners = source.listenerCount('change');

    list.next();
    list.captureMaterialTextures(materialOf(new Texture({ source })));
    list.captureGeometry(geometry);
    list.endBuild();
    expect(list.count).toBe(1);

    list.releaseCaptures();

    expect(list.count).toBe(0);
    expect(captures(list).size).toBe(0);
    expect(source.listenerCount('change')).toBe(sourceListeners);
    source.unload();
    geometry.buffers[0].unload();
    expect(onCaptureLost).not.toHaveBeenCalled();

    list.destroy();
    source.destroy();
    geometry.destroy(true);
  });
});
