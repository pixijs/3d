import type { OutputChunk, Plugin } from 'rolldown';
import { defineConfig } from 'tsdown';
import type { UserConfig } from 'tsdown';

import pkg from './package.json' with { type: 'json' };
import { inlineWorker } from './scripts/build/inline-worker.mts';

// The CDN build: one bundled ESM entry plus the chunks it loads on demand, written
// into `dist/` next to the npm output so the published package carries it and any npm
// CDN (jsdelivr) serves it; `npm run dist` copies it into `.s3_uploads/` for the S3
// mirror. `pixi.js` stays a bare import for the page's import map; everything else is
// bundled.
//
// The entry is `src/index.ts`, the same as the npm build. A bundle exports its whole
// surface, which is why no barrel exports `core/gl/**` or `core/gpu/**`: each backend
// stays in the lazy chunk its renderer loader imports.
//
// `extras` is a second file, `pixi-3d-extras.mjs`, that a page imports next to the main
// one. It holds only `src/extras/**` and takes the engine as named imports from
// `./pixi-3d.mjs`, so the main file stays the same size and the engine ships once.
//
// Every chunk needs a stable name, keyed by the module that fronts it, so a page that
// cached `pixi-3d.mjs` can still fetch its lazy halves after a redeploy. A chunk that
// matches nothing fails the build rather than shipping under a name that changes with
// the code.
const CHUNK_NAMES: [test: RegExp, name: string][] = [
  [/[\\/]src[\\/]core[\\/]gl[\\/]init\.ts$/, 'webgl'],
  [/[\\/]src[\\/]core[\\/]gpu[\\/]init\.ts$/, 'webgpu'],
  [/[\\/]node_modules[\\/]meshoptimizer[\\/]/, 'meshopt'],
];

const SRC = /[\\/]src[\\/]/;
const EXTRAS = /[\\/]src[\\/]extras[\\/]/;
const BACKEND = /[\\/]src[\\/]core[\\/](gl|gpu)[\\/]/;
/** The modules that register the shared extensions; the entry chunk must run every one */
const ROOT_INITS = ['src/init.ts', 'src/assets/init.ts', 'src/events/init.ts'];

const endsWith = (file: string) => (id: string) => id.replaceAll('\\', '/').endsWith(`/${file}`);
/**
 * The ids of the chunk's modules that match and left code in the output
 * @param chunk - The output chunk to inspect
 * @param match - Predicate on module ids
 */
const rendered = (chunk: OutputChunk, match: (id: string) => boolean): string[] =>
  Object.entries(chunk.modules)
    .filter(([id, module]) => match(id) && module.renderedLength > 0)
    .map(([id]) => id);

/** Export surface of each engine file, keyed by the specifier the extras file imports it under */
const engineExports = new Map<string, Set<string>>();
/** The names each extras file imports from its engine file, keyed the same way */
const extrasImports = new Map<string, { file: string; names: string[] }>();

/**
 * The names a chunk imports from `specifier`, as its `import { a, b as c } from '<specifier>'` lists them
 * @param code - The chunk's generated code
 * @param specifier - The import specifier to look for
 */
