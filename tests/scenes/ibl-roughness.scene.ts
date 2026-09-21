import type { TestScene } from '@test-utils';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/** Creates a high-frequency checker face that makes prefilter blur easy to see. */
function checkerFace(r: number, g: number, b: number): Texture {
  const size = 64;
  const cell = 8;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      const i = (y * size + x) * 4;
      data[i] = on ? r : 8;
      data[i + 1] = on ? g : 8;
      data[i + 2] = on ? b : 8;
      data[i + 3] = 255;
    }
  }
  return new Texture({
    source: new BufferImageSource({
      resource: data,
      format: 'rgba8unorm',
      width: size,
      height: size,
      alphaMode: 'premultiply-alpha-on-upload',
    }),
  });
}

/**
 * Checks roughness-driven prefiltered mip selection
 *
 * Five metal spheres have roughness values from 0 to 1 and use only a checkerboard
 * cubemap for lighting. Every lit pixel comes from `sampleEnvironment`. A working
 * mip chain changes from sharp checkers to a flat colour across the row. A broken
 * chain produces five identical mirrors or black spheres.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x000000,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const faces = {
      right: checkerFace(255, 60, 60),
      left: checkerFace(60, 255, 255),
      top: checkerFace(80, 255, 100),
      bottom: checkerFace(255, 80, 255),
      front: checkerFace(80, 130, 255),
      back: checkerFace(255, 230, 80),
    };
    const environment = CubeTexture.from({ faces });
    view3d.environment = environment;

    const geometry = new SphereGeometry({ radius: 0.45, widthSegments: 48, heightSegments: 32 });
    app.stage.once('destroyed', () => {
      view3d.environment = null;
      view3d.destroy({ children: true, material: true });
      geometry.destroy(true);
      environment.destroy(true);
      for (const face of Object.values(faces)) face.destroy(true);
    });

    const roughnessSteps = [0, 0.25, 0.5, 0.75, 1];
    for (let i = 0; i < roughnessSteps.length; i++) {
      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: roughnessSteps[i] }),
        castShadow: false,
        receiveShadow: false,
      });
      mesh.position.set((i - 2) * 1.05, 0, 0);
      view3d.root.addChild(mesh);
    }

    view3d.camera.position.set(0, 0, 4.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
