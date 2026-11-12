// Bundles three tiny consumers of the built package with rolldown and esbuild and
// asserts that the WebGL and WebGPU backends stay out of the code a page loads
// upfront unless it imports `@pixi/3d/webgl` / `@pixi/3d/webgpu` itself. Run after
// `npm run build`.
//
// The two bundlers split code differently. Rolldown places a module after dropping
// unused code; esbuild (like Turbopack) places it by the static imports alone, so a
// backend module that any barrel imports loads upfront there even when rolldown
// keeps it lazy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as esbuild from 'esbuild';
import { rolldown } from 'rolldown';
import type { OutputChunk, Plugin } from 'rolldown';

const dist = path.resolve(process.cwd(), 'dist');

/** One output file of a bundle, in the shape both bundlers can report */
interface Chunk {
  fileName: string;
  code: string;
  /** The chunks this one imports statically */
  imports: string[];
  isEntry: boolean;
}

const alias: Record<string, string> = {
  '@pixi/3d': path.join(dist, 'index.mjs'),
  '@pixi/3d/webgl': path.join(dist, 'core/gl/init.mjs'),
  '@pixi/3d/webgpu': path.join(dist, 'core/gpu/init.mjs'),
};

/** Identifiers only the backend modules define; none may load upfront on the lazy path */
const BACKEND_ONLY = [
  'View3DPipeGl',
  'View3DPipeGpu',
  'MaterialSystemGl',
  'MaterialSystemGpu',
  'compileGlslSource',
  'compileWgslSource',
];

interface Case {
  name: string;
  source: string;
  /** Returns one message per failed assertion; `upfront` is the entry plus its static imports, `lazy` the rest */
  check: (upfront: Chunk[], lazy: Chunk[]) => string[];
}

const hasAny = (chunks: Chunk[], id: string): boolean => chunks.some((chunk) => chunk.code.includes(id));
const onlyOne = (chunks: Chunk[], present: string, absent: string): boolean =>
  hasAny(chunks, present) && !hasAny(chunks, absent);

const cases: Case[] = [
  {
    name: 'auto',
    source: "import { View3D } from '@pixi/3d'; console.log(View3D);",
    check(upfront, lazy) {
      const failures: string[] = [];

      for (const id of ['loadGltf', 'addUniformParsers']) {
        if (!hasAny(upfront, id)) failures.push(`the ${id} side effect was dropped`);
      }
      for (const id of BACKEND_ONLY) {
        if (hasAny(upfront, id)) failures.push(`backend-only ${id} loads upfront`);
      }
      if (!lazy.some((chunk) => onlyOne([chunk], 'View3DPipeGl', 'View3DPipeGpu'))) {
        failures.push('no lazy chunk holds the WebGL backend on its own');
      }
      if (!lazy.some((chunk) => onlyOne([chunk], 'View3DPipeGpu', 'View3DPipeGl'))) {
        failures.push('no lazy chunk holds the WebGPU backend on its own');
      }

      return failures;
    },
  },
  {
    name: 'webgl-static',
    source: "import { View3D } from '@pixi/3d'; import '@pixi/3d/webgl'; console.log(View3D);",
    check: (upfront) => (onlyOne(upfront, 'View3DPipeGl', 'View3DPipeGpu') ? [] : ['upfront code is not WebGL-only']),
  },
  {
    name: 'webgpu-static',
    source: "import { View3D } from '@pixi/3d'; import '@pixi/3d/webgpu'; console.log(View3D);",
    check: (upfront) => (onlyOne(upfront, 'View3DPipeGpu', 'View3DPipeGl') ? [] : ['upfront code is not WebGPU-only']),
  },
];

const aliasPlugin: Plugin = {
  name: 'pixijs-3d-dist-alias',
  resolveId: (id) => alias[id] ?? null,
};

const esbuildAliasPlugin: esbuild.Plugin = {
  name: 'pixijs-3d-dist-alias',
  setup(build) {
    build.onResolve({ filter: /^@pixi\/3d(\/webgl|\/webgpu)?$/ }, (args) => ({ path: alias[args.path] }));
  },
};