function namedImports(code: string, specifier: string): string[] {
  const from = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names: string[] = [];
  for (const match of code.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${from}["']`, 'g'))) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Fails the build if the extras file imports a name its engine file does not export
 *
 * The engine entry leaves `core/gl` and `core/gpu` out, so an extras module that reaches into a
 * backend compiles to a named import the engine file cannot satisfy: a SyntaxError when the page
 * loads the extras file, not a build error. The two files come out of separate builds, so
 * whichever finishes second runs the comparison.
 * @param engine - The engine file's specifier, as the extras file imports it
 */
function checkEngineImports(engine: string): void {
  const exported = engineExports.get(engine);
  const imported = extrasImports.get(engine);
  if (!exported || !imported) return;

  const missing = imported.names.filter((name) => !exported.has(name));
  if (missing.length > 0) {
    throw new Error(
      `CDN extras layout check failed:\n  ${imported.file} imports [${missing.join(', ')}] which ${engine} does not export`,
    );
  }
}

/**
 * Fails the build if the chunk layout stops matching what the CDN promises. Both failure
 * modes are silent at runtime (a black frame and no error): backend code reaching the entry
 * through a re-export, or an `init.ts` tree-shaken to nothing because a `sideEffects` glob
 * stopped matching `src/`.
 */
function checkLayout(): Plugin {
  return {
    name: 'pixi3d-check-cdn-layout',
    generateBundle(_options, bundle) {
      const failures: string[] = [];
      let engine: string | undefined;

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (chunk.isEntry) {
          engine = `./${chunk.fileName}`;
          engineExports.set(engine, new Set(chunk.exports));
          if (rendered(chunk, (id) => BACKEND.test(id)).length > 0) {
            failures.push(`${chunk.fileName} bundles backend code upfront`);
          }
          for (const file of ROOT_INITS) {
            if (rendered(chunk, endsWith(file)).length === 0) {
              failures.push(`${chunk.fileName} lost the registrations in ${file}`);
            }
          }
        } else if (
          chunk.facadeModuleId &&
          BACKEND.test(chunk.facadeModuleId) &&
          rendered(chunk, endsWith('init.ts')).length === 0
        ) {
          failures.push(`${chunk.fileName} registers nothing`);
        }
      }

      if (failures.length > 0) throw new Error(`CDN layout check failed:\n  ${failures.join('\n  ')}`);
      if (engine) checkEngineImports(engine);
    },
  };
}

/**
 * Turns every runtime import that leaves `src/extras/` for the rest of `src/` into a
 * named import from the main CDN file, so the extras file carries no engine code and
 * the page runs one copy of the engine.
 * @param from - The main CDN file's specifier the imports are rewritten to
 */
function importEngine(from: string): Plugin {
  return {
    name: 'pixi3d-cdn-import-engine',
    resolveId: {
      filter: { id: /^\.\.?\// },
      async handler(source, importer, options) {
        if (!importer) return null;

        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });

        return resolved && SRC.test(resolved.id) && !EXTRAS.test(resolved.id) ? { id: from, external: true } : null;
      },
    },
  };
}

/**
 * Fails the build if the extras file stops being a thin add-on: it may render `src/extras/**`
 * and nothing else, and its imports must be exactly the main CDN file and `pixi.js`. Anything
 * else means engine code shipped twice, or an import the page's import map cannot serve. Every
 * name it takes from the main file must be one the main file exports (`checkEngineImports`).
 * @param engine - The main CDN file's specifier
 */
function checkExtrasLayout(engine: string): Plugin {
  const expected = [engine, 'pixi.js'].sort().join();

  return {
    name: 'pixi3d-check-cdn-extras-layout',
    generateBundle(_options, bundle) {
      const failures: string[] = [];

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        const outside = rendered(chunk, (id) => !EXTRAS.test(id));

        if (outside.length > 0) {
          failures.push(`${chunk.fileName} bundles code outside src/extras:\n    ${outside.join('\n    ')}`);
        }
        if ([...chunk.imports].sort().join() !== expected) {
          failures.push(`${chunk.fileName} imports [${chunk.imports.join(', ')}], expected [${engine}, pixi.js]`);
        }
        extrasImports.set(engine, { file: chunk.fileName, names: namedImports(chunk.code, engine) });
      }

      if (failures.length > 0) throw new Error(`CDN extras layout check failed:\n  ${failures.join('\n  ')}`);
      checkEngineImports(engine);
    },
  };
}

const banner = `/*!
 * @pixi/3d - v${pkg.version}
 * https://github.com/pixijs/pixi-3d
 * @pixi/3d is licensed under the MIT License.
 */`;

function cdn(minify: boolean): UserConfig[] {
  const ext = minify ? '.min.mjs' : '.mjs';
  const engine = `./pixi-3d${ext}`;
  const base: UserConfig = {
    outDir: 'dist',
    // The library build cleans `dist/`; this one only adds to it.
    clean: false,
    format: 'esm',
    platform: 'browser',
    minify,
    banner,
    sourcemap: true,
    dts: false,
    outExtensions: () => ({ js: ext }),
    outputOptions: {
      chunkFileNames: ({ facadeModuleId, name }) => {
        const chunkName = CHUNK_NAMES.find(([test]) => test.test(facadeModuleId ?? ''))?.[1];
        if (!chunkName) {
          throw new Error(
            `CDN chunk "${name}" (${facadeModuleId ?? 'shared between lazy chunks'}) has no stable name; ` +
              'add it to CHUNK_NAMES in tsdown.cdn.config.ts.',
          );
        }
        return `pixi-3d-${chunkName}${ext}`;
      },
    },
  };

  return [
    {
      ...base,
      entry: { 'pixi-3d': './src/index.ts' },
      deps: { alwaysBundle: [/^meshoptimizer(\/|$)/], onlyBundle: ['meshoptimizer'], onlyImport: ['pixi.js'] },
      plugins: [inlineWorker(), checkLayout()],
    },
    {
      ...base,
      entry: { 'pixi-3d-extras': './src/extras/index.ts' },
      deps: { onlyBundle: [], onlyImport: ['pixi.js'] },
      plugins: [importEngine(engine), checkExtrasLayout(engine)],
    },
  ];
}

export default defineConfig([...cdn(false), ...cdn(true)]);
