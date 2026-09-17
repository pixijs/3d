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
import { computeBoundsFromPositions } from '~/geometry/utils/Geometry3DUtils';

interface ExpectedGeometryData {
  indexCount: number;
  vertexCount: number;
}

interface GeometryCase {
  name: string;
  create: () => Geometry3D;
  createWithDefaults: () => Geometry3D;
  defaultPatch: object;
  expected: ExpectedGeometryData;
  expectedFromChangedDefaults: ExpectedGeometryData;
  getDefaultOptions: () => object;
  setDefaultOptions: (options: object) => void;
}

const geometryCases: GeometryCase[] = [
  {
    name: 'CapsuleGeometry',
    create: () => new CapsuleGeometry({ radius: 0.75, height: 3, radialSegments: 6, heightSegments: 2 }),
    createWithDefaults: () => new CapsuleGeometry(),
    defaultPatch: { radius: 1.25, height: 4, radialSegments: 4, heightSegments: 1 },
    expected: { vertexCount: 63, indexCount: 252 },
    expectedFromChangedDefaults: { vertexCount: 30, indexCount: 96 },
    getDefaultOptions: () => CapsuleGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CapsuleGeometry.defaultOptions = options as typeof CapsuleGeometry.defaultOptions;
    },
  },
  {
    name: 'ConeGeometry',
    create: () => new ConeGeometry({ radius: 1, height: 2, radialSegments: 4, heightSegments: 1, openEnded: false }),
    createWithDefaults: () => new ConeGeometry(),
    defaultPatch: { radius: 1, height: 2, radialSegments: 8, heightSegments: 2, openEnded: true },
    expected: { vertexCount: 16, indexCount: 24 },
    expectedFromChangedDefaults: { vertexCount: 27, indexCount: 72 },
    getDefaultOptions: () => ConeGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      ConeGeometry.defaultOptions = options as typeof ConeGeometry.defaultOptions;
    },
  },
  {
    name: 'CubeGeometry',
    create: () =>
      new CubeGeometry({ width: 2, height: 4, depth: 6, widthSegments: 2, heightSegments: 3, depthSegments: 4 }),
    createWithDefaults: () => new CubeGeometry(),
    defaultPatch: { width: 4, height: 2, depth: 8, widthSegments: 2, heightSegments: 2, depthSegments: 2 },
    expected: { vertexCount: 94, indexCount: 312 },
    expectedFromChangedDefaults: { vertexCount: 54, indexCount: 144 },
    getDefaultOptions: () => CubeGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CubeGeometry.defaultOptions = options as typeof CubeGeometry.defaultOptions;
    },
  },
  {
    name: 'CylinderGeometry',
    create: () =>
      new CylinderGeometry({
        radiusTop: 1,
        radiusBottom: 1,
        height: 2,
        radialSegments: 4,
        heightSegments: 1,
        openEnded: false,
      }),
    createWithDefaults: () => new CylinderGeometry(),
    defaultPatch: { radiusTop: 1, radiusBottom: 1, height: 2, radialSegments: 8, heightSegments: 2, openEnded: true },
    expected: { vertexCount: 22, indexCount: 48 },
    expectedFromChangedDefaults: { vertexCount: 27, indexCount: 96 },
    getDefaultOptions: () => CylinderGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CylinderGeometry.defaultOptions = options as typeof CylinderGeometry.defaultOptions;
    },
  },
  {
    name: 'IcosahedronGeometry',
    create: () => new IcosahedronGeometry({ radius: 2, detail: 0 }),
    createWithDefaults: () => new IcosahedronGeometry(),
    defaultPatch: { radius: 2, detail: 0 },
    expected: { vertexCount: 12, indexCount: 60 },
    expectedFromChangedDefaults: { vertexCount: 12, indexCount: 60 },
    getDefaultOptions: () => IcosahedronGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      IcosahedronGeometry.defaultOptions = options as typeof IcosahedronGeometry.defaultOptions;
    },
  },
  {
    name: 'PlaneGeometry',
    create: () => new PlaneGeometry({ width: 2, height: 4, widthSegments: 2, heightSegments: 3 }),
    createWithDefaults: () => new PlaneGeometry(),
    defaultPatch: { width: 2, height: 2, widthSegments: 2, heightSegments: 2 },
    expected: { vertexCount: 12, indexCount: 36 },
    expectedFromChangedDefaults: { vertexCount: 9, indexCount: 24 },
    getDefaultOptions: () => PlaneGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      PlaneGeometry.defaultOptions = options as typeof PlaneGeometry.defaultOptions;
    },
  },
  {
    name: 'SphereGeometry',
    create: () => new SphereGeometry({ radius: 2, widthSegments: 4, heightSegments: 2 }),
    createWithDefaults: () => new SphereGeometry(),
    defaultPatch: { radius: 2, widthSegments: 6, heightSegments: 4 },
    expected: { vertexCount: 15, indexCount: 24 },
    expectedFromChangedDefaults: { vertexCount: 35, indexCount: 108 },
    getDefaultOptions: () => SphereGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      SphereGeometry.defaultOptions = options as typeof SphereGeometry.defaultOptions;
    },
  },
  {
    name: 'TorusGeometry',
    create: () => new TorusGeometry({ radius: 2, tube: 0.5, radialSegments: 4, tubularSegments: 6 }),
    createWithDefaults: () => new TorusGeometry(),
    defaultPatch: { radius: 2, tube: 0.5, radialSegments: 6, tubularSegments: 8 },
    expected: { vertexCount: 35, indexCount: 144 },
    expectedFromChangedDefaults: { vertexCount: 63, indexCount: 288 },
    getDefaultOptions: () => TorusGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      TorusGeometry.defaultOptions = options as typeof TorusGeometry.defaultOptions;
    },
  },
  {
    name: 'TorusKnotGeometry',
    create: () => new TorusKnotGeometry({ radius: 2, tube: 0.5, tubularSegments: 8, radialSegments: 4, p: 2, q: 3 }),
    createWithDefaults: () => new TorusKnotGeometry(),
    defaultPatch: { radius: 2, tube: 0.5, tubularSegments: 10, radialSegments: 6, p: 2, q: 3 },
    expected: { vertexCount: 45, indexCount: 192 },
    expectedFromChangedDefaults: { vertexCount: 77, indexCount: 360 },
    getDefaultOptions: () => TorusKnotGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      TorusKnotGeometry.defaultOptions = options as typeof TorusKnotGeometry.defaultOptions;
    },
  },
];

