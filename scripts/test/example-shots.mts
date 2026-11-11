/**
 * Visual tests for the examples: `npm run test:example-shots [-- <id>…] [--update] [--renderer webgl|webgpu]
 * [--workers <n>]`.
 *
 * Opens every `examples/<id>/index.ts` in the playground's scene frame, on WebGPU and on WebGL, in the theme the
 * example opens on, and compares a screenshot of the page with the example's `reference.png`. The page runs on
 * Playwright's fake clock, so the motion lands on the same frame in every run, and with reduced motion, so the loading
 * screen leaves at once; the shot comes `RUN_MS` after the example is up. A shot fails when more than `TOLERANCE` of
 * its pixels differ from the reference, or when the page logs an error or a warning, throws, reloads or fails a
 * request. A failure writes the expected, actual and diff images side by side to
 * `.pr_uploads/examples/<id>-<renderer>.png`. Every run keeps its shots in `.temp/example-shots/` and its results in
 * `.temp/example-shots.json`.
 *
 * Both renderers compare against the one reference, taken on WebGPU: the examples render the same on each, and the
 * tolerance absorbs the few pixels they don't. `--update` writes the WebGPU shot as the reference of each example
 * whose reference is missing or fails, and leaves passing references alone so a full update doesn't churn every PNG.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

import { resizeImage, saveFailureArtifact } from './compare-command.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const EXAMPLES = path.join(ROOT, 'examples');
const SHOTS = path.join(ROOT, '.temp/example-shots');
const DIFFS = path.join(ROOT, '.pr_uploads/examples');
const RENDERERS = ['webgpu', 'webgl'] as const;
/** The size the examples are laid out for; the pane sits in its top-right corner */
const VIEWPORT = { width: 1280, height: 720 };
/** The fraction of pixels a shot may differ from its reference by: run-to-run drift and WebGL against WebGPU */
const TOLERANCE = 0.005;
/** Wider tolerances for the examples that drift more */
const EXAMPLE_TOLERANCE: Record<string, number> = {
  // The wireframe's one-pixel lines cover the whole terrain, and WebGL rasterises them a little differently.
  geometry_custom: 0.02,
  // So do 100,000 shapes a pixel or two across.
  'instancing_batched-mesh': 0.015,
  // The video decodes in real time, so the frame it shows drifts by a few.
  materials_video: 0.02,
};
/** How far pixelmatch lets one pixel's colour drift before it counts as different */
const PIXEL_THRESHOLD = 0.1;
/**
 * Fake time the scene runs after it's up and before the shot: 30 frames, so the pane's read-only rows have refreshed
 * once (Tweakpane polls them every 200 ms) and anything a frame late has landed, while the picture is still the one
 * the example opens on
 */
const RUN_MS = 480;
const FRAME_MS = 16;
/**
 * The fake clock starts here and runs in real time while the page opens, then pauses a minute on, a time no slow open
 * passes
 */
const CLOCK_START = 1_700_000_000_000;
const CLOCK_PAUSE = CLOCK_START + 60_000;
/** Real time an example has to load its assets and come up */
const LOAD_TIMEOUT_MS = 60_000;

type Renderer = (typeof RENDERERS)[number];

/** What the page keeps for the runner: when the example came up, and the clock unrounded */
interface ExampleShot {
  start: number | null;
  now: () => number;
}

declare global {
  interface Window {
    exampleShot?: ExampleShot;
  }
}

interface ShotResult {
  id: string;
  renderer: Renderer;
  passed: boolean;
  /** Pixels that differ from the reference, or -1 when there was nothing to compare */
  diff: number;
  tolerance: number;
  problems: string[];
  /** Whether this shot was written as the reference */
  updated: boolean;
}

const args = process.argv.slice(2);
const update = args.includes('--update');
const rendererArg = valueOf('--renderer');
const workers = Number(valueOf('--workers') ?? Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2))));
const wanted = args.filter((arg, i) => !arg.startsWith('--') && !['--renderer', '--workers'].includes(args[i - 1]));
const renderers = RENDERERS.filter((renderer) => !rendererArg || renderer === rendererArg);

/**
 * The value after `flag` on the command line
 * @param flag - The flag, with its dashes.
 */
function valueOf(flag: string): string | undefined {
  const i = args.indexOf(flag);

  return i === -1 ? undefined : args[i + 1];
}

