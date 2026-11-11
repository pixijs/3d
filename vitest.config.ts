import path from 'path';

import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

import { downloadAssets } from './scripts/assets/download-assets.mts';
import BrowserCommands from './scripts/test/compare-command.mts';
import generateSceneTests from './scripts/test/generate-scene-tests.mts';

export default defineConfig({
  server: {
    // Vite 8 auto-forwards browser console to the terminal when it detects an
    // agent/CI environment. `warn` is never forwarded: it's PixiJS/WebGPU spam
    // (visual pass/fail comes from pixelmatch, not logs), and at full volume
    // the forwarding traffic can kill playwright's transport mid-run
    // ("Unexpected end of JSON input"). CI keeps errors only; locally
    // log/info/debug still come through for test debugging.
    forwardConsole: process.env.GITHUB_ACTIONS
      ? { unhandledErrors: true, logLevels: ['error'] }
      : { unhandledErrors: true, logLevels: ['error', 'log', 'info', 'debug'] },
  },
  define: {
    // Browser tests run in Chromium — replace Node env reads at bundle time.
    'process.env.GITHUB_ACTIONS': JSON.stringify(process.env.GITHUB_ACTIONS ?? ''),
  },
  optimizeDeps: {
    exclude: ['pixi.js'],
    include: ['pixi.js > eventemitter3', 'parse-svg-path', '@xmldom/xmldom'],
  },
  publicDir: './examples/assets',
  plugins: [
    // Test scenes load remote assets from a local mirror; fill any gaps
    // before the run so isolated `npx vitest run` invocations work too.
    { name: 'download-assets', buildStart: () => downloadAssets() },
    generateSceneTests('./tests/scenes'),
    BrowserCommands(),
    {
      // pixi's `warn` permanently mutes after 500 calls per page. Test files
      // share a page (`isolate: false` below), so the suite's warning spam
      // would silence it before tests that assert `console.warn` fired get to
      // run. Serve a body that registers its counter with pixi's
      // GlobalResourceRegistry — the per-file `release()` in tests/setup.ts
      // rewinds it, making the cap per-file, matching what per-file iframes
      // used to give. The registry import must be relative (we're standing in
      // for a module inside pixi's lib; the barrel would be a cycle).
      // (A `resolveId` redirect doesn't work here: Vite 8 resolves imports
      // natively without consulting JS plugins.)
      name: 'pixi-warn-per-file-cap',
      transform(_code, id) {
        // Served ids carry a cache-busting query (`warn.mjs?v=<hash>`).
        if (!id.split('?')[0].endsWith('pixi.js/lib/utils/logging/warn.mjs')) return null;
        return `import { GlobalResourceRegistry } from '../pool/GlobalResourceRegistry.mjs';
        let count = 0;
        GlobalResourceRegistry.register({ clear: () => { count = 0; } });
        export function warn(...args) {
          if (++count > 500) return;
          if (count === 500) console.warn('PixiJS Warning: too many warnings, no more warnings will be reported to the console by PixiJS.');
          else console.warn('PixiJS Warning: ', ...args);
        }`;
      },
    },
  ],
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './src'),
      '@test-utils': path.resolve(import.meta.dirname, './tests/test-utils.ts'),
      // The published package names, resolved to the source, so code written the way
      // users import the package runs under the test harness.
      '@pixi/3d/extras': path.resolve(import.meta.dirname, './src/extras/index.ts'),
      '@pixi/3d': path.resolve(import.meta.dirname, './src/index.ts'),
    },
  },
  test: {
    name: 'browser',
    exclude: [...configDefaults.exclude, '.claude/**', '.context/**', '.pipeline/**', '.repos/**'],
    // Run test files in long-lived iframes instead of a fresh iframe per file.
    // A fresh iframe re-imports the whole src module graph (~390 files x full
    // graph dominated CI wall clock) and the context churn is what crashes
    // Chromium's GPU process on GitHub's macOS runners. Module state that
    // would otherwise leak across files is reset per file by tests/setup.ts
    // and the `pixi-warn-uncap` plugin above.
    isolate: false,
    // CI runners have 3 cores / 7GB; more parallel pages just thrash the
    // paravirtual GPU and memory.
    maxWorkers: process.env.GITHUB_ACTIONS ? 2 : undefined,
    setupFiles: ['./tests/setup.ts'],
    // Keeps every run's results after `| tail` has cut the terminal output.
    reporters: ['default', 'json'],
    outputFile: { json: '.temp/vitest-last.json' },
    // Second console channel: vitest's browser provider relays the page's
    // console to the terminal independently of Vite's forwardConsole. Drop it
    // in CI (PixiJS warning spam); failures still surface via the test reporter.
    onConsoleLog: () => (process.env.GITHUB_ACTIONS ? false : undefined),
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: ['--enable-gpu', '--enable-unsafe-webgpu'],
        },
      }),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
      ui: false,
      // Pin a viewport that fits inside Playwright's default page (1280x720) so
      // the orchestrator never CSS-scales the test iframe, AND is larger than the
      // 512x512 test canvas (see getApp) so the canvas is never laid out scaled.
      // Without this, vitest defaults to 414x896, which forces a
      // transform: scale(<1) on the iframe host and yields non-integer screenshot
      // dimensions that drift between runs/renderers (e.g. 206x206 vs 206x207).
      // Keep height <= 720: a taller viewport reintroduces the scale.
      viewport: { width: 800, height: 600 },
    },
  },
});
