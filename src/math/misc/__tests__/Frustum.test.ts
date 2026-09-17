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
  test('defaults to six default Plane instances when called with no args', () => {
    const frustum = new Frustum();
    // The class only exposes planes via methods that consume them. Test via containsPoint
    // with the default plane (normal=(1,0,0), constant=0): a point at +x should be inside,
    // -x outside.
    expect(frustum.containsPoint(new Vector3(1, 0, 0))).toBe(true);
    expect(frustum.containsPoint(new Vector3(-1, 0, 0))).toBe(false);
  });

  test('uses provided planes when supplied', () => {
    // Six planes that bound a unit cube around the origin: each plane has an inward-facing
    // unit normal and constant = 1, so distanceToPoint = n.x*x + n.y*y + n.z*z + 1.
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

  test('returns this for chaining', () => {
    const frustum = new Frustum();
    const result = frustum.set(new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane());
    expect(result).toBe(frustum);
  });
});

describe('Frustum.clone', () => {
  test('returns a new Frustum with equivalent containment behavior', () => {
    const original = buildOrthoFrustum();
    const clone = original.clone();
    expect(clone).not.toBe(original);
    expect(clone).toBeInstanceOf(Frustum);
    expect(clone.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(clone.containsPoint(new Vector3(0, 0, 50))).toBe(false);
  });

  test('mutating the original does not affect the clone', () => {
    const original = buildOrthoFrustum();
    const clone = original.clone();
    // Replace original's planes with a unit-cube frustum.
    original.set(
      new Plane(new Vector3(1, 0, 0), 1),
      new Plane(new Vector3(-1, 0, 0), 1),
      new Plane(new Vector3(0, 1, 0), 1),
      new Plane(new Vector3(0, -1, 0), 1),
      new Plane(new Vector3(0, 0, 1), 1),
      new Plane(new Vector3(0, 0, -1), 1),
    );
    // Clone still has the original ortho frustum (z in [-100, -0.1]).
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

    // Points inside the volume.
    expect(frustum.containsPoint(new Vector3(0, 0, -1))).toBe(true);
    expect(frustum.containsPoint(new Vector3(0.5, 0.5, -50))).toBe(true);

    // Points outside on each axis.
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

    // Origin (camera position) is inside the near-plane half-space but not strictly inside
    // the frustum (it sits on the apex). Use a point clearly inside the volume.
    expect(frustum.containsPoint(new Vector3(0, 0, -10))).toBe(true);

    // Far behind the camera.
    expect(frustum.containsPoint(new Vector3(0, 0, 10))).toBe(false);

    // Past the far plane.
    expect(frustum.containsPoint(new Vector3(0, 0, -200))).toBe(false);
  });

  test('returns this for chaining', () => {
    const frustum = new Frustum();
    const projection = new Matrix4().makeOrthographic(-1, 1, 1, -1, 0.1, 100);
    expect(frustum.setFromProjectionMatrix(projection)).toBe(frustum);
  });
});

describe('Frustum.getPlane', () => {
  test('reads each plane back from setFromProjectionMatrix', () => {
    const frustum = buildOrthoFrustum();

    // Ortho frustum spans x in [-1, 1], y in [-1, 1], z in [-100, -0.1]. Plane order
    // is right, left, top, bottom, far, near. Each plane faces inward, so its
    // distanceToPoint at the boundary should be 0.
    expect(frustum.getPlane(0).distanceToPoint(new Vector3(1, 0, -1))).toBeCloseTo(0);
    expect(frustum.getPlane(1).distanceToPoint(new Vector3(-1, 0, -1))).toBeCloseTo(0);
    expect(frustum.getPlane(4).distanceToPoint(new Vector3(0, 0, -100))).toBeCloseTo(0);
    expect(frustum.getPlane(5).distanceToPoint(new Vector3(0, 0, -0.1))).toBeCloseTo(0);
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

  test('returns true after copyFrom', () => {
    const a = buildOrthoFrustum();
    const b = new Frustum().copyFrom(a);
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
  test('returns true for points inside the ortho frustum', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.containsPoint(new Vector3(0, 0, -50))).toBe(true);
  });

  test('returns false for points outside the ortho frustum', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.containsPoint(new Vector3(0, 0, 0))).toBe(false);
  });

  test('boundary points are inclusive', () => {
    const frustum = buildOrthoFrustum();
    // Right boundary: x = 1 should yield distance 0 against the right plane (inclusive).
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
    // Centre is just outside the right plane (x=1.4) but radius = 0.5 reaches into the volume.
    expect(frustum.intersectsSphere(new Sphere(new Vector3(1.4, 0, -1), 0.5))).toBe(true);
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

  test('false when sphere is past the far plane', () => {
    const frustum = buildOrthoFrustum();
    expect(frustum.intersectsSphere(new Sphere(new Vector3(0, 0, -200), 1))).toBe(false);
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
    // Box extends past x = 1.
    const box = new Box(new Vector3(0.5, -0.5, -10), new Vector3(2, 0.5, -2));
    expect(frustum.intersectsBox(box)).toBe(true);
  });

  test('false when box is entirely outside one plane', () => {
    const frustum = buildOrthoFrustum();
    // Far past the right plane.
    const box = new Box(new Vector3(5, -0.5, -10), new Vector3(6, 0.5, -2));
    expect(frustum.intersectsBox(box)).toBe(false);
  });

  test('false when box is past the far plane', () => {
    const frustum = buildOrthoFrustum();
    const box = new Box(new Vector3(-0.5, -0.5, -300), new Vector3(0.5, 0.5, -200));
    expect(frustum.intersectsBox(box)).toBe(false);
  });

  test('false when box is between camera and near plane', () => {
    const frustum = buildOrthoFrustum();
    const box = new Box(new Vector3(-0.5, -0.5, 1), new Vector3(0.5, 0.5, 5));
    expect(frustum.intersectsBox(box)).toBe(false);
  });
});
