import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

// Single triangle in the XY plane, spanning x, y ∈ [-1, 1], normal +Z.
function makeTriangle(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

// Quad (two triangles) in the XY plane from (-1,-1) to (1,1).
function makeQuad(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

describe('intersectRayGeometry', () => {
  test('hits a triangle along +Z ray and returns the distance to the plane', () => {
    const geom = makeTriangle();
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    const t = intersectRayGeometry(ray, geom, hit);

    expect(t).toBeCloseTo(5, 5);
    expect(hit.point.z).toBeCloseTo(0, 5);
    expect(hit.triangleIndex).toBe(0);
  });

  test('returns -1 when the ray misses the triangle but passes the AABB', () => {
    const geom = makeTriangle();
    // Ray passes through bounds3D but outside the triangle (corner cut-off).
    const ray = new Ray(new Vector3(0.95, 0.95, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
  });

  test('AABB pre-reject returns -1 for a ray that misses the bounds entirely', () => {
    const geom = makeTriangle();
    const ray = new Ray(new Vector3(10, 10, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
    // The out-param is left untouched.
    expect(hit.distance).toBe(-1);
  });

  test('returns the closer of two triangles at different depths', () => {
    // Two stacked triangles: front at z=2, back at z=0 — the ray from z=5
    // reaches the front one at t=3.
    const geom = new Geometry3D({
      positions: new Float32Array([-1, -1, 2, 1, -1, 2, 0, 1, 2, -1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
      bounds3D: new Box(new Vector3(-1, -1, 0), new Vector3(1, 1, 2)),
    });
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    const t = intersectRayGeometry(ray, geom, hit);

    expect(t).toBeCloseTo(3, 5);
    expect(hit.triangleIndex).toBe(0);
  });

  test('returns interpolated UV at the hit point', () => {
    const geom = makeQuad();
    // The ray hits the quad's centre, where the corner UVs interpolate to (0.5, 0.5).
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    intersectRayGeometry(ray, geom, hit);

    expect(hit.uv.x).toBeCloseTo(0.5, 5);
    expect(hit.uv.y).toBeCloseTo(0.5, 5);
  });

  test('returns a +Z surface normal for a front-facing XY-plane triangle', () => {
    const geom = makeTriangle();
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    intersectRayGeometry(ray, geom, hit);

    expect(hit.normal.x).toBeCloseTo(0, 5);
    expect(hit.normal.y).toBeCloseTo(0, 5);
    expect(hit.normal.z).toBeCloseTo(1, 5);
  });

  test('hits a non-indexed (soup) triangle list', () => {
    const geom = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      bounds3D: new Box(new Vector3(-1, -1, 0), new Vector3(1, 1, 0)),
    });
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    const t = intersectRayGeometry(ray, geom, hit);

    expect(t).toBeCloseTo(5, 5);
    expect(hit.triangleIndex).toBe(0);
  });

  test('non-triangle-list topology is a miss, whatever the index buffer holds', () => {
    const geom = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      topology: 'line-list',
    });
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
    expect(hit.distance).toBe(-1);
  });

  test('quantised (non-float) positions degrade to -1 rather than producing garbage', () => {
    // int16 positions: the picker never unquantises on the CPU, so it must
    // refuse cleanly instead of reading the bytes as floats. Padded to x4
    // because WebGPU has no 3-component snorm16 format; the picker only checks
    // whether `buffer.data` is a Float32Array, so any non-float array will do.
    const positionsInt16 = new Int16Array([-32767, -32767, 0, 0, 32767, -32767, 0, 0, 0, 32767, 0, 0]);
    const geom = new Geometry3D({
      attributes: {
        aPosition: {
          buffer: { data: positionsInt16 } as never,
          format: 'snorm16x4',
          stride: 8,
          offset: 0,
        },
      },
      bounds3D: new Box(new Vector3(-1, -1, 0), new Vector3(1, 1, 0)),
    });
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
  });
});
