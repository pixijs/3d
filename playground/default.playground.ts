import type { Scene3DSource } from '@pixi/3d';
import { DirectionalLight, Model3D, View3D } from '@pixi/3d';
import { Application, Assets } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference });
  document.body.appendChild(app.canvas);

  await Assets.init({ basePath: '/test-assets/' });
  await Assets.load('avocado.glb');

  const source = Assets.get<Scene3DSource>('avocado.glb');
  const model = new Model3D(source);

  model.scale.set(10, 10, 10);
  model.position.set(0, -0.21, 0);

  const view3d = new View3D({ width: app.screen.width, height: app.screen.height, shadowQuality: 'high' });

  app.stage.addChild(view3d);
  view3d.root.addChild(model);

  const light = new DirectionalLight({ color: 0xffffff, intensity: 10 });

  view3d.root.addChild(light);

  view3d.camera.position.set(0, 0, 1);
}