function expectVectorCloseTo(actual: { x: number; y: number; z: number }, expected: [number, number, number]): void {
  expect(actual.x).toBeCloseTo(expected[0], 5);
  expect(actual.y).toBeCloseTo(expected[1], 5);
  expect(actual.z).toBeCloseTo(expected[2], 5);
}

function expectBoundsToMatchPositions(geometry: Geometry3D): void {
  const expected = computeBoundsFromPositions(geometry.positions);

  expectVectorCloseTo(geometry.bounds3D.min, [expected.min.x, expected.min.y, expected.min.z]);
  expectVectorCloseTo(geometry.bounds3D.max, [expected.max.x, expected.max.y, expected.max.z]);
}

function expectGeometryData(
  geometry: Geometry3D,
  expected: ExpectedGeometryData,
  normalFormat: 'float32x3' | 'snorm16x4' = 'snorm16x4',
): void {
  expect(geometry.vertexCount).toBe(expected.vertexCount);
  expect(geometry.positions).toBeInstanceOf(Float32Array);
  expect(geometry.positions).toHaveLength(expected.vertexCount * 3);
  expect(geometry.uvs).toBeInstanceOf(Float32Array);
  expect(geometry.uvs).toHaveLength(expected.vertexCount * 2);
  expect(geometry.normals).toHaveLength(expected.vertexCount * (normalFormat === 'float32x3' ? 3 : 4));
  expect(geometry.indices).toHaveLength(expected.indexCount);
  expect(geometry.attributes.aPosition.format).toBe('float32x3');
  expect(geometry.attributes.aUV.format).toBe('float32x2');
  expect(geometry.attributes.aNormal.format).toBe(normalFormat);
  expectBoundsToMatchPositions(geometry);
}

