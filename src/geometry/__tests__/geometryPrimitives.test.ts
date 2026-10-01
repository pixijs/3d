import { Buffer, BufferUsage } from 'pixi.js';
import type { Attribute } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CapsuleGeometry } from '~/geometry/CapsuleGeometry';
import { ConeGeometry } from '~/geometry/ConeGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { CylinderGeometry } from '~/geometry/CylinderGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { IcosahedronGeometry } from '~/geometry/IcosahedronGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { TorusGeometry } from '~/geometry/TorusGeometry';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';

function expectCloseTuple(data: ArrayLike<number>, offset: number, expected: [number, number, number]): void {
  expect(data[offset]).toBeCloseTo(expected[0], 5);
  expect(data[offset + 1]).toBeCloseTo(expected[1], 5);
  expect(data[offset + 2]).toBeCloseTo(expected[2], 5);
}

function expectEveryNormalIsUnit(normals: ArrayLike<number>): void {
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];

    expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 5);
  }
}

function expectPositionsMatchNormals(positions: ArrayLike<number>, normals: ArrayLike<number>, radius: number): void {
  for (let i = 0; i < positions.length; i += 3) {
    expect(positions[i]).toBeCloseTo(normals[i] * radius, 5);
    expect(positions[i + 1]).toBeCloseTo(normals[i + 1] * radius, 5);
    expect(positions[i + 2]).toBeCloseTo(normals[i + 2] * radius, 5);
  }
}

function expectNoDegenerateTriangles(geometry: Geometry3D): void {
  const positions = geometry.positions;
  const indices = geometry.indices;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;

    expect(cx * cx + cy * cy + cz * cz).toBeGreaterThan(0);
  }
}

/**
 * Checks that every triangle winds counter-clockwise seen from the side its vertex normals face,
 * which is the side that stays visible when back faces are culled
 */
function expectTrianglesFaceTheirNormals(geometry: Geometry3D): void {
  const positions = geometry.positions;
  const normals = geometry.normals ?? [];
  const indices = geometry.indices;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const faceX = aby * acz - abz * acy;
    const faceY = abz * acx - abx * acz;
    const faceZ = abx * acy - aby * acx;
    const normalX = normals[ia] + normals[ib] + normals[ic];
    const normalY = normals[ia + 1] + normals[ib + 1] + normals[ic + 1];
    const normalZ = normals[ia + 2] + normals[ib + 2] + normals[ic + 2];

    expect(faceX * normalX + faceY * normalY + faceZ * normalZ).toBeGreaterThan(0);
  }
}

