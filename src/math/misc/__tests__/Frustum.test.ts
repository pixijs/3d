import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Frustum } from '~/math/misc/Frustum';
import { Box } from '~/math/shapes/Box';
import { Plane } from '~/math/shapes/Plane';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

/**
 * Builds an orthographic frustum spanning x in [-1, 1], y in [-1, 1], z in [-100, -0.1] (looking
 * down -Z by convention). With these parameters the planes line up with axis-aligned half-spaces,
 * which makes containment tests easy to reason about.
 */
function buildOrthoFrustum(): Frustum {
  const projection = new Matrix4().makeOrthographic(-1, 1, 1, -1, 0.1, 100);

  return new Frustum().setFromProjectionMatrix(projection);
}

describe('Frustum constructor', () => {
  test('defaults every plane to new Plane(), so +x is inside and -x outside', () => {
    const frustum = new Frustum();
    expect(frustum.containsPoint(new Vector3(1, 0, 0))).toBe(true);
    expect(frustum.containsPoint(new Vector3(-1, 0, 0))).toBe(false);
  });

  test('uses provided planes when supplied', () => {
    const frustum = new Frustum(
      new Plane(new Vector3(1, 0, 0), 1),
      new Plane(new Vector3(-1, 0, 0), 1),
      new Plane(new Vector3(0, 1, 0), 1),
      new Plane(new Vector3(0, -1, 0), 1),
      new Plane(new Vector3(0, 0, 1), 1),
      new Plane(new Vector3(0, 0, -1), 1),
    );

    expect(frustum.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(frustum.containsPoint(new Vector3(0.5, 0.5, 0.5))).toBe(true);
    expect(frustum.containsPoint(new Vector3(2, 0, 0))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, -2, 0))).toBe(false);
  });
});

describe('Frustum.set', () => {
  test('replaces all six planes', () => {
    const frustum = new Frustum();
    frustum.set(
      new Plane(new Vector3(1, 0, 0), 1),
      new Plane(new Vector3(-1, 0, 0), 1),
      new Plane(new Vector3(0, 1, 0), 1),
      new Plane(new Vector3(0, -1, 0), 1),
      new Plane(new Vector3(0, 0, 1), 1),
      new Plane(new Vector3(0, 0, -1), 1),
    );

    expect(frustum.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(frustum.containsPoint(new Vector3(2, 0, 0))).toBe(false);
  });
});

describe('Frustum.clone', () => {
  test('mutating the original does not affect the clone', () => {
    const original = buildOrthoFrustum();
    const clone = original.clone();
    original.set(
      new Plane(new Vector3(1, 0, 0), 1),
      new Plane(new Vector3(-1, 0, 0), 1),
      new Plane(new Vector3(0, 1, 0), 1),
      new Plane(new Vector3(0, -1, 0), 1),
      new Plane(new Vector3(0, 0, 1), 1),
      new Plane(new Vector3(0, 0, -1), 1),
    );
    expect(clone.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(clone.containsPoint(new Vector3(0, 0, 0))).toBe(false);
  });
});

describe('Frustum.copyFrom', () => {
  test('copies planes from another frustum', () => {
    const source = buildOrthoFrustum();
    const target = new Frustum();
    const result = target.copyFrom(source);

    expect(result).toBe(target);
    expect(target.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(target.containsPoint(new Vector3(0, 0, 1))).toBe(false);
  });
});

describe('Frustum.copyTo', () => {
  test('writes this frustum into the target', () => {
    const source = buildOrthoFrustum();
    const target = new Frustum();
    const returned = source.copyTo(target);

    expect(returned).toBe(target);
    expect(target.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(target.containsPoint(new Vector3(0, 0, 1))).toBe(false);
  });
});

describe('Frustum.setFromProjectionMatrix', () => {
  test('produces the expected ortho frustum bounds', () => {
    const frustum = buildOrthoFrustum();

    expect(frustum.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(frustum.containsPoint(new Vector3(0.5, 0.5, -50))).toBe(true);

    expect(frustum.containsPoint(new Vector3(2, 0, -1))).toBe(false);
    expect(frustum.containsPoint(new Vector3(-2, 0, -1))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, 2, -1))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, -2, -1))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, 0, 1))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, 0, -200))).toBe(false);
  });

  test('produces sensible perspective frustum bounds', () => {
    const projection = new Matrix4().makePerspective(Math.PI / 2, 1, 1, 100);
    const frustum = new Frustum().setFromProjectionMatrix(projection);

    const insideTheVolume = new Vector3(0, 0, -10);
    const behindTheCamera = new Vector3(0, 0, 10);
    const pastTheFarPlane = new Vector3(0, 0, -200);

    expect(frustum.containsPoint(insideTheVolume)).toBe(true);
    expect(frustum.containsPoint(behindTheCamera)).toBe(false);
    expect(frustum.containsPoint(pastTheFarPlane)).toBe(false);
  });
});

