import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';

import { GeometryThumbnailGenerator } from '../GeometryThumbnailGenerator';

describe('GeometryThumbnailGenerator', () => {
  it('renders a static geometry once and returns the cached result by geometry ID', () => {
    const geometry = new CubeGeometry();
    const generator = new GeometryThumbnailGenerator();

    const first = generator.getThumbnail(geometry);
    const second = generator.getThumbnail(geometry);
    const sameId = generator.getThumbnail({ uid: geometry.uid } as Geometry3D);

    expect(first.status).toBe('ready');
    expect(second).toBe(first);
    expect(sameId).toBe(first);
    expect(generator.getThumbnailById(geometry.uid)).toBe(first);
    if (first.status !== 'ready') throw new Error(`Expected a thumbnail, received ${first.reason}`);
    expect(first.canvas.width).toBe(64);
    expect(first.canvas.height).toBe(64);
    const pixels = first.canvas.getContext('2d')!.getImageData(0, 0, 64, 64).data;
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);

    geometry.destroy();
  });

  it('prunes thumbnails that are no longer referenced by snapshots', () => {
    const retained = new CubeGeometry();
    const discarded = new CubeGeometry();
    const generator = new GeometryThumbnailGenerator();

    const retainedThumbnail = generator.getThumbnail(retained);
    generator.getThumbnail(discarded);
    generator.prune(new Set([retained.uid]));

    expect(generator.getThumbnailById(retained.uid)).toBe(retainedThumbnail);
    expect(generator.getThumbnailById(discarded.uid)).toBeUndefined();

    retained.destroy();
    discarded.destroy();
  });

  it('clears cached thumbnails explicitly', () => {
    const geometry = new CubeGeometry();
    const generator = new GeometryThumbnailGenerator({ size: 32 });
    const first = generator.getThumbnail(geometry);

    generator.clear();

    const second = generator.getThumbnail(geometry);
    expect(second).not.toBe(first);
    if (second.status !== 'ready') throw new Error(`Expected a thumbnail, received ${second.reason}`);
    expect(second.canvas.width).toBe(32);
    expect(second.canvas.height).toBe(32);

    geometry.destroy();
  });

  it('reads its canvas size from defaultOptions', () => {
    const defaults = { ...GeometryThumbnailGenerator.defaultOptions };
    const geometry = new CubeGeometry();

    try {
      GeometryThumbnailGenerator.defaultOptions.size = 16;
      const thumbnail = new GeometryThumbnailGenerator({ size: undefined }).getThumbnail(geometry);

      if (thumbnail.status !== 'ready') throw new Error(`Expected a thumbnail, received ${thumbnail.reason}`);
      expect(thumbnail.canvas.width).toBe(16);
    } finally {
      GeometryThumbnailGenerator.defaultOptions = defaults;
      geometry.destroy();
    }
  });

  it('returns and caches an unsupported result for dynamic geometry', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      dynamic: true,
    });
    const generator = new GeometryThumbnailGenerator();

    const first = generator.getThumbnail(geometry);
    const second = generator.getThumbnail(geometry);

    expect(first).toEqual({ status: 'unsupported', geometryId: geometry.uid, reason: 'dynamic' });
    expect(second).toBe(first);

    geometry.destroy();
  });

  it('early-outs for non-triangle topology', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([-1, 0, 0, 1, 0, 0]),
      indices: new Uint16Array([0, 1]),
      topology: 'line-list',
    });
    const generator = new GeometryThumbnailGenerator();

    expect(generator.getThumbnail(geometry)).toEqual({
      status: 'unsupported',
      geometryId: geometry.uid,
      reason: 'unsupported-topology',
    });

    geometry.destroy();
  });
});