const all = fs
  .readdirSync(EXAMPLES)
  .filter((id) => fs.existsSync(path.join(EXAMPLES, id, 'index.ts')))
  .sort();
const unknown = wanted.filter((id) => !all.includes(id));

if (unknown.length) {
  console.error(`No example folder with an index.ts: ${unknown.join(', ')}`);
  process.exit(1);
}

const ids = wanted.length ? wanted : all;
// The playground serves the examples the way `npm start` does. Watching and hot reload are off, so nothing reloads a
// page mid-shot, and every example is scanned up front, so a dependency met late can't re-bundle and reload a page.
const server = await createServer({
  configFile: path.join(ROOT, 'playground/vite.config.ts'),
  root: path.join(ROOT, 'playground'),
  logLevel: 'warn',
  clearScreen: false,
  server: { port: 5190, hmr: false, watch: null },
  optimizeDeps: { entries: ['scene-frame.html', ...ids.map((id) => path.join(EXAMPLES, id, 'index.ts'))] },
});

await server.listen();

const origin = server.resolvedUrls!.local[0];

fs.mkdirSync(SHOTS, { recursive: true });
// Only this run's failures leave diffs.
fs.rmSync(DIFFS, { recursive: true, force: true });
const results: ShotResult[] = [];
const queue = [...ids];

console.log(`Shooting ${ids.length} examples on ${renderers.join(' and ')} with ${workers} browsers`);

