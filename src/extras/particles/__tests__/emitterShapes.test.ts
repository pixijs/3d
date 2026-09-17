import { DEG_TO_RAD } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { BoxShape } from '~/extras/particles/emitterShapes/BoxShape';
import { ConeShape } from '~/extras/particles/emitterShapes/ConeShape';
import { SphereShape } from '~/extras/particles/emitterShapes/SphereShape';
import { seededRandom } from '~/math/utils/seededRandom';
import { Vector3 } from '~/math/vector/Vector3';

describe('emitter shape options', () => {
  it('fills omitted and explicitly undefined fields from defaultOptions', () => {
    const box = new BoxShape({ width: 2, height: undefined });
    const cone = new ConeShape({ radius: undefined });
    const sphere = new SphereShape({ shell: true });

    expect([box.width, box.height, box.depth]).toEqual([2, 1, 1]);
    expect([cone.angle, cone.radius]).toEqual([25, 0]);
    expect([sphere.radius, sphere.shell]).toEqual([1, true]);
  });

  it('picks up a process-wide change to defaultOptions', () => {
    const previous = SphereShape.defaultOptions.radius;

    SphereShape.defaultOptions.radius = 3;

    try {
      expect(new SphereShape().radius).toBe(3);
      expect(new SphereShape({ radius: 0.5 }).radius).toBe(0.5);
    } finally {
      SphereShape.defaultOptions.radius = previous;
    }
  });

  it('samples directions within the half-angle, given in degrees', () => {
    const cone = new ConeShape({ angle: 12 });
    const pos = new Vector3();
    const dir = new Vector3();
    const rng = seededRandom('cone');
    const limit = 12 * DEG_TO_RAD;
    let widest = 0;

    for (let i = 0; i < 500; i++) {
      cone.sample(rng, pos, dir);
      widest = Math.max(widest, Math.acos(dir.y));
    }

    expect(widest).toBeLessThanOrEqual(limit + 1e-6);
    expect(widest).toBeGreaterThan(limit * 0.9);
  });
});
