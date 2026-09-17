import type { TestScene } from '@test-utils';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Non-uniform scale and the normal transform.
 *
 * Both rows are the same ellipsoid — 3:1 along X — reached two ways. The top is
 * a unit sphere under `mesh.scale.set(3, 1, 1)`, so the shader derives its
 * normals from the model matrix. The bottom bakes the same stretch into the
 * vertices and carries correct normals with it.
 *
 * Identical silhouettes, so any shading difference is the normal transform
 * alone. They should match.
 */
const SEGMENTS_W = 48;
const SEGMENTS_H = 24;

/** Builds an ellipsoid. `bakeNormals` writes the true surface normal for the stretch. */
function ellipsoid(scale: [number, number, number], bakeNormals: boolean): Geometry3D {
  const [sx, sy, sz] = bakeNormals ? scale : [1, 1, 1];
  const count = (SEGMENTS_W + 1) * (SEGMENTS_H + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices: number[] = [];

  for (let iy = 0; iy <= SEGMENTS_H; iy++) {
    const theta = (iy / SEGMENTS_H) * Math.PI;

    for (let ix = 0; ix <= SEGMENTS_W; ix++) {
      const phi = (ix / SEGMENTS_W) * Math.PI * 2;
      const i = iy * (SEGMENTS_W + 1) + ix;

      // Unit-sphere direction.
      const nx = -Math.cos(phi) * Math.sin(theta);
      const ny = Math.cos(theta);
      const nz = Math.sin(phi) * Math.sin(theta);

      positions[i * 3] = nx * sx;
      positions[i * 3 + 1] = ny * sy;
      positions[i * 3 + 2] = nz * sz;

      // True normal of a stretched surface is the inverse-transpose direction:
      // divide by the scale rather than multiply by it.
      const ex = nx / sx;
      const ey = ny / sy;
      const ez = nz / sz;
      const length = Math.hypot(ex, ey, ez);

      normals[i * 3] = ex / length;
      normals[i * 3 + 1] = ey / length;
      normals[i * 3 + 2] = ez / length;
      uvs[i * 2] = ix / SEGMENTS_W;
      uvs[i * 2 + 1] = 1 - iy / SEGMENTS_H;
    }
  }

  for (let iy = 0; iy < SEGMENTS_H; iy++) {
    for (let ix = 0; ix < SEGMENTS_W; ix++) {
      const a = iy * (SEGMENTS_W + 1) + ix + 1;
      const b = iy * (SEGMENTS_W + 1) + ix;
      const c = (iy + 1) * (SEGMENTS_W + 1) + ix;
      const d = (iy + 1) * (SEGMENTS_W + 1) + ix + 1;

      if (iy !== 0) indices.push(a, b, d);
      if (iy !== SEGMENTS_H - 1) indices.push(b, c, d);
    }
  }

  return new Geometry3D({ positions, normals, uvs, indices: new Uint32Array(indices) });
}

export const scene: TestScene = {
  app: { backgroundColor: 0x14161c },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      environment: { skyColor: 0x8fa8c8, groundColor: 0x40382c, intensity: 0.35 },
      toneMapping: 'aces',
    });

    app.stage.addChild(view3d);

    const material = new Material3D({ baseColor: 0xcfd6de, metallic: 0.1, roughness: 0.28 });

    // Top: unit sphere, stretched by the transform.
    const scaled = new Mesh3D({
      geometry: ellipsoid([1, 1, 1], false),
      material,
      castShadow: false,
      receiveShadow: false,
    });

    scaled.scale.set(3, 1, 1);
    scaled.position.set(0, 1.6, 0);
    view3d.root.addChild(scaled);

    // Middle: same transform-driven stretch, but flat-shaded — the face normal
    // comes from screen-space derivatives of world position, so the model
    // matrix never touches it.
    const faceted = new Mesh3D({
      geometry: ellipsoid([1, 1, 1], false),
      material: new Material3D({ baseColor: 0xcfd6de, metallic: 0.1, roughness: 0.28, flatShading: true }),
      castShadow: false,
      receiveShadow: false,
    });

    faceted.scale.set(3, 1, 1);
    faceted.position.set(0, 0, 0);
    view3d.root.addChild(faceted);

    // Bottom: same shape, stretch baked into the vertices with true normals.
    const baked = new Mesh3D({
      geometry: ellipsoid([3, 1, 1], true),
      material,
      castShadow: false,
      receiveShadow: false,
    });

    baked.position.set(0, -1.6, 0);
    view3d.root.addChild(baked);

    const sun = new DirectionalLight({ color: 0xfff2e0, intensity: 3.4 });

    sun.position.set(4, 3, 5);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(sun);

    view3d.camera.position.set(0, 0, 9);
  },
};
