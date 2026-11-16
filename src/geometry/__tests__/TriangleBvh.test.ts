import { describe, expect, it } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { TriangleBvh } from '~/geometry/TriangleBvh';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { seededRandom } from '~/math/utils/seededRandom';
import { Vector3 } from '~/math/vector/Vector3';

const makeGrid = () => new PlaneGeometry({ width: 32, height: 32, widthSegments: 32, heightSegments: 32 });
const down = (x: number, y: number) => new Ray(new Vector3(x, y, 5), new Vector3(0, 0, -1));
const stacked = new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 1, 4, 0, 1, 0, 4, 1]);
const stackedIndices = new Uint16Array([0, 1, 2, 3, 4, 5]);

function signedRandom(seed: string): () => number {
  const random = seededRandom(seed);
  return () => random() * 2 - 1;
}

const vertex = (positions: Float32Array, index: number) => new Vector3().fromArray(positions, index * 3);

function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().subtract(a);
  const t = Math.min(1, Math.max(0, p.clone().subtract(a).dot(ab) / ab.dot(ab)));
  return p.distanceTo(ab.multiplyScalar(t).add(a));
}

function triangleDistance(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const normal = b.clone().subtract(a).cross(c.clone().subtract(a));
  const height = p.clone().subtract(a).dot(normal) / normal.dot(normal);
  const projected = normal.clone().multiplyScalar(-height).add(p);
  const inside = [
    [a, b],
    [b, c],
    [c, a],
  ].every(([from, to]) => to.clone().subtract(from).cross(projected.clone().subtract(from)).dot(normal) >= 0);
  if (inside) return Math.abs(height) * Math.sqrt(normal.dot(normal));
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

function bruteClosestDistance(positions: Float32Array, indices: Uint16Array | Uint32Array, p: Vector3): number {
  let best = Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertex(positions, indices[i]);
    best = Math.min(best, triangleDistance(p, a, vertex(positions, indices[i + 1]), vertex(positions, indices[i + 2])));
  }
  return best;
}

