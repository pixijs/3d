import type { TestScene } from '@test-utils';
import { ColorMatrixFilter, Container, Texture } from 'pixi.js';

import { CylinderGeometry } from '~/geometry/CylinderGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const PANEL = 3;
const PANEL_GAP = 0.5;
const RIDGES = 4;
const RIDGE_RADIUS = PANEL / RIDGES / 2;
const MAP_SIZE = 256;

/**
 * A normal map of `RIDGES` half-cylinder ridges, the same profile the reference panel builds from
 * real cylinders
 *
 * `'v'` runs the ridges across the image, so only green varies; `'u'` runs them down it, so only
 * red does. Green points up the image and red points right, as in glTF.
 */
function ridgeNormalMap(axis: 'u' | 'v'): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_SIZE;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(MAP_SIZE, MAP_SIZE);
  const ridgeSize = MAP_SIZE / RIDGES;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const along = axis === 'u' ? x : y;
      const across = (((along + 0.5) % ridgeSize) / ridgeSize) * 2 - 1;
      const nx = axis === 'u' ? across : 0;
      const ny = axis === 'u' ? 0 : -across;
      const nz = Math.sqrt(1 - across * across);
      const i = (y * MAP_SIZE + x) * 4;
      image.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return Texture.from({ resource: canvas, label: `ridge-normal-${axis}` });
}

/** A flat panel facing `+Z` with `v = 0` on its top edge, as glTF lays UVs out */
function flatPanel(withTangents: boolean): Geometry3D {
  const h = PANEL / 2;

  return new Geometry3D({
    positions: new Float32Array([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    tangents: withTangents ? new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]) : undefined,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

/**
 * One row of three panels under two coloured lights that face each other along `axis`
 *
 * Left is real geometry, middle is the ridge map on a panel with no tangents, right is the same
 * map on a panel with tangents.
 */
function buildRow(axis: 'u' | 'v', width: number, height: number): View3D {
  const view3d = new View3D({ width, height });

  view3d.camera.fov = 8;
  view3d.camera.position.set(0, 0, 40);

  const [first, second] = axis === 'u' ? [0xff2d6f, 0x12d6c0] : [0xff9a1f, 0x2a6bff];
  const [dx, dy] = axis === 'u' ? [1, 0] : [0, -1];

  const lightA = new DirectionalLight({ color: first, intensity: 4 });
  lightA.lookAt({ x: dx, y: dy, z: -0.5 });
  view3d.root.addChild(lightA);

  const lightB = new DirectionalLight({ color: second, intensity: 4 });
  lightB.lookAt({ x: -dx, y: -dy, z: -0.5 });
  view3d.root.addChild(lightB);

  const step = PANEL + PANEL_GAP;
  const cylinder = new CylinderGeometry({
    radiusTop: RIDGE_RADIUS,
    radiusBottom: RIDGE_RADIUS,
    height: PANEL,
    radialSegments: 64,
    openEnded: true,
  });
  const solid = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.8 });

  for (let i = 0; i < RIDGES; i++) {
    const offset = (i - (RIDGES - 1) / 2) * RIDGE_RADIUS * 2;
    const ridge = new Mesh3D({ geometry: cylinder, material: solid });

    if (axis === 'u') {
      ridge.position.set(-step + offset, 0, 0);
    } else {
      ridge.position.set(-step, offset, 0);
      ridge.rotation.z = Math.PI / 2;
    }
    view3d.root.addChild(ridge);
  }

  const mapped = new Material3D({
    baseColor: 0xffffff,
    metallic: 0,
    roughness: 0.8,
    normalTexture: ridgeNormalMap(axis),
  });

  const withoutTangents = new Mesh3D({ geometry: flatPanel(false), material: mapped });
  view3d.root.addChild(withoutTangents);

  const withTangents = new Mesh3D({ geometry: flatPanel(true), material: mapped });
  withTangents.position.x = step;
  view3d.root.addChild(withTangents);

  return view3d;
}

/**
 * A scene that shows which way a normal map's red or green channel leans the surface
 *
 * Each row holds three panels of ridges: real cylinders, then the ridge normal map on a flat panel
 * without tangents, then the same map with tangents. Two coloured lights face each other across
 * the ridges, so each side of a ridge takes one colour. All three panels must match. A channel
 * read the wrong way round swaps the two colours on that panel.
 *
 * The top row draws straight to the canvas. The bottom row sits under a filter, so pixi draws it
 * into a render texture first, where WebGL's window y runs the other way.
 * @param axis - `'v'` tests green with ridges running across, `'u'` tests red with ridges running down
 */
export function normalMapOrientationScene(axis: 'u' | 'v'): TestScene {
  return {
    app: { backgroundColor: 0x0b0d12 },
    create: async (app) => {
      const width = app.screen.width;
      const height = app.screen.height / 2;

      app.stage.addChild(buildRow(axis, width, height));

      const filtered = new Container();
      filtered.y = height;
      filtered.filters = [new ColorMatrixFilter()];
      filtered.addChild(buildRow(axis, width, height));
      app.stage.addChild(filtered);
    },
  };
}