function expectFirstFaceToMatchNormal(geometry: Geometry3D): void {
  const positions = geometry.positions;
  const normals = geometry.normals;
  const indices = geometry.indices;

  expect(normals).toBeDefined();
  if (!normals) return;

  const ia = indices[0] * 3;
  const ib = indices[1] * 3;
  const ic = indices[2] * 3;
  const abx = positions[ib] - positions[ia];
  const aby = positions[ib + 1] - positions[ia + 1];
  const abz = positions[ib + 2] - positions[ia + 2];
  const acx = positions[ic] - positions[ia];
  const acy = positions[ic + 1] - positions[ia + 1];
  const acz = positions[ic + 2] - positions[ia + 2];
  const faceNormalX = aby * acz - abz * acy;
  const faceNormalY = abz * acx - abx * acz;
  const faceNormalZ = abx * acy - aby * acx;
  const dot = faceNormalX * normals[ia] + faceNormalY * normals[ia + 1] + faceNormalZ * normals[ia + 2];

  expect(dot).toBeGreaterThan(0);
}

describe('geometry defaults', () => {
  it('allows Geometry3D default options to be changed', () => {
    const originalDefaultOptions = { ...Geometry3D.defaultOptions };
    let geometry: Geometry3D | undefined;

    try {
      Geometry3D.defaultOptions = {
        ...originalDefaultOptions,
        quantizeNormals: false,
        topology: 'line-list',
      };

      geometry = new Geometry3D({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      });

      expect(geometry.topology).toBe('line-list');
      expect(geometry.attributes.aNormal.format).toBe('float32x3');
    } finally {
      geometry?.destroy(true);
      Geometry3D.defaultOptions = originalDefaultOptions;
    }
  });

  it.each(geometryCases)('$name default options extend Geometry3D defaults', ({ getDefaultOptions }) => {
    expect(getDefaultOptions()).toMatchObject(Geometry3D.defaultOptions);
  });

  it.each(geometryCases)('$name emits the expected data from explicit options', ({ create, expected }) => {
    const geometry = create();

    try {
      expect(geometry.topology).toBe('triangle-list');
      expectGeometryData(geometry, expected);
    } finally {
      geometry.destroy(true);
    }
  });

  it('CubeGeometry floors segment counts and keeps at least one segment per axis', () => {
    const geometry = new CubeGeometry({ widthSegments: 0, heightSegments: 2.8, depthSegments: 1.2 });

    try {
      expectGeometryData(geometry, { vertexCount: 32, indexCount: 60 });
    } finally {
      geometry.destroy(true);
    }
  });

  it('TorusGeometry and TorusKnotGeometry emit outward-facing triangles', () => {
    const torus = new TorusGeometry({ quantizeNormals: false });
    const knot = new TorusKnotGeometry({ quantizeNormals: false });

    try {
      expectFirstFaceToMatchNormal(torus);
      expectFirstFaceToMatchNormal(knot);
    } finally {
      torus.destroy(true);
      knot.destroy(true);
    }
  });

  it.each(geometryCases)('$name allows static defaults to be changed', (testCase) => {
    const originalDefaultOptions = { ...testCase.getDefaultOptions() };
    let geometry: Geometry3D | undefined;

    try {
      testCase.setDefaultOptions({
        ...originalDefaultOptions,
        ...testCase.defaultPatch,
        quantizeNormals: false,
        topology: 'line-list',
      });

      geometry = testCase.createWithDefaults();

      expect(geometry.topology).toBe('line-list');
      expectGeometryData(geometry, testCase.expectedFromChangedDefaults, 'float32x3');
    } finally {
      geometry?.destroy(true);
      testCase.setDefaultOptions(originalDefaultOptions);
    }
  });
});
