import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Plane } from '~/math/shapes/Plane';
import { Vector3 } from '~/math/vector/Vector3';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * `Camera3D.clippingPlane`: an oblique half-space the camera renders nothing outside of.
 *
 * The plane replaces the projection's near plane (the standard oblique-frustum construction), so
 * the rasteriser does the cutting and it costs nothing per fragment. It is what a mirror or a
 * portal camera trims its scene with at the surface.
 *
 * The camera sits at the origin facing -Z, so its own space is world space and the plane's
 * numbers read directly. One plane crosses three spheres at increasing depth — the near one
 * keeps most of itself, the middle one is halved, the far one is down to a cap. Nothing closes
 * off behind the cut: back faces are culled, so a sliced sphere is hollow.
 *
 * The oblique construction puts the clipping plane at GL clip `z = -w`, the near face. On WebGPU
 * the bound projection is remapped to that backend's `[0, w]` range (`CameraData.set`), which is
 * what lets the cut land on its near face there too; this scene runs on both backends to prove it.
 */

/**
 * Kept: `normal · p + constant >= 0`, in camera space
 *
 * Tilted 60° off the view axis, so the cut reads as a slice rather than as objects popping in.
 * It cannot go much further: the construction replaces the *near* plane and stretches the depth
 * range from there to the far corner, so a plane facing sideways leaves a sliver of usable
 * depth and takes the scene with it.
 */
const CLIP_NORMAL = new Vector3(0, 0.866, -0.5);
const CLIP_CONSTANT = -2.25;

export const scene: TestScene = {
  app: {
    backgroundColor: 0x101418,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      environment: { skyColor: 0x8fa8c8, groundColor: 0x2b2418 },
    });
    app.stage.addChild(view3d);

    const key = new DirectionalLight({ color: 0xfff4e0, intensity: 3.5 });
    key.rotation.set(-0.7, 0.5, 0);
    key.rotationDirty = true;
    view3d.root.addChild(key);

    const sphereGeometry = new SphereGeometry({ radius: 1, widthSegments: 48, heightSegments: 32 });
    const spheres: [number, number, number, number][] = [
      [-1.0, 0.6, -4.0, 0xd2544b],
      [0.3, 0, -4.5, 0x4fae5b],
      [1.55, -0.6, -5.0, 0x4a76d2],
    ];
    for (const [x, y, z, color] of spheres) {
      const sphere = new Mesh3D({
        geometry: sphereGeometry,
        material: new Material3D({ baseColor: color, metallic: 0.05, roughness: 0.4 }),
      });
      sphere.position.set(x, y, z);
      view3d.root.addChild(sphere);
    }

    view3d.camera.fov = 55;
    view3d.camera.near = 0.1;
    view3d.camera.far = 100;
    view3d.camera.position.set(0, 0, 0);
    view3d.camera.clippingPlane = new Plane(CLIP_NORMAL, CLIP_CONSTANT);
  },
};