describe('TriangleBvh', () => {
  it('raycast returns the distance to the nearest triangle, with its number and vertex weights', () => {
    const bvh = new TriangleBvh(stacked, stackedIndices);

    expect(bvh.raycast(down(1, 2))).toBe(4);
    expect(bvh.triangle).toBe(1);
    expect(bvh.u).toBeCloseTo(0.25, 6);
    expect(bvh.v).toBeCloseTo(0.5, 6);
  });

  it('a hit at maxDistance or farther is ignored', () => {
    const bvh = new TriangleBvh(stacked, stackedIndices);

    expect(bvh.raycast(down(1, 2), 4)).toBe(-1);
    expect(bvh.raycast(down(1, 2), 4.5)).toBe(4);
  });

  it('a miss returns -1 and sets triangle to -1', () => {
    const bvh = new TriangleBvh(stacked, stackedIndices);
    bvh.raycast(down(1, 2));

    expect(bvh.raycast(down(10, 10))).toBe(-1);
    expect(bvh.triangle).toBe(-1);
  });

  it('back faces hit', () => {
    const bvh = new TriangleBvh(stacked, stackedIndices);

    expect(bvh.raycast(new Ray(new Vector3(1, 2, -5), new Vector3(0, 0, 1)))).toBe(5);
    expect(bvh.triangle).toBe(0);
  });

  it('without indices, every three vertices make a triangle', () => {
    const bvh = new TriangleBvh(stacked, null);

    expect(bvh.raycast(down(1, 2))).toBe(4);
    expect(bvh.triangle).toBe(1);
    expect(bvh.u).toBeCloseTo(0.25, 6);
    expect(bvh.v).toBeCloseTo(0.5, 6);
  });

  it('a ray lying in the plane of a box face, as along a grid line of a flat grid, still hits', () => {
    expect(makeGrid().bvh!.raycast(down(4, 0.5))).toBe(5);
  });

  it('a ray aimed at a vertex of a flat grid matches testing every triangle', () => {
    const plane = makeGrid();
    const copy = new Geometry3D({
      positions: new Float32Array(plane.positions),
      indices: new Uint16Array(plane.indices),
      dynamic: true,
    });
    const bvh = plane.bvh!;
    const origin = new Vector3(3, 2, 20);
    const hit = createHitResult3D();
    const missed: string[] = [];
    let loopHits = 0;

    for (let vx = -15; vx <= 15; vx++) {
      for (let vy = -15; vy <= 15; vy++) {
        const x = vx - origin.x;
        const y = vy - origin.y;
        const z = -origin.z;
        const length = Math.sqrt(x * x + y * y + z * z);
        const ray = new Ray(origin, new Vector3(x / length, y / length, z / length));
        const expected = intersectRayGeometry(ray, copy, hit);
        const t = bvh.raycast(ray);
        if (expected >= 0) loopHits++;
        if (Math.abs(t - expected) > 1e-9) missed.push(`vertex (${vx}, ${vy}, 0): ${t}, expected ${expected}`);
      }
    }

    expect(loopHits).toBeGreaterThan(900);
    expect(missed).toEqual([]);
  });

  it('a hierarchy with no triangles is a miss', () => {
    const bvh = new TriangleBvh(new Float32Array(0), null);

    expect(bvh.raycast(down(1, 2))).toBe(-1);
    expect(bvh.triangle).toBe(-1);
  });

  it('a triangle with a NaN vertex never hits, and the triangle behind it does', () => {
    const positions = new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 1, NaN, NaN, NaN, 0, 4, 1]);
    const bvh = new TriangleBvh(positions, new Uint16Array([0, 1, 2, 3, 4, 5]));

    expect(bvh.raycast(down(1, 2))).toBe(5);
    expect(bvh.triangle).toBe(0);
  });

  describe('closestPointToPoint', () => {
    it.each(
      [
        { where: 'above a face', point: [1, 2, 5], closest: [1, 2, 1], distance: 4, triangle: 1, u: 0.25, v: 0.5 },
        {
          where: 'below the lower face',
          point: [1, 2, -3],
          closest: [1, 2, 0],
          distance: 3,
          triangle: 0,
          u: 0.25,
          v: 0.5,
        },
        { where: 'beside a short edge', point: [2, -1, 1], closest: [2, 0, 1], distance: 1, triangle: 1, u: 0.5, v: 0 },
        {
          where: 'past the long edge',
          point: [3, 3, 1],
          closest: [2, 2, 1],
          distance: Math.SQRT2,
          triangle: 1,
          u: 0.5,
          v: 0.5,
        },
        {
          where: 'past a vertex',
          point: [-1, -1, 1],
          closest: [0, 0, 1],
          distance: Math.SQRT2,
          triangle: 1,
          u: 0,
          v: 0,
        },
      ].flatMap((row) => [
        { ...row, layout: 'indexed', indices: stackedIndices },
        { ...row, layout: 'unindexed', indices: null },
      ]),
    )(
      'finds the nearest point $where, with its triangle and vertex weights ($layout)',
      ({ point, closest, distance, triangle, u, v, indices }) => {
        const bvh = new TriangleBvh(stacked, indices);
        const out = new Vector3();

        expect(bvh.closestPointToPoint(new Vector3(point[0], point[1], point[2]), out)).toBeCloseTo(distance, 6);
        expect([out.x, out.y, out.z]).toEqual(closest.map((c) => expect.closeTo(c, 6)));
        expect(bvh.triangle).toBe(triangle);
        expect(bvh.u).toBeCloseTo(u, 6);
        expect(bvh.v).toBeCloseTo(v, 6);
      },
    );

    it('finds the nearest point on a triangle whose first two vertices coincide', () => {
      const bvh = new TriangleBvh(new Float32Array([0, 0, 0, 0, 0, 0, 2, 0, 0]), null);
      const out = new Vector3();

      expect(bvh.closestPointToPoint(new Vector3(1, 1, 0), out)).toBe(1);
      expect([out.x, out.y, out.z]).toEqual([1, 0, 0]);
      expect(bvh.intersectsSphere(new Sphere(new Vector3(1, 1, 0), 1.01))).toBe(true);
    });

    it('ignores triangles farther than maxDistance and counts one exactly at it', () => {
      const bvh = new TriangleBvh(stacked, stackedIndices);
      const point = new Vector3(1, 2, 5);

      expect(bvh.closestPointToPoint(point, new Vector3(), 3.9)).toBe(-1);
      expect(bvh.closestPointToPoint(point, new Vector3(), 4)).toBe(4);
    });

    it('a miss returns -1, sets triangle to -1 and leaves out as it was', () => {
      const bvh = new TriangleBvh(stacked, stackedIndices);
      const out = new Vector3();
      bvh.closestPointToPoint(new Vector3(1, 2, 5), out);
      out.set(7, 7, 7);

      expect(bvh.closestPointToPoint(new Vector3(1, 2, 50), out, 1)).toBe(-1);
      expect(bvh.triangle).toBe(-1);
      expect([out.x, out.y, out.z]).toEqual([7, 7, 7]);
    });

    it('a negative maxDistance finds nothing, so an empty sphere touches nothing', () => {
      const bvh = new TriangleBvh(stacked, stackedIndices);

      expect(bvh.closestPointToPoint(new Vector3(1, 2, 1.5), new Vector3(), -1)).toBe(-1);
      expect(bvh.intersectsSphere(new Sphere(new Vector3(1, 2, 1.5), -1))).toBe(false);
    });

    it('on a large mesh, matches the distance to the nearest of every triangle', () => {
      const knot = new TorusKnotGeometry({ tubularSegments: 128, radialSegments: 16 });
      const positions = knot.positions as Float32Array;
      const bvh = knot.bvh!;
      const random = signedRandom('closest points');
      const out = new Vector3();
      const wrong: string[] = [];

      for (let i = 0; i < 200; i++) {
        const point = new Vector3(random() * 2.5, random() * 2.5, random() * 2.5);
        const expected = bruteClosestDistance(positions, knot.indices, point);
        const distance = bvh.closestPointToPoint(point, out);
        if (!(Math.abs(distance - expected) <= 1e-5) || !(Math.abs(out.distanceTo(point) - expected) <= 1e-5)) {
          wrong.push(`(${point.x}, ${point.y}, ${point.z}): ${distance}, expected ${expected}`);
        }
      }

      expect(knot.indices.length / 3).toBeGreaterThan(2000);
      expect(wrong).toEqual([]);
    });
  });

  describe('intersectsSphere', () => {
    it('is true for a sphere that touches a triangle and false for one just clear of it', () => {
      const bvh = new TriangleBvh(stacked, stackedIndices);

      expect(bvh.intersectsSphere(new Sphere(new Vector3(1, 2, 5), 4))).toBe(true);
      expect(bvh.intersectsSphere(new Sphere(new Vector3(1, 2, 5), 3.99))).toBe(false);
    });

    it("is true across a closed mesh's surface and false wholly inside or outside it", () => {
      const ball = new SphereGeometry({ radius: 1 }).bvh!;

      expect(ball.intersectsSphere(new Sphere(new Vector3(0.98, 0, 0), 0.05))).toBe(true);
      expect(ball.intersectsSphere(new Sphere(new Vector3(0, 0, 0), 0.5))).toBe(false);
      expect(ball.intersectsSphere(new Sphere(new Vector3(3, 0, 0), 0.5))).toBe(false);
    });

    it('on a large mesh, agrees with the distance to the nearest of every triangle', () => {
      const knot = new TorusKnotGeometry({ tubularSegments: 128, radialSegments: 16 });
      const positions = knot.positions as Float32Array;
      const bvh = knot.bvh!;
      const random = signedRandom('spheres');
      const wrong: string[] = [];

      for (let i = 0; i < 100; i++) {
        const center = new Vector3(random() * 2.5, random() * 2.5, random() * 2.5);
        const nearest = bruteClosestDistance(positions, knot.indices, center);
        const cases: [string, number, boolean][] = [
          ['just clear', nearest - 1e-5, false],
          ['just reaching', nearest + 1e-5, true],
          ['overlapping', nearest + 0.5, true],
        ];
        for (const [name, radius, expected] of cases) {
          if (bvh.intersectsSphere(new Sphere(center, radius)) !== expected) wrong.push(`${name} at sphere ${i}`);
        }
      }

      expect(wrong).toEqual([]);
    });
  });

  describe('update', () => {
    it('refits a mesh deformed in place, so rays and closest points match a fresh build and every triangle', () => {
      const plane = new PlaneGeometry({ width: 8, height: 8, widthSegments: 64, heightSegments: 64 });
      const positions = plane.positions as Float32Array;
      const indices = plane.indices;
      const bvh = new TriangleBvh(positions, indices);
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 2] = Math.sin(positions[i] * 1.3) * Math.cos(positions[i + 1] * 0.9) * 0.8;
      }
      bvh.update();
      const fresh = new TriangleBvh(positions, indices);
      const copy = new Geometry3D({
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        dynamic: true,
      });
      const random = signedRandom('refit');
      const hit = createHitResult3D();
      const out = new Vector3();
      const freshOut = new Vector3();
      const wrong: string[] = [];
      let hits = 0;

      for (let i = 0; i < 300; i++) {
        const origin = new Vector3(random() * 4, random() * 4, 3);
        const x = random() * 4 - origin.x;
        const y = random() * 4 - origin.y;
        const z = random() * 0.8 - origin.z;
        const length = Math.sqrt(x * x + y * y + z * z);
        const ray = new Ray(origin, new Vector3(x / length, y / length, z / length));
        const expected = intersectRayGeometry(ray, copy, hit);
        const t = bvh.raycast(ray);
        if (expected >= 0) hits++;
        if (!(Math.abs(t - expected) <= 1e-9) || !(Math.abs(t - fresh.raycast(ray)) <= 1e-9)) {
          wrong.push(`ray ${i}: ${t}, expected ${expected}`);
        }
      }
      for (let i = 0; i < 100; i++) {
        const point = new Vector3(random() * 5, random() * 5, random() * 2);
        const distance = bvh.closestPointToPoint(point, out);
        const expected = fresh.closestPointToPoint(point, freshOut);
        if (!(Math.abs(distance - expected) <= 1e-9)) wrong.push(`point ${i}: ${distance}, expected ${expected}`);
      }

      expect(hits).toBeGreaterThan(200);
      expect(wrong).toEqual([]);
    });

    it('a refit that turns a vertex NaN leaves its triangle unhit and the others hit', () => {
      const positions = new Float32Array(stacked);
      const bvh = new TriangleBvh(positions, stackedIndices);

      positions.fill(NaN, 12, 15);
      bvh.update();

      expect(bvh.raycast(down(1, 2))).toBe(5);
      expect(bvh.triangle).toBe(0);
      expect(bvh.closestPointToPoint(new Vector3(1, 2, 5), new Vector3())).toBe(5);
      expect(bvh.triangle).toBe(0);
    });
  });

  describe('traverse', () => {
    const makeKnot = () => new TorusKnotGeometry({ tubularSegments: 128, radialSegments: 32 });
    const near = new Box(new Vector3(1.3, -0.1, -0.5), new Vector3(1.5, 0.1, 0.5));
    const entersNear = (box: Box) => box.intersectsBox(near);

    it('visits every triangle whose own box meets the box being searched', () => {
      const knot = makeKnot();
      const positions = knot.positions as Float32Array;
      const indices = knot.indices;
      const query = new Box(new Vector3(0.2, -0.3, -1), new Vector3(1.2, 0.7, 1));
      const visited = new Set<number>();
      const missing: number[] = [];
      let inside = 0;

      knot.bvh!.traverse(
        (box) => box.intersectsBox(query),
        (triangle) => {
          visited.add(triangle);
        },
      );
      for (let t = 0; t < indices.length / 3; t++) {
        const own = new Box()
          .expandByPoint(vertex(positions, indices[t * 3]))
          .expandByPoint(vertex(positions, indices[t * 3 + 1]))
          .expandByPoint(vertex(positions, indices[t * 3 + 2]));
        if (!own.intersectsBox(query)) continue;
        inside++;
        if (!visited.has(t)) missing.push(t);
      }

      expect(inside).toBeGreaterThan(50);
      expect(missing).toEqual([]);
    });

    it('stops at the first triangle for which visitTriangle returns true', () => {
      const bvh = makeKnot().bvh!;
      let visits = 0;

      expect(
        bvh.traverse(
          () => true,
          () => {
            visits++;
            return true;
          },
        ),
      ).toBe(true);
      expect(visits).toBe(1);
      expect(
        bvh.traverse(
          () => true,
          () => {},
        ),
      ).toBe(false);
    });

    it('a traverse nested inside visitTriangle leaves the outer walk as it would be alone', () => {
      const bvh = makeKnot().bvh!;
      let alone = 0;
      let outer = 0;
      let inner = 0;

      bvh.traverse(entersNear, () => {
        alone++;
      });
      bvh.traverse(entersNear, () => {
        outer++;
        bvh.traverse(entersNear, () => {
          inner++;
        });
      });

      expect(alone).toBeGreaterThan(0);
      expect(outer).toBe(alone);
      expect(inner).toBe(alone * alone);
    });

    it('raycast inside visitTriangle returns its usual hit and leaves the walk as it would be alone', () => {
      const bvh = makeKnot().bvh!;
      const ray = new Ray(new Vector3(1.5, 0, 5), new Vector3(0, 0, -1));
      const expected = bvh.raycast(ray);
      const casts: number[] = [];
      let alone = 0;

      bvh.traverse(entersNear, () => {
        alone++;
      });
      bvh.traverse(entersNear, () => {
        casts.push(bvh.raycast(ray));
      });

      expect(expected).toBeGreaterThan(0);
      expect(casts.length).toBe(alone);
      expect(new Set(casts)).toEqual(new Set([expected]));
    });
  });
});