/** Takes examples off the queue until it's empty, each in a fresh context of its own browser */
async function work(): Promise<void> {
  const browser = await chromium.launch({ args: ['--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });

  try {
    for (let id = queue.shift(); id; id = queue.shift()) {
      for (const renderer of renderers) {
        const result = await check(browser, id, renderer);

        results.push(result);
        report(result);
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Shoots `id` on `renderer` and checks the shot against its reference, writing the reference when updating
 * @param browser - The worker's browser.
 * @param id - The example's folder name.
 * @param renderer - The renderer to ask the example for.
 */
async function check(browser: Browser, id: string, renderer: Renderer): Promise<ShotResult> {
  const tolerance = EXAMPLE_TOLERANCE[id] ?? TOLERANCE;
  const result: ShotResult = { id, renderer, passed: false, diff: -1, tolerance, problems: [], updated: false };
  const referencePath = path.join(EXAMPLES, id, 'reference.png');
  let png: Buffer;

  try {
    png = await shoot(browser, id, renderer, result.problems);
    fs.writeFileSync(path.join(SHOTS, `${id}-${renderer}.png`), png);
  } catch (error) {
    result.problems.push(error instanceof Error ? error.message : String(error));

    return result;
  }

  const actual = PNG.sync.read(png);
  const limit = Math.floor(tolerance * actual.width * actual.height);
  const expected = fs.existsSync(referencePath) ? PNG.sync.read(fs.readFileSync(referencePath)) : null;
  let diffImage: PNG | null = null;

  if (expected) {
    const width = Math.max(actual.width, expected.width);
    const height = Math.max(actual.height, expected.height);

    diffImage = new PNG({ width, height });
    result.diff = pixelmatch(
      resizeImage(actual, width, height).data,
      resizeImage(expected, width, height).data,
      diffImage.data,
      width,
      height,
      { threshold: PIXEL_THRESHOLD },
    );
  }

  const matches = result.diff >= 0 && result.diff <= limit;

  // Only a clean WebGPU shot becomes a reference, so a broken page can't be written over a good one.
  if (update && renderer === 'webgpu' && !matches && !result.problems.length) {
    fs.writeFileSync(referencePath, png);
    result.updated = true;
  }
  result.passed = (matches || result.updated) && !result.problems.length;
  if (!expected && !result.updated) result.problems.push('no reference.png: run with --update to take one');
  if (!result.passed && expected && diffImage) {
    saveFailureArtifact(`${id}-${renderer}.png`, expected, actual, diffImage, 'examples');
  }

  return result;
}

/**
 * Opens `id` on `renderer`, runs it `RUN_MS` of fake time, and returns the page's screenshot as a PNG
 * @param browser - The worker's browser.
 * @param id - The example's folder name.
 * @param renderer - The renderer to ask the example for.
 * @param problems - Where the page's errors, warnings and failed requests go.
 */
async function shoot(browser: Browser, id: string, renderer: Renderer, problems: string[]): Promise<Buffer> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' });

  try {
    // The scene frame posts a throwing example as a message instead of logging it, so log it.
    await context.addInitScript(() => {
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'scene-error') console.error(`scene-error: ${event.data.message}`);
      });
    });
    await context.clock.install({ time: CLOCK_START });
    // The fake clock fires animation frames every 16 ms of its own time, but an example starts its ticker when its
    // downloads finish, in real time, anywhere between two frames, and pixi's ticker times its first frame from that
    // start. Rounding performance.now() down to the frame makes every frame 16 ms long, so the motion is the same in
    // every run. The page also notes the moment it came up: its canvas in, its loading screen gone.
    await context.addInitScript(() => {
      const now = performance.now.bind(performance);
      const shot: ExampleShot = { start: null, now };
      const observer = new MutationObserver(() => {
        if (!document.querySelector('canvas') || document.querySelector('.theme-load')) return;
        shot.start = performance.now();
        observer.disconnect();
      });

      performance.now = () => Math.floor(now() / 16) * 16;
      window.exampleShot = shot;
      observer.observe(document, { childList: true, subtree: true });
    });

    const page = await context.newPage();
    let loads = 0;

    await page.clock.pauseAt(CLOCK_PAUSE);
    page.on('load', () => loads++);
    page.on('console', (message) => {
      const type = message.type();

      if (type === 'error' || type === 'warning') problems.push(`console ${type}: ${message.text().slice(0, 500)}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 500)}`));
    page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${origin}scene-frame.html?type=example&id=${id}&renderer=${renderer}`, {
      waitUntil: 'load',
      timeout: LOAD_TIMEOUT_MS,
    });

    // Assets load in real time, so step the paused clock until the example is up. A load that fails leaves the
    // loading screen up with a note, so an error while loading ends the wait.
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    let clock = await readClock(page);

    while (clock.start === null) {
      if (problems.some((problem) => !problem.startsWith('console warning'))) throw new Error('never came up');
      if (Date.now() > deadline) throw new Error(`still loading after ${LOAD_TIMEOUT_MS / 1000} s`);
      await page.clock.runFor(FRAME_MS);
      await page.waitForTimeout(50);
      clock = await readClock(page);
    }
    // Then run it to `RUN_MS` after it came up, a frame at a time, with a moment of real time each frame so the GPU
    // keeps up and any readback the example waits on arrives.
    for (let left = clock.start + RUN_MS - clock.now; left > 0; left -= FRAME_MS) {
      await page.clock.runFor(Math.min(FRAME_MS, left));
      await page.waitForTimeout(4);
    }
    // The last frame reaches the screen in real time.
    await page.waitForTimeout(300);
    if (loads > 1) problems.push('the page reloaded during the shot');

    return await page.screenshot();
  } finally {
    await context.close();
  }
}

/**
 * When the example came up, if it has, and the fake clock's time now, unrounded
 * @param page - The example's page.
 */
async function readClock(page: Page): Promise<{ start: number | null; now: number }> {
  return page.evaluate(() => ({ start: window.exampleShot!.start, now: window.exampleShot!.now() }));
}

/**
 * Prints one line for a shot, and its problems under it
 * @param result - The shot's result.
 */
function report(result: ShotResult): void {
  const { id, renderer, passed, diff, tolerance, problems, updated } = result;
  const pixels = VIEWPORT.width * VIEWPORT.height;
  const share = diff < 0 ? 'no comparison' : `${diff} px (${((100 * diff) / pixels).toFixed(2)}%)`;
  const note = updated ? ', reference written' : passed ? '' : `, over ${(tolerance * 100).toFixed(2)}%`;

  console.log(`${passed ? 'pass' : 'FAIL'} ${id} ${renderer}: ${share}${note}`);
  for (const problem of problems) console.log(`     ${problem}`);
}

try {
  await Promise.all(Array.from({ length: Math.min(workers, ids.length) }, work));
} finally {
  await server.close();
}

const failed = results.filter((result) => !result.passed);

fs.mkdirSync(path.join(ROOT, '.temp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.temp/example-shots.json'), JSON.stringify(results, null, 2));
console.log(
  failed.length
    ? `\n${failed.length} of ${results.length} shots failed; diffs in .pr_uploads/examples/`
    : `\nAll ${results.length} shots passed`,
);
process.exit(failed.length ? 1 : 0);
