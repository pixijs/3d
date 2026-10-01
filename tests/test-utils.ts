import '../src/index.ts';
import { Application, Assets } from 'pixi.js';
import type { ApplicationOptions, Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, test, vi } from 'vitest';
import type { TestContext } from 'vitest';
import { page, server } from 'vitest/browser';

export interface TestScene {
  assets?: string | string[];
  app?: Partial<ApplicationOptions>;
  pixelMatch?: number;
  /** WebGPU-only tolerance override; falls back to `pixelMatch`. Keeps the deterministic WebGL guard tight while absorbing WebGPU shading drift. */
  pixelMatchWebgpu?: number;
  /** `true` skips both renderers; an array skips only the listed renderers (known-failing on those backends). */
  skip?: boolean | ('webgl' | 'webgpu')[];
  skipCI?: boolean;
  only?: boolean;
  delay?: number;
  create: (app: Application, context: TestContext) => Promise<void>;
}

/** Whether the tests run on GitHub Actions, whose GPU adapters are too unreliable for GPU-heavy tests */
export const isCI = process.env.GITHUB_ACTIONS === 'true';

/**
 * Runs `run` with `console.warn` silenced and returns what it warned, one string per call
 * (pixi's `warn` logs `('PixiJS Warning: ', message)`, so each call's arguments are joined).
 */
export function captureWarnings(run: () => void): string[] {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    run();
    return spy.mock.calls.map((args) => args.join(' '));
  } finally {
    spy.mockRestore();
  }
}

/**
 * Renders one frame and fails the test if WebGPU raised a validation error while drawing it.
 * WebGPU reports a bad submit (a destroyed buffer, a stale bind group) as an error on the
 * device rather than a throw, so without this a broken frame passes. No-op check on WebGL.
 */
export async function expectCleanRender(app: Application<Renderer>): Promise<void> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;
  if (!device) {
    app.render();
    return;
  }

  device.pushErrorScope('validation');
  app.render();
  const error = await device.popErrorScope();
  expect(error?.message ?? null).toBe(null);
}

interface GetAppOptions {
  assets?: string | string[];
  id: string;
  appOptions: Partial<ApplicationOptions>;
}
export async function getApp<T extends Renderer>(options: GetAppOptions): Promise<Application<T>> {
  const { assets, id, appOptions } = options;
  const app = new Application<T>();
  await app.init({ width: 512, height: 512, ...appOptions });
  if (assets) {
    await Assets.load(assets);
  }

  document.body.appendChild(app.canvas);
  app.canvas.setAttribute('alt', `pixi-canvas-${id}`);

  return app;
}

/**
 * RGBA bytes of the canvas as it was last presented, taken through a 2D copy so it works on
 * both backends. `renderer.extract.pixels` renders the scene again, which hides anything that
 * only reaches the GPU a frame late; this returns the frame the tested render actually drew.
 * Reads the whole canvas unless a region is given.
 */
export function readCanvasPixels(
  canvas: HTMLCanvasElement,
  x = 0,
  y = 0,
  width = canvas.width,
  height = canvas.height,
): Uint8ClampedArray {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(x, y, width, height).data;
}

/** Every error WebGPU reports for `code`, as `line:column message` */
export async function wgslCompilationErrors(device: GPUDevice, code: string): Promise<string[]> {
  device.pushErrorScope('validation');
  const info = await device.createShaderModule({ code }).getCompilationInfo();
  const scoped = await device.popErrorScope();
  const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);

  if (scoped) errors.push(scoped.message);

  return errors;
}

async function compareScreenshot(
  data: Pick<TestScene, 'pixelMatch' | 'delay'> & { path: string; id: string; rendererType: string },
) {
  const delay = data.delay ?? 0;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const screenshot = `./.temp/${data.path}-${data.rendererType}.png`;

  await page.screenshot({ path: screenshot, element: page.getByAltText(`pixi-canvas-${data.id}`) });
  const res = await server.commands.compareScreenshot(screenshot, data.pixelMatch);

  await server.commands.removeFile(screenshot);
  if (res.diff > 0 && data.pixelMatch) {
    expect(res.diff).toBeLessThan(data.pixelMatch);
  } else {
    expect(res.result).toBe(true);
  }
}

const RENDERERS = ['webgl', 'webgpu'] as const;
type RendererType = (typeof RENDERERS)[number];

function isSkipped(skip: TestScene['skip'], renderer: RendererType): boolean {
  return Array.isArray(skip) ? skip.includes(renderer) : Boolean(skip);
}

/**
 * Registers the webgl + webgpu visual-test cases for a single scene.
 *
 * Each `*.scene.ts` is paired with a generated `*.test.ts` wrapper that calls
 * this once. One scene per file is what gives the suite file-level parallelism
 * across vitest's browser pages. Files share a page's module graph
 * (`isolate: false`), so every test must tear down its own app and reset the
 * global pixi `Assets` singleton — see the `finally` below.
 *
 * `name` is the original scene basename (e.g. `cube.scene.ts`); it is the
 * snapshot key, so wrappers must keep the `.scene.ts` suffix to match the
 * committed reference images in `tests/snapshots/`.
 */
export function defineSceneTests(name: string, scene: TestScene): void {
  if (isCI && scene.only) {
    throw new Error(`only: true should not be committed to the repo. Please remove from ${name}`);
  }

  describe('Visual Tests', () => {
    RENDERERS.forEach((renderer) => {
      // Scenes (or specific renderers) flagged via `skip` are known-failing; each scene notes why beside its `skip`.
      // WebGPU is skipped in CI: GitHub-hosted runners expose only a paravirtual Metal / software adapter whose
      // rendering diverges from the bare-metal reference snapshots, so its visual diffs are unreliable. WebGL stays
      // as the deterministic CI guard; WebGPU still runs locally on real hardware.
      const skipped =
        isSkipped(scene.skip, renderer) || (isCI && Boolean(scene.skipCI)) || (isCI && renderer === 'webgpu');
      const runner = scene.only ? test.only : skipped ? test.skip : test;

      // Remote glTF models can be multi-MB; allow generous time for the network fetch.
      runner(`${name} - ${renderer}`, { timeout: 30000 }, async (context) => {
        const app = await getApp({
          appOptions: {
            ...scene.app,
            preference: renderer,
            hello: true,
          },
          assets: scene.assets,
          id: context.task.id,
        });

        try {
          await scene.create(app, context);

          // Force one synchronous, fully-resident frame so the screenshot can't race the throttled rAF ticker
          // for a complete draw (headless Chromium throttles rAF; a heavy scene can otherwise be captured mid-
          // build as a black/untextured frame). The ticker stays running (autoStart) so WebGPU's swapchain still
          // presents this frame to the canvas — present is rAF-driven and a lone render outside it stays black.
          app.render();

          const webgpuMatch = renderer === 'webgpu' ? scene.pixelMatchWebgpu : undefined;
          const pixelMatch = webgpuMatch ?? scene.pixelMatch ?? 100;

          await compareScreenshot({
            path: name,
            id: context.task.id,
            rendererType: renderer,
            pixelMatch,
            delay: scene.delay ?? 10,
          });
        } finally {
          // Tests share an iframe, so a failure must not leak its app, canvas,
          // or loaded assets into the scenes that run after it.
          app.destroy();
          Assets.reset();
        }
      });
    });
  });
}