describe('Frustum.getPlane', () => {
  test('reads the planes back from setFromProjectionMatrix as right, left, bottom, top, far, near', () => {
    const frustum = buildOrthoFrustum();
    const center = new Vector3(0, 0, -50);
    const boundaries = [
      new Vector3(1, 0, -50),
      new Vector3(-1, 0, -50),
      new Vector3(0, -1, -50),
      new Vector3(0, 1, -50),
      new Vector3(0, 0, -100),
      new Vector3(0, 0, -0.1),
    ];

    boundaries.forEach((boundary, index) => {
      const plane = frustum.getPlane(index);

      expect(plane.distanceToPoint(boundary)).toBeCloseTo(0);
      expect(plane.distanceToPoint(center)).toBeGreaterThan(0);
    });
  });

  test('writes into the supplied out plane', () => {
    const frustum = buildOrthoFrustum();
    const out = new Plane();
    const result = frustum.getPlane(0, out);
    expect(result).toBe(out);
  });

  test('allocates a new Plane when none is supplied', () => {
    const frustum = buildOrthoFrustum();
    const a = frustum.getPlane(0);
    const b = frustum.getPlane(0);
    expect(a).not.toBe(b);
    expect(a.equals(b)).toBe(true);
  });
});

describe('Frustum.equals', () => {
  test('returns true when both frusta have the same planes', () => {
    const a = buildOrthoFrustum();
    const b = buildOrthoFrustum();
    expect(a.equals(b)).toBe(true);
  });

  test('returns false when planes differ', () => {
    const a = buildOrthoFrustum();
    const b = new Frustum();
    expect(a.equals(b)).toBe(false);
  });
});

describe('Frustum.toString', () => {
  test('produces a tagged string', () => {
    expect(new Frustum().toString()).toBe('[pixi-3d/math:Frustum]');
  });
});

describe('Frustum.containsPoint', () => {
  test('boundary points are inclusive', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.containsPoint(new Vector3(1, 0, -1))).toBe(true);
  });
});

describe('Frustum.intersectsSphere', () => {
  test('true when sphere is fully inside', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.intersectsSphere(new Sphere(new Vector3(0, 0, -50), 0.5))).toBe(true);
  });

  test('true when sphere straddles a plane', () => {
    const frustum = buildOrthoFrustum();
    const centerOutsideRightPlane = new Vector3(1.4, 0, -1);
    expect(frustum.intersectsSphere(new Sphere(centerOutsideRightPlane, 0.5))).toBe(true);
  });

  test('false when sphere is entirely outside one plane', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.intersectsSphere(new Sphere(new Vector3(5, 0, -1), 0.5))).toBe(false);
  });

  test('false when sphere has negative radius (empty)', () => {
    const frustum = buildOrthoFrustum();
    const sphere = new Sphere(new Vector3(0, 0, -1));
    expect(sphere.radius).toBeLessThan(0);
    expect(frustum.intersectsSphere(sphere)).toBe(false);
  });
});

describe('Frustum.intersectsBox', () => {
  test('true when box is fully inside', () => {
    const frustum = buildOrthoFrustum();
    const box = new Box(new Vector3(-0.5, -0.5, -10), new Vector3(0.5, 0.5, -2));
    expect(frustum.intersectsBox(box)).toBe(true);
  });

  test('true when box straddles a plane', () => {
    const frustum = buildOrthoFrustum();
    const box = new Box(new Vector3(0.5, -0.5, -10), new Vector3(2, 0.5, -2));
    expect(frustum.intersectsBox(box)).toBe(true);
  });

  test('false when box is entirely outside one plane', () => {
    const frustum = buildOrthoFrustum();
    const box = new Box(new Vector3(5, -0.5, -10), new Vector3(6, 0.5, -2));
    expect(frustum.intersectsBox(box)).toBe(false);
  });
});
