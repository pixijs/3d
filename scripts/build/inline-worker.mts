import path from 'node:path';

import { rolldown, RolldownMagicString } from 'rolldown';
import type { Plugin } from 'rolldown';

const WORKER_URL = /new URL\(\s*(['"])(\.{1,2}\/[^'"]+\.worker\.ts)\1\s*,\s*import\.meta\.url\s*\)/g;
const SUFFIX = '?worker&inline';

/**
 * Inlines workers for the tsdown builds. Source keeps the `new URL('./x.worker.ts',
 * import.meta.url)` idiom, which Vite serves as a classic worker in tests and the
 * playground. For published code the worker is bundled on its own, embedded as a
 * string, and the URL expression becomes a blob URL, so there is no worker file for a
 * consumer's bundler to resolve, and the worker still starts when the library is served
 * cross-origin from a CDN, which a file-based worker cannot do. The embedded string is
 * always minified: a consumer's minifier never touches string contents.
 */
export const inlineWorker = (): Plugin => ({
  name: 'pixi3d-inline-worker',
  transform: {
    filter: { code: /import\.meta\.url/ },
    handler(code) {
      const s = new RolldownMagicString(code);
      let count = 0;

      for (const match of code.matchAll(WORKER_URL)) {
        const name = `__pixi3dWorkerUrl${count++}`;

        s.prepend(`import ${name} from '${match[2]}${SUFFIX}';\n`);
        s.overwrite(match.index, match.index + match[0].length, `${name}()`);
      }

      return count > 0 ? { code: s } : null;
    },
  },
  resolveId: {
    filter: { id: /\?worker&inline$/ },
    handler(source, importer) {
      return importer && `${path.resolve(path.dirname(importer), source.slice(0, -SUFFIX.length))}${SUFFIX}`;
    },
  },
  load: {
    filter: { id: /\?worker&inline$/ },
    async handler(id) {
      const file = id.slice(0, -SUFFIX.length);

      // `transform` takes the worker out of the outer module graph, and the id that replaces it
      // carries a query and is not on disk, so watch mode only sees an edit to the worker if the
      // real file is registered here.
      this.addWatchFile(file);

      const build = await rolldown({ input: file, platform: 'browser' });

      try {
        const { output } = await build.generate({ format: 'iife', minify: true });

        return {
          moduleType: 'js',
          code: `const code = ${JSON.stringify(output[0].code)};
let url;
export default function workerUrl() {
  return (url ??= URL.createObjectURL(new Blob([code], { type: 'text/javascript;charset=utf-8' })));
}
`,
        };
      } finally {
        await build.close();
      }
    },
  },
});
