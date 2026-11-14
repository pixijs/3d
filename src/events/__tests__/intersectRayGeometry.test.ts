import { describe, expect, test, vi } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

function makeTriangle(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

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

  test('quantised positions are a miss, since the picker reads only Float32Array positions and never decodes a format', () => {
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

  describe('large meshes', () => {
    const makeKnot = () => new TorusKnotGeometry({ tubularSegments: 128, radialSegments: 32 });

    function rays(count: number): Ray[] {
      let seed = 1;
      const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const out: Ray[] = [];
      for (let i = 0; i < count; i++) {
        const origin = new Vector3(next() * 4, next() * 4, 5);
        const target = new Vector3(next() * 1.5, next() * 1.5, next());
        const direction = new Vector3(target.x - origin.x, target.y - origin.y, target.z - origin.z);
        const length = Math.hypot(direction.x, direction.y, direction.z);
        out.push(new Ray(origin, new Vector3(direction.x / length, direction.y / length, direction.z / length)));
      }
      return out;
    }

    test('a large mesh picked through its hierarchy finds the closest hit that a dynamic copy tested triangle by triangle finds', () => {
      const geom = makeKnot();
      const positions = new Float32Array(geom.attributes.aPosition.buffer.data);
      const indices = new Uint32Array(geom.indexBuffer.data);
      const all = rays(300);
      const expected = all.map((ray) => {
        const hit = createHitResult3D();
        const t = intersectRayGeometry(ray, new Geometry3D({ positions, indices, dynamic: true }), hit);
        return { t, triangle: hit.triangleIndex, nz: hit.normal.z };
      });

      expect(expected.filter((r) => r.t >= 0).length).toBeGreaterThan(100);
      for (let i = 0; i < all.length; i++) {
        const hit = createHitResult3D();
        const t = intersectRayGeometry(all[i], geom, hit);
        expect(t).toBeCloseTo(expected[i].t, 5);
        if (t < 0) continue;
        if (hit.triangleIndex !== expected[i].triangle) continue;
        expect(hit.normal.z).toBeCloseTo(expected[i].nz, 5);
      }
    });

    test('a large mesh shrunk in place after picks, inside its original bounds, picks its new triangles', () => {
      const geom = makeKnot();
      const all = rays(50);
      for (const ray of all) intersectRayGeometry(ray, geom, createHitResult3D());

      const buffer = geom.attributes.aPosition.buffer;
      const positions = buffer.data;
      for (let i = 0; i < positions.length; i++) positions[i] *= 0.5;
      buffer.update();
      const fresh = new Geometry3D({
        positions: new Float32Array(positions),
        indices: new Uint32Array(geom.indexBuffer.data),
        dynamic: true,
      });

      for (const ray of all) {
        expect(intersectRayGeometry(ray, geom, createHitResult3D())).toBeCloseTo(
          intersectRayGeometry(ray, fresh, createHitResult3D()),
          5,
        );
      }
    });

    test('a large dynamic mesh is picked without building a hierarchy', () => {
      const knot = makeKnot();
      const geom = new Geometry3D({
        positions: new Float32Array(knot.attributes.aPosition.buffer.data),
        indices: new Uint32Array(knot.indexBuffer.data),
        dynamic: true,
      });
      const build = vi.spyOn(geom, 'bvh', 'get');

      for (const ray of rays(20)) intersectRayGeometry(ray, geom, createHitResult3D());

      expect(build).not.toHaveBeenCalled();
    });
  });
});
