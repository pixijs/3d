// Side-effect import: registers the View3D render pipes and the glTF/GLB/cubemap
// asset loaders. Scenes only import `~/...` submodules, so without this the
// visual-test runner would render with no pipe and fail to parse `.cubemap`/glTF
// assets (`src/index.ts` is what wires these up for the examples and vitest).
import '@pixi/3d';
import { Application, Assets } from 'pixi.js';

import type { TestScene } from '../../../tests/test-utils';
import type { RenderType } from '../types';

export async function runScene(scene: TestScene, rendererType: RenderType): Promise<HTMLCanvasElement> {
  const appOptions = scene.app ?? {};
  const width = appOptions.width ?? 256;
  const height = appOptions.height ?? 256;

  const app = new Application();

  await app.init({
    width,
    height,
    preference: rendererType === 'webgpu' ? 'webgpu' : 'webgl',
    ...appOptions,
  });

  await Assets.init({ basePath: '/test-assets/' });

  if (scene.assets) {
    await Assets.load(scene.assets);
  }

  await scene.create(app, {} as any);

  return app.canvas as HTMLCanvasElement;
}