describe('geometry primitives', () => {
  it('winds every triangle counter-clockwise seen from the side its normals face', () => {
    const unquantized = { quantizeNormals: false };
    const geometries: Geometry3D[] = [
      new PlaneGeometry({ ...unquantized, widthSegments: 2, heightSegments: 2 }),
      new CubeGeometry({ ...unquantized, widthSegments: 2, heightSegments: 2, depthSegments: 2 }),
      new CylinderGeometry({ ...unquantized, radiusTop: 0.5, heightSegments: 2 }),
      new ConeGeometry({ ...unquantized, heightSegments: 2 }),
      new CapsuleGeometry(unquantized),
      new SphereGeometry(unquantized),
      new IcosahedronGeometry({ ...unquantized, detail: 1 }),
      new TorusGeometry(unquantized),
      new TorusKnotGeometry(unquantized),
    ];

    try {
      for (const geometry of geometries) expectTrianglesFaceTheirNormals(geometry);
    } finally {
      for (const geometry of geometries) geometry.destroy(true);
    }
  });

  it('PlaneGeometry lays out a two-triangle plane with matching UVs and normals', () => {
    const geometry = new PlaneGeometry({ width: 2, height: 4, quantizeNormals: false });

    try {
      expect(Array.from(geometry.positions)).toEqual([-1, -2, 0, 1, -2, 0, -1, 2, 0, 1, 2, 0]);
      expect(Array.from(geometry.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
      expect(Array.from(geometry.normals ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
      expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 2, 1, 3]);
      expectCloseTuple(geometry.positions, 0, [-1, -2, 0]);
      expectCloseTuple([geometry.bounds3D.min.x, geometry.bounds3D.min.y, geometry.bounds3D.min.z], 0, [-1, -2, 0]);
      expectCloseTuple([geometry.bounds3D.max.x, geometry.bounds3D.max.y, geometry.bounds3D.max.z], 0, [1, 2, 0]);
    } finally {
      geometry.destroy(true);
    }
  });

  it('CubeGeometry creates separate vertices per face with axis-aligned normals', () => {
    const geometry = new CubeGeometry({ width: 2, height: 4, depth: 6, quantizeNormals: false });

    try {
      expect(geometry.vertexCount).toBe(24);
      expect(geometry.indices).toHaveLength(36);
      expectCloseTuple([geometry.bounds3D.min.x, geometry.bounds3D.min.y, geometry.bounds3D.min.z], 0, [-1, -2, -3]);
      expectCloseTuple([geometry.bounds3D.max.x, geometry.bounds3D.max.y, geometry.bounds3D.max.z], 0, [1, 2, 3]);

      const normals = Array.from(geometry.normals ?? []);
      const uniqueNormals = new Set<string>();

      for (let i = 0; i < normals.length; i += 3) {
        uniqueNormals.add(`${normals[i]},${normals[i + 1]},${normals[i + 2]}`);
      }

      expect([...uniqueNormals].sort()).toEqual(['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0']);
    } finally {
      geometry.destroy(true);
    }
  });

  it('CylinderGeometry and ConeGeometry omit cap geometry when openEnded is true', () => {
    const cylinder = new CylinderGeometry({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 4,
      heightSegments: 1,
      openEnded: true,
      quantizeNormals: false,
    });
    const cone = new ConeGeometry({
      radius: 1,
      height: 2,
      radialSegments: 4,
      heightSegments: 1,
      openEnded: true,
      quantizeNormals: false,
    });

    try {
      expect(cylinder.vertexCount).toBe(10);
      expect(cylinder.indices).toHaveLength(24);
      expect(cone.vertexCount).toBe(10);
      expect(cone.indices).toHaveLength(12);
      expectEveryNormalIsUnit(cylinder.normals ?? []);
      expectEveryNormalIsUnit(cone.normals ?? []);
      expectNoDegenerateTriangles(cone);
    } finally {
      cylinder.destroy(true);
      cone.destroy(true);
    }
  });

  it('CylinderGeometry skips zero-radius caps while preserving the opposite cap', () => {
    const geometry = new CylinderGeometry({
      radiusTop: 0,
      radiusBottom: 1,
      height: 2,
      radialSegments: 4,
      heightSegments: 1,
      openEnded: false,
      quantizeNormals: false,
    });

    try {
      expect(geometry.vertexCount).toBe(16);
      expect(geometry.indices).toHaveLength(24);
      expectCloseTuple(geometry.positions, 0, [0, 1, 0]);
      expectCloseTuple(geometry.positions, 45, [1, -1, 0]);
      expectNoDegenerateTriangles(geometry);
    } finally {
      geometry.destroy(true);
    }
  });

  it('CapsuleGeometry keeps vertices on the requested capsule envelope', () => {
    const geometry = new CapsuleGeometry({
      radius: 1,
      height: 4,
      radialSegments: 4,
      heightSegments: 1,
      quantizeNormals: false,
    });

    try {
      expect(geometry.vertexCount).toBe(30);
      expect(geometry.indices).toHaveLength(96);
      expectCloseTuple([geometry.bounds3D.min.x, geometry.bounds3D.min.y, geometry.bounds3D.min.z], 0, [-1, -2, -1]);
      expectCloseTuple([geometry.bounds3D.max.x, geometry.bounds3D.max.y, geometry.bounds3D.max.z], 0, [1, 2, 1]);
      expectEveryNormalIsUnit(geometry.normals ?? []);
      expectNoDegenerateTriangles(geometry);
    } finally {
      geometry.destroy(true);
    }
  });

  it('CylinderGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ radialSegments: number; heightSegments: number }> = [
      { radialSegments: 0, heightSegments: 0 },
      { radialSegments: 2.7, heightSegments: 1.4 },
      { radialSegments: -1, heightSegments: -3 },
      { radialSegments: Number.NaN, heightSegments: Number.NaN },
      { radialSegments: Number.POSITIVE_INFINITY, heightSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new CylinderGeometry({
        radiusTop: 1,
        radiusBottom: 1,
        height: 2,
        ...segments,
        openEnded: true,
        quantizeNormals: false,
      });

      try {
        const radialEffective = Number.isFinite(segments.radialSegments)
          ? Math.max(3, Math.floor(segments.radialSegments))
          : 3;
        const heightEffective = Number.isFinite(segments.heightSegments)
          ? Math.max(1, Math.floor(segments.heightSegments))
          : 1;
        const expectedVerts = (radialEffective + 1) * (heightEffective + 1);

        expect(geometry.vertexCount).toBe(expectedVerts);
        expectEveryNormalIsUnit(geometry.normals ?? []);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('CapsuleGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ radialSegments: number; heightSegments: number }> = [
      { radialSegments: 0, heightSegments: 0 },
      { radialSegments: 4.7, heightSegments: 1.4 },
      { radialSegments: -1, heightSegments: -3 },
      { radialSegments: Number.NaN, heightSegments: Number.NaN },
      { radialSegments: Number.POSITIVE_INFINITY, heightSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new CapsuleGeometry({
        radius: 1,
        height: 4,
        ...segments,
        quantizeNormals: false,
      });

      try {
        expectEveryNormalIsUnit(geometry.normals ?? []);
        expectNoDegenerateTriangles(geometry);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('CylinderGeometry keeps Uint16 indices when vertex count equals 65536', () => {
    const geometry = new CylinderGeometry({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 511,
      heightSegments: 127,
      openEnded: true,
    });

    try {
      expect(geometry.vertexCount).toBe(65536);
      expect(geometry.indices).toBeInstanceOf(Uint16Array);
    } finally {
      geometry.destroy(true);
    }
  });

  it('SphereGeometry emits radial unit normals and skips pole degenerates', () => {
    const geometry = new SphereGeometry({ radius: 2, widthSegments: 4, heightSegments: 4, quantizeNormals: false });

    try {
      expect(geometry.vertexCount).toBe(25);
      expect(geometry.indices).toHaveLength(72);
      expectEveryNormalIsUnit(geometry.normals ?? []);
      expectPositionsMatchNormals(geometry.positions, geometry.normals ?? [], 2);
      expectNoDegenerateTriangles(geometry);
    } finally {
      geometry.destroy(true);
    }
  });

  it('IcosahedronGeometry clamps a huge detail to the documented max of 7', () => {
    const huge = new IcosahedronGeometry({ detail: 100 });
    const detail7 = new IcosahedronGeometry({ detail: 7 });

    try {
      expect(huge.vertexCount).toBe(detail7.vertexCount);
      expect(huge.indices.length).toBe(detail7.indices.length);
    } finally {
      huge.destroy(true);
      detail7.destroy(true);
    }
  });

  it('IcosahedronGeometry coerces non-finite and fractional detail to a sane value', () => {
    const baseline = new IcosahedronGeometry({ detail: 0 });

    try {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -10, 1.7]) {
        const geometry = new IcosahedronGeometry({ detail: bad });

        try {
          expect(Number.isFinite(geometry.vertexCount)).toBe(true);
          expect(geometry.vertexCount).toBeGreaterThanOrEqual(baseline.vertexCount);
        } finally {
          geometry.destroy(true);
        }
      }
    } finally {
      baseline.destroy(true);
    }
  });

  it('PlaneGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ widthSegments: number; heightSegments: number }> = [
      { widthSegments: 0, heightSegments: 0 },
      { widthSegments: 2.7, heightSegments: 1.4 },
      { widthSegments: -1, heightSegments: -3 },
      { widthSegments: Number.NaN, heightSegments: Number.NaN },
      { widthSegments: Number.POSITIVE_INFINITY, heightSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new PlaneGeometry({ width: 2, height: 2, ...segments, quantizeNormals: false });

      try {
        const wEffective = Number.isFinite(segments.widthSegments)
          ? Math.max(1, Math.floor(segments.widthSegments))
          : 1;
        const hEffective = Number.isFinite(segments.heightSegments)
          ? Math.max(1, Math.floor(segments.heightSegments))
          : 1;
        const expectedVerts = (wEffective + 1) * (hEffective + 1);
        const expectedIndices = wEffective * hEffective * 6;

        expect(geometry.vertexCount).toBe(expectedVerts);
        expect(geometry.indices).toHaveLength(expectedIndices);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('SphereGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ widthSegments: number; heightSegments: number }> = [
      { widthSegments: 0, heightSegments: 0 },
      { widthSegments: 5.6, heightSegments: 3.4 },
      { widthSegments: -10, heightSegments: -5 },
      { widthSegments: Number.NaN, heightSegments: Number.NaN },
      { widthSegments: Number.POSITIVE_INFINITY, heightSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new SphereGeometry({ radius: 1, ...segments, quantizeNormals: false });

      try {
        const wEffective = Number.isFinite(segments.widthSegments)
          ? Math.max(3, Math.floor(segments.widthSegments))
          : 3;
        const hEffective = Number.isFinite(segments.heightSegments)
          ? Math.max(2, Math.floor(segments.heightSegments))
          : 2;
        const expectedVerts = (wEffective + 1) * (hEffective + 1);

        expect(geometry.vertexCount).toBe(expectedVerts);
        expectEveryNormalIsUnit(geometry.normals ?? []);
        expectNoDegenerateTriangles(geometry);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('TorusGeometry honours the arc and emits normalized tube normals', () => {
    const geometry = new TorusGeometry({
      radius: 2,
      tube: 0.5,
      radialSegments: 4,
      tubularSegments: 4,
      arc: Math.PI,
      quantizeNormals: false,
    });

    try {
      expect(geometry.vertexCount).toBe(25);
      expect(geometry.indices).toHaveLength(96);
      expectCloseTuple(geometry.positions, 0, [2.5, 0, 0]);
      expectCloseTuple(geometry.positions, 12, [-2.5, 0, 0]);
      expectEveryNormalIsUnit(geometry.normals ?? []);
    } finally {
      geometry.destroy(true);
    }
  });

  it('TorusGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ radialSegments: number; tubularSegments: number }> = [
      { radialSegments: 0, tubularSegments: 0 },
      { radialSegments: 2.7, tubularSegments: 5.9 },
      { radialSegments: -1, tubularSegments: -8 },
      { radialSegments: Number.NaN, tubularSegments: Number.NaN },
      { radialSegments: Number.POSITIVE_INFINITY, tubularSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new TorusGeometry({ radius: 1, tube: 0.4, ...segments, quantizeNormals: false });

      try {
        const radialEffective = Number.isFinite(segments.radialSegments)
          ? Math.max(3, Math.floor(segments.radialSegments))
          : 3;
        const tubularEffective = Number.isFinite(segments.tubularSegments)
          ? Math.max(3, Math.floor(segments.tubularSegments))
          : 3;
        const expectedVerts = (radialEffective + 1) * (tubularEffective + 1);
        const expectedIndices = radialEffective * tubularEffective * 6;

        expect(geometry.vertexCount).toBe(expectedVerts);
        expect(geometry.indices).toHaveLength(expectedIndices);
        expectEveryNormalIsUnit(geometry.normals ?? []);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('TorusKnotGeometry keeps tube normals normalized around the knot path', () => {
    const geometry = new TorusKnotGeometry({
      radius: 2,
      tube: 0.25,
      tubularSegments: 8,
      radialSegments: 4,
      p: 2,
      q: 3,
      quantizeNormals: false,
    });

    try {
      expect(geometry.vertexCount).toBe(45);
      expect(geometry.indices).toHaveLength(192);
      expectEveryNormalIsUnit(geometry.normals ?? []);
      expect(Array.from(geometry.uvs?.slice(0, 4) ?? [])).toEqual([0, 0, 0, 0.25]);
    } finally {
      geometry.destroy(true);
    }
  });

  it('TorusKnotGeometry uses an analytic curve tangent that matches the closed-form derivative', () => {
    const radius = 2;
    const tube = 0.25;
    const tubularSegments = 8;
    const radialSegments = 4;
    const p = 2;
    const q = 3;
    const geometry = new TorusKnotGeometry({
      radius,
      tube,
      tubularSegments,
      radialSegments,
      p,
      q,
      quantizeNormals: false,
    });

    try {
      const positions = geometry.positions;
      const normals = geometry.normals ?? new Float32Array();
      const rowSize = radialSegments + 1;

      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * p * Math.PI * 2;
        const k = q / p;
        const ku = k * u;
        const cosKu = Math.cos(ku);
        const sinKu = Math.sin(ku);
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);
        const radial = (2 + cosKu) * 0.5;
        const cx = radius * radial * cosU;
        const cy = radius * sinKu * 0.5;
        const cz = radius * radial * sinU;
        const tx = radius * 0.5 * (-k * sinKu * cosU - (2 + cosKu) * sinU);
        const ty = radius * 0.5 * k * cosKu;
        const tz = radius * 0.5 * (-k * sinKu * sinU + (2 + cosKu) * cosU);
        const tangentLen = Math.sqrt(tx * tx + ty * ty + tz * tz);

        for (let j = 0; j <= radialSegments; j++) {
          const vertex = (i * rowSize + j) * 3;
          const dx = positions[vertex] - cx;
          const dy = positions[vertex + 1] - cy;
          const dz = positions[vertex + 2] - cz;
          const dot = (dx * tx + dy * ty + dz * tz) / tangentLen;

          expect(Math.abs(dot)).toBeLessThan(1e-4);

          const ndot = normals[vertex] * tx + normals[vertex + 1] * ty + normals[vertex + 2] * tz;

          expect(Math.abs(ndot) / tangentLen).toBeLessThan(1e-4);
        }
      }
    } finally {
      geometry.destroy(true);
    }
  });

  it('TorusKnotGeometry clamps fractional and invalid segment counts to per-shape minimums', () => {
    const cases: Array<{ radialSegments: number; tubularSegments: number }> = [
      { radialSegments: 0, tubularSegments: 0 },
      { radialSegments: 2.7, tubularSegments: 5.9 },
      { radialSegments: -1, tubularSegments: -8 },
      { radialSegments: Number.NaN, tubularSegments: Number.NaN },
      { radialSegments: Number.POSITIVE_INFINITY, tubularSegments: Number.POSITIVE_INFINITY },
    ];

    for (const segments of cases) {
      const geometry = new TorusKnotGeometry({
        radius: 1,
        tube: 0.4,
        p: 2,
        q: 3,
        ...segments,
        quantizeNormals: false,
      });

      try {
        const radialEffective = Number.isFinite(segments.radialSegments)
          ? Math.max(3, Math.floor(segments.radialSegments))
          : 3;
        const tubularEffective = Number.isFinite(segments.tubularSegments)
          ? Math.max(3, Math.floor(segments.tubularSegments))
          : 3;
        const expectedVerts = (radialEffective + 1) * (tubularEffective + 1);
        const expectedIndices = radialEffective * tubularEffective * 6;

        expect(geometry.vertexCount).toBe(expectedVerts);
        expect(geometry.indices).toHaveLength(expectedIndices);
        expectEveryNormalIsUnit(geometry.normals ?? []);
      } finally {
        geometry.destroy(true);
      }
    }
  });

  it('Geometry3D preserves explicit attribute formats and computes vertex counts from byte strides', () => {
    const positionAttribute: Attribute = {
      buffer: new Buffer({
        data: new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767]),
        usage: BufferUsage.VERTEX,
      }),
      format: 'snorm16x4',
      stride: 8,
      offset: 0,
    };
    const normalAttribute: Attribute = {
      buffer: new Buffer({
        data: new Int16Array([0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767, 0]),
        usage: BufferUsage.VERTEX,
      }),
      format: 'snorm16x4',
      stride: 8,
      offset: 0,
    };
    const geometry = new Geometry3D({
      positions: positionAttribute,
      normals: normalAttribute,
      indices: new Uint16Array([0, 1, 2]),
    });

    try {
      expect(geometry.vertexCount).toBe(3);
      expect(geometry.attributes.aPosition.format).toBe('snorm16x4');
      expect(geometry.attributes.aNormal.format).toBe('snorm16x4');
      expect(geometry.positions).toBe(positionAttribute.buffer.data);
      expect(geometry.normals).toBe(normalAttribute.buffer.data);
      expect(geometry.indices).toBeInstanceOf(Uint32Array);
    } finally {
      geometry.destroy(true);
    }
  });
});
