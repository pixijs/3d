import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { View3D } from '~/scene/View3D';

/**
 * `View3D.from` with nothing but a size: the avocado has no camera or light of its own, so
 * the default camera frames its bounds and the key light rides on the camera.
 */
export const scene: TestScene = {
  assets: ['avocado.glb'],
  create: async (app) => {
    const source = Assets.get<Scene3DSource>('avocado.glb');

    app.stage.addChild(View3D.from(source, { width: app.screen.width, height: app.screen.height }));
  },
};
