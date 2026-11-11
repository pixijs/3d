# Tests

Tests run in real Chromium with WebGL and WebGPU enabled, not jsdom. Write them against the real DOM and GPU APIs; a mock that assumes Node or jsdom won't work here.

## Visual regression scenes

Each `tests/scenes/**/*.scene.ts` exports a `TestScene` that renders, screenshots, and pixel-matches against a reference image in `tests/snapshots/`. To add a scene, write only its `*.scene.ts`: on every run, a vitest plugin writes a gitignored `*.test.ts` wrapper beside each scene. `tests/test-utils.ts` documents every `TestScene` option. Builders that several scenes share live in `tests/scenes/helpers/`.

```ts
import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: { backgroundColor: 0xf4f1ea }, // optional: PixiJS Application options
  pixelMatch: 40, // optional: pixel tolerance for comparison
  skip: ['webgpu'], // optional: skip specific renderers, or `true` for all
  skipReason: 'Draws the rim black on WebGPU', // with `skip`: why, shown in the skipped test's title
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.95 }),
      material: new Material3D({ baseColor: 0x1f6f8b }),
    });

    view3d.root.addChild(sphere);
    view3d.camera.position.set(0, 0, 2.5);
  },
};
```

## Running one test

Run a single test file, scene or unit, by its full path.

```sh
npx vitest run --browser.headless tests/scenes/<name>.test.ts
```

Scenes in subfolders keep the folder, as in `tests/scenes/gltf/<name>.test.ts`. Pass the full path: vitest matches a bare name as a substring (`sphere` also picks up `hemisphere-light`, the gltf sphere scenes, and a unit test). `npm run test:visual` runs every scene, even with `-- <name>` after it, because vitest ORs the name with the script's `scenes` filter.

Every run also writes its full results to `.temp/vitest-last.json`, so a failure that `| tail` cut from the output is still there to read.

## Throwaway tests and pixel probes

A throwaway test, such as a repro, goes inside the checkout, for example in the `__tests__` folder beside the code it tests. Vitest and the `~` and `@test-utils` aliases reach only files under the repo root, so a test in a scratch folder outside it finds nothing to run. Delete it before you commit.

To see what your own code draws on each backend, screenshot its canvas from a throwaway test. `page.screenshot` saves `path` relative to the test file.

```ts
import { Application } from 'pixi.js';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

for (const preference of ['webgpu', 'webgl'] as const) {
  test(`my scene on ${preference}`, async () => {
    const app = new Application();

    await app.init({ preference });
    document.body.appendChild(app.canvas);
    expect(app.renderer.name).toBe(preference); // pixi falls back to another renderer when this one isn't available

    // build your scene on app.stage

    await page.screenshot({ path: `shots/my-scene-${preference}.png`, element: app.canvas });
    app.destroy({ removeView: true });
  });
}
```

In a test, `renderFrame` from `tests/test-utils.ts` renders one frame and returns the canvas's pixels. To read pixels from a saved PNG, such as a reference image or a diff, use `pngjs`'s `PNG.sync.read`, as `scripts/test/compare-command.mts` does. If your own tsconfig type-checks a file that imports `tests/test-utils.ts`, include `scripts/test/compare-command.mts` in it too: that file declares the browser commands the helpers call.

## Updating reference images

After an intended visual change, add `--update=true` to the single-scene command to regenerate that scene's references. `npm run test:update` regenerates them all.

## CI

CI runs the whole suite, with every visual scene on both backends. Two environment variables change a run:

- `GITHUB_ACTIONS=true` sets `isCI` (`tests/test-utils.ts`). Scenes with `skipCI` and `describe.skipIf(isCI)` blocks skip, and a scene left with `only` throws. These skips are for tests too GPU-heavy for CI's adapters, such as the shadow lifecycle suites, so they run only locally: run them after you change the code they cover. A test that fails on CI for any other reason has a bug to find.
- `CI=true` makes a missing reference image fail the scene, where a local run writes it.

## When a scene fails

- **Look at the diff image first.** A failing scene writes `.pr_uploads/visual/<name>.scene.ts-<webgl|webgpu>.png`, with the expected, actual and diff images side by side. Read it before changing code or references.
- **CI keeps its own copy.** Each failed CI shard uploads the same folder as a `visual-diffs-<shard>` artifact: `gh run download <run-id> -p 'visual-diffs-*'` fetches them all, with the run id from `gh run list -b <branch>`.
- **Drift seen only on CI** (a few hundred pixels, and the scene passes locally) comes from CI's GPU, so regenerating the reference locally changes nothing. Raise that scene's `pixelMatch` just past CI's count instead.
- **`[BindGroup]` warnings** that a 'textureSource' or 'textureSampler' was destroyed while still bound come from pixi, on WebGPU, when a test destroys a `RenderTexture` a pixi `Sprite` drew. pixi's 2D batcher keeps its bind group, and no teardown order avoids the warning.
- **A timeout while other runs share the machine** (another checkout's tests, or a `benchy` run) is GPU contention. Rerun that scene alone with the single-scene command before you treat it as a failure.

## Remote assets

Remote models are declared in `examples/assets/manifest.ts` and loaded by typed dotted name, such as `model('gltf.Box')`. To use a new one, add it to the manifest; the next test run downloads it. The headers of the manifest and `scripts/assets/download-assets.mts` explain the mirror's layout and where it's stored.
