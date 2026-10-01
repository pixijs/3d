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
  createWithDefaults: () => Geometry3D;
  defaultPatch: object;
  expectedFromChangedDefaults: ExpectedGeometryData;
  getDefaultOptions: () => object;
  setDefaultOptions: (options: object) => void;
}

const geometryCases: GeometryCase[] = [
  {
    name: 'CapsuleGeometry',
    createWithDefaults: () => new CapsuleGeometry(),
    defaultPatch: { radius: 1.25, height: 4, radialSegments: 4, heightSegments: 1 },
    expectedFromChangedDefaults: { vertexCount: 30, indexCount: 96 },
    getDefaultOptions: () => CapsuleGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CapsuleGeometry.defaultOptions = options as typeof CapsuleGeometry.defaultOptions;
    },
  },
  {
    name: 'ConeGeometry',
    createWithDefaults: () => new ConeGeometry(),
    defaultPatch: { radius: 1, height: 2, radialSegments: 8, heightSegments: 2, openEnded: true },
    expectedFromChangedDefaults: { vertexCount: 27, indexCount: 72 },
    getDefaultOptions: () => ConeGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      ConeGeometry.defaultOptions = options as typeof ConeGeometry.defaultOptions;
    },
  },
  {
    name: 'CubeGeometry',
    createWithDefaults: () => new CubeGeometry(),
    defaultPatch: { width: 4, height: 2, depth: 8, widthSegments: 2, heightSegments: 2, depthSegments: 2 },
    expectedFromChangedDefaults: { vertexCount: 54, indexCount: 144 },
    getDefaultOptions: () => CubeGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CubeGeometry.defaultOptions = options as typeof CubeGeometry.defaultOptions;
    },
  },
  {
    name: 'CylinderGeometry',
    createWithDefaults: () => new CylinderGeometry(),
    defaultPatch: { radiusTop: 1, radiusBottom: 1, height: 2, radialSegments: 8, heightSegments: 2, openEnded: true },
    expectedFromChangedDefaults: { vertexCount: 27, indexCount: 96 },
    getDefaultOptions: () => CylinderGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      CylinderGeometry.defaultOptions = options as typeof CylinderGeometry.defaultOptions;
    },
  },
  {
    name: 'IcosahedronGeometry',
    createWithDefaults: () => new IcosahedronGeometry(),
    defaultPatch: { radius: 2, detail: 0 },
    expectedFromChangedDefaults: { vertexCount: 12, indexCount: 60 },
    getDefaultOptions: () => IcosahedronGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      IcosahedronGeometry.defaultOptions = options as typeof IcosahedronGeometry.defaultOptions;
    },
  },
  {
    name: 'PlaneGeometry',
    createWithDefaults: () => new PlaneGeometry(),
    defaultPatch: { width: 2, height: 2, widthSegments: 2, heightSegments: 2 },
    expectedFromChangedDefaults: { vertexCount: 9, indexCount: 24 },
    getDefaultOptions: () => PlaneGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      PlaneGeometry.defaultOptions = options as typeof PlaneGeometry.defaultOptions;
    },
  },
  {
    name: 'SphereGeometry',
    createWithDefaults: () => new SphereGeometry(),
    defaultPatch: { radius: 2, widthSegments: 6, heightSegments: 4 },
    expectedFromChangedDefaults: { vertexCount: 35, indexCount: 108 },
    getDefaultOptions: () => SphereGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      SphereGeometry.defaultOptions = options as typeof SphereGeometry.defaultOptions;
    },
  },
  {
    name: 'TorusGeometry',
    createWithDefaults: () => new TorusGeometry(),
    defaultPatch: { radius: 2, tube: 0.5, radialSegments: 6, tubularSegments: 8 },
    expectedFromChangedDefaults: { vertexCount: 63, indexCount: 288 },
    getDefaultOptions: () => TorusGeometry.defaultOptions,
    setDefaultOptions: (options) => {
      TorusGeometry.defaultOptions = options as typeof TorusGeometry.defaultOptions;
    },
  },
  {
    name: 'TorusKnotGeometry',
    createWithDefaults: () => new TorusKnotGeometry(),
    defaultPatch: { radius: 2, tube: 0.5, tubularSegments: 10, radialSegments: 6, p: 2, q: 3 },
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

  it('CubeGeometry floors segment counts and keeps at least one segment per axis', () => {
    const geometry = new CubeGeometry({ widthSegments: 0, heightSegments: 2.8, depthSegments: 1.2 });

    try {
      expectGeometryData(geometry, { vertexCount: 32, indexCount: 60 });
    } finally {
      geometry.destroy(true);
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
