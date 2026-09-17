import { defineConfig } from 'tsdown';
import type { UserConfig } from 'tsdown';

import { inlineWorker } from './scripts/build/inline-worker.mts';
import { spawn } from './scripts/utils/spawn.mts';

const config: UserConfig = {
  entry: {
    index: './src/index.ts',
    'extras/index': './src/extras/index.ts',
    // Backend entries: the root entry lazy-loads them through renderer loader
    // extensions, and they are published as `@pixi/3d/webgl` / `@pixi/3d/webgpu`.
    'core/gl/init': './src/core/gl/init.ts',
    'core/gpu/init': './src/core/gpu/init.ts',
  },
  deps: {
    onlyBundle: [],
  },
  logLevel: 'warn',
  exports: {
    // The backend entries are published under the `./webgl` / `./webgpu` names
    // below, not their dist paths.
    exclude: ['core/gl/init', 'core/gpu/init'],
    customExports: {
      // Explicit `types` conditions so consumers resolve the declaration files
      // (and the global PixiMixins augmentations they carry) through `exports`.
      // The dts-less second build pass would otherwise regenerate "." without them.
      '.': {
        import: {
          types: './dist/index.d.ts',
          default: './dist/index.mjs',
        },
        require: {
          types: './dist/index.d.cts',
          default: './dist/index.js',
        },
      },
      './extras': {
        import: {
          types: './dist/extras/index.d.ts',
          default: './dist/extras/index.mjs',
        },
        require: {
          types: './dist/extras/index.d.cts',
          default: './dist/extras/index.js',
        },
      },
      './webgl': {
        import: {
          types: './dist/core/gl/init.d.ts',
          default: './dist/core/gl/init.mjs',
        },
        require: {
          types: './dist/core/gl/init.d.cts',
          default: './dist/core/gl/init.js',
        },
      },
      './webgpu': {
        import: {
          types: './dist/core/gpu/init.d.ts',
          default: './dist/core/gpu/init.mjs',
        },
        require: {
          types: './dist/core/gpu/init.d.cts',
          default: './dist/core/gpu/init.js',
        },
      },
    },
  },
  sourcemap: true,
  treeshake: false,
  unbundle: true,
  format: ['esm', 'cjs'],
  outExtensions: (context) => {
    if (context.format === 'es') {
      return { js: '.mjs', dts: '.d.ts' };
    }
    return { js: '.js', dts: '.d.cts' };
  },
  plugins: [inlineWorker()],
  platform: 'browser',
};

export default defineConfig([
  {
    ...config,
    dts: true,
  },
  {
    ...config,
    failOnWarn: true,
    dts: false,
    hooks: {
      'build:prepare': async () => {
        await spawn('node', ['scripts/build/index.mts', '--write']);
      },
    },
  },
]);
