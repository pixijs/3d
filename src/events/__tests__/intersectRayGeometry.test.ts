import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

/** One triangle in the XY plane spanning x, y ∈ [-1, 1], wound to face +Z */
function makeTriangle(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

/** A two-triangle quad in the XY plane from (-1, -1) to (1, 1), with UVs running from (0, 0) to (1, 1) */
function makeQuad(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

describe('intersectRayGeometry', () => {
  test('returns -1 when the ray misses the triangle but passes the AABB', () => {
    const geom = makeTriangle();
    const ray = new Ray(new Vector3(0.95, 0.95, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
  });

  test('AABB pre-reject returns -1 for a ray that misses the bounds entirely, leaving the hit untouched', () => {
    const geom = makeTriangle();
    const ray = new Ray(new Vector3(10, 10, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    expect(intersectRayGeometry(ray, geom, hit)).toBe(-1);
    expect(hit.distance).toBe(-1);
  });

  test('returns the closer of two triangles at different depths', () => {
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

  test('returns the UV interpolated at the hit point, (0.5, 0.5) at the quad centre', () => {
    const geom = makeQuad();
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

  test('quantised positions are a miss, since the picker reads only Float32Array positions and never unquantises', () => {
    /** Padded to four components per vertex, since WebGPU has no three-component snorm16 format */
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
