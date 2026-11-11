import { Material3D, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import { Application, Assets } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * PR #703: an `.hdr` panorama loaded as an HDR environment and background
 *
 * The camera orbits a row of metal spheres, roughness 0 to 1, that reflect the sky behind them.
 *
 * What to look for:
 *
 * - The reflections line up with the sky, including the low sun, as the camera turns.
 * - The mirror sphere shows the sun hot white, and the rough spheres blur it to a soft glow with no
 *   speckles.
 *
 * Compare `renderer=webgpu` with `renderer=webgl`.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference });
  document.body.appendChild(app.canvas);

  const sky = await Assets.load<CubeTexture>('/mirror/hdri/VeniceSunset.hdr');

  const view3d = new View3D({ autoResize: true, toneMapping: 'aces' });

  view3d.environment = sky;
  view3d.background = sky;
  app.stage.addChild(view3d);

  const geometry = new SphereGeometry({ radius: 0.45, widthSegments: 48, heightSegments: 32 });
  const roughnessSteps = [0, 0.25, 0.5, 0.75, 1];

  for (let i = 0; i < roughnessSteps.length; i++) {
    const mesh = new Mesh3D({
      geometry,
      material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: roughnessSteps[i] }),
      castShadow: false,
      receiveShadow: false,
    });

    mesh.position.set(0, 0, (i - 2) * 1.05);
    view3d.root.addChild(mesh);
  }

  let angle = 0;

  app.ticker.add((ticker) => {
    angle += ticker.deltaMS * 0.00015;
    view3d.camera.position.set(Math.cos(angle) * 4.2, 0, Math.sin(angle) * 4.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  });
}
