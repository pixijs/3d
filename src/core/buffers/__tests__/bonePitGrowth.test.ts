import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { BonePit } from '~/core/buffers/BonePit';
import { dataTextureSize } from '~/core/buffers/dataTextureLayout';
import { Skeleton } from '~/scene/Skeleton';

/** A flat skeleton with `jointCount` joints, every one a root */
function skeleton(jointCount: number): Skeleton {
  const parent = new Int16Array(jointCount).fill(-1);
  const joints = new Int16Array(jointCount);
  for (let i = 0; i < jointCount; i++) joints[i] = i;

  return new Skeleton({ parent, joints, inverseBindMatrices: new Float32Array(jointCount * 16) });
}

describe('BonePit growth', () => {
  it('keeps the array covering whole data-texture rows once it grows past one row', () => {
    const pit = new BonePit();

    try {
      for (let bones = 0; bones <= 1024; bones += 64) pit.add(skeleton(64));

      const { width, height } = dataTextureSize(pit.data.length);

      expect(pit.data.length).toBe(width * height * 4);
    } finally {
      pit.destroy();
    }
  });

  it('uploads the WebGL bone texture without a GL error when growth resizes it past one row', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'bone-pit-growth-upload',
      appOptions: { preference: 'webgl', width: 64, height: 64 },
    });
    const { renderer } = app;
    const { gl } = renderer;
    const pit = new BonePit();

    try {
      renderer.texture.bind(pit.texture);
      expect(gl.getError()).toBe(gl.NO_ERROR);

      for (let bones = 0; bones <= 1024; bones += 64) pit.add(skeleton(64));
      pit.update();
      renderer.texture.bind(pit.texture);

      expect(gl.getError()).toBe(gl.NO_ERROR);
    } finally {
      pit.destroy();
      app.destroy(true);
    }
  });
});
