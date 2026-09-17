import type { TestScene } from '@test-utils';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Pure NORMAL-delta morph proof: a camera-facing quad whose single target has
 * zero position deltas and per-vertex normal deltas tilting the left edge left
 * and the right edge right. At weight 1 the silhouette is identical to the
 * base pose, but with a side light the shading becomes a clear dark→bright
 * gradient — only the `|morphN` variant can produce it, on both backends
 * (each keeps its own reference image).
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x1e2024,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    // Quad in the XY plane facing +Z: v0 bottom-left, v1 bottom-right,
    // v2 top-right, v3 top-left.
    const geometry = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      morphTargets: [
        {
          positions: new Float32Array(12),
          // Left vertices tilt toward -X, right vertices toward +X; the quad
          // itself never moves.
          normals: new Float32Array([-1.2, 0, -0.4, 1.2, 0, -0.4, 1.2, 0, -0.4, -1.2, 0, -0.4]),
        },
      ],
    });

    const mesh = new Mesh3D({
      geometry,
      material: new Material3D({ baseColor: 0xc8b89a, metallic: 0, roughness: 0.6 }),
      castShadow: false,
      receiveShadow: false,
      weights: new Float32Array([1]),
    });
    view3d.root.addChild(mesh);

    // Side light from the right: morphed normals face it on the right half
    // (bright) and away on the left (dark).
    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });
    light.rotation.set(0, -1.1, 0);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.8);
  },
};