async function bundleRolldown(entryFile: string): Promise<OutputChunk[]> {
  const build = await rolldown({
    input: entryFile,
    external: ['pixi.js', /^meshoptimizer(\/|$)/],
    plugins: [aliasPlugin],
    logLevel: 'silent',
  });

  try {
    // Comments are dropped so a doc mention of a backend class can't pass for its code.
    const { output } = await build.generate({ format: 'esm', minify: false, comments: false });

    return output.filter((item): item is OutputChunk => item.type === 'chunk');
  } finally {
    await build.close();
  }
}

async function bundleEsbuild(entryFile: string): Promise<Chunk[]> {
  const workingDir = path.dirname(entryFile);
  const result = await esbuild.build({
    absWorkingDir: workingDir,
    entryPoints: [entryFile],
    outdir: `esbuild-${path.basename(entryFile, '.mjs')}`,
    bundle: true,
    splitting: true,
    format: 'esm',
    // Strips comments, as `comments: false` does for rolldown; identifiers keep their names.
    minifyWhitespace: true,
    write: false,
    metafile: true,
    external: ['pixi.js', 'meshoptimizer', 'meshoptimizer/*'],
    plugins: [esbuildAliasPlugin],
    logLevel: 'silent',
  });
  const entryPoint = path.relative(workingDir, entryFile);

  return result.outputFiles
    .filter((file) => file.path.endsWith('.js'))
    .map((file) => {
      const fileName = path.relative(workingDir, file.path);
      const meta = result.metafile.outputs[fileName];

      return {
        fileName,
        code: file.text,
        imports: meta.imports.filter((item) => item.kind === 'import-statement').map((item) => item.path),
        isEntry: meta.entryPoint === entryPoint,
      };
    });
}

const bundlers: Record<string, (entryFile: string) => Promise<Chunk[]>> = {
  rolldown: bundleRolldown,
  esbuild: bundleEsbuild,
};

/**
 * The entry plus every chunk it imports statically, transitively: what a page loads before the entry runs
 * @param entry - The entry chunk to start from
 * @param chunks - Every chunk in the build output
 */
function upfrontChunks(entry: Chunk, chunks: Chunk[]): Set<Chunk> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const upfront = new Set<Chunk>();
  const pending = [entry];

  for (let chunk = pending.pop(); chunk; chunk = pending.pop()) {
    if (upfront.has(chunk)) continue;
    upfront.add(chunk);
    for (const name of chunk.imports) {
      const dep = byName.get(name);

      if (dep) pending.push(dep);
    }
  }

  return upfront;
}

// esbuild reports real paths, and macOS's temp dir sits behind a symlink.
const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pixijs-3d-check-split-')));
const failures: string[] = [];

try {
  for (const { name, source, check } of cases) {
    const entryFile = path.join(tmpDir, `${name}.mjs`);

    fs.writeFileSync(entryFile, source);

    for (const [bundler, bundle] of Object.entries(bundlers)) {
      const label = `${bundler} ${name}`;
      const chunks = await bundle(entryFile);
      const entry = chunks.find((chunk) => chunk.isEntry);

      if (!entry) {
        failures.push(`${label}: no entry chunk emitted`);
        continue;
      }

      const upfront = upfrontChunks(entry, chunks);

      console.log(`\n${label}`);
      for (const chunk of chunks) {
        const bytes = Buffer.byteLength(chunk.code).toLocaleString('en-US').padStart(11);
        const role = chunk === entry ? 'entry' : upfront.has(chunk) ? 'upfront' : 'lazy';

        console.log(`  ${bytes} B  ${role.padEnd(7)}  ${chunk.fileName}`);
      }

      const lazy = chunks.filter((chunk) => !upfront.has(chunk));

      failures.push(...check([...upfront], lazy).map((message) => `${label}: ${message}`));
    }
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nBundle split check failed:\n${failures.map((message) => `  - ${message}`).join('\n')}`);
  process.exit(1);
}

console.log('\nBundle split check passed.');
