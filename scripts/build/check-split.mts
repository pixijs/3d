// oxlint-disable no-console
// Bundles three tiny consumers of the built package with rolldown and asserts
// that the WebGL and WebGPU backends stay out of the code a page loads upfront
// unless it imports `@pixi/3d/webgl` / `@pixi/3d/webgpu` itself. Run after
// `npm run build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rolldown } from 'rolldown';
import type { OutputChunk, Plugin } from 'rolldown';

const dist = path.resolve(process.cwd(), 'dist');

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
  check: (upfront: OutputChunk[], lazy: OutputChunk[]) => string[];
}

const hasAny = (chunks: OutputChunk[], id: string): boolean => chunks.some((chunk) => chunk.code.includes(id));
const onlyOne = (chunks: OutputChunk[], present: string, absent: string): boolean =>
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
  name: 'pixi3d-dist-alias',
  resolveId: (id) => alias[id] ?? null,
};

async function bundle(entryFile: string): Promise<OutputChunk[]> {
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

/**
 * The entry plus every chunk it imports statically, transitively: what a page loads before the entry runs
 * @param entry - The entry chunk to start from
 * @param chunks - Every chunk in the build output
 */
function upfrontChunks(entry: OutputChunk, chunks: OutputChunk[]): Set<OutputChunk> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const upfront = new Set<OutputChunk>();
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixi3d-check-split-'));
const failures: string[] = [];

try {
  for (const { name, source, check } of cases) {
    const entryFile = path.join(tmpDir, `${name}.mjs`);

    fs.writeFileSync(entryFile, source);

    const chunks = await bundle(entryFile);
    const entry = chunks.find((chunk) => chunk.isEntry);

    if (!entry) {
      failures.push(`${name}: no entry chunk emitted`);
      continue;
    }

    const upfront = upfrontChunks(entry, chunks);

    console.log(`\n${name}`);
    for (const chunk of chunks) {
      const bytes = Buffer.byteLength(chunk.code).toLocaleString('en-US').padStart(11);
      const role = chunk === entry ? 'entry' : upfront.has(chunk) ? 'upfront' : 'lazy';

      console.log(`  ${bytes} B  ${role.padEnd(7)}  ${chunk.fileName}`);
    }

    const lazy = chunks.filter((chunk) => !upfront.has(chunk));

    failures.push(...check([...upfront], lazy).map((message) => `${name}: ${message}`));
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nBundle split check failed:\n${failures.map((message) => `  - ${message}`).join('\n')}`);
  process.exit(1);
}

console.log('\nBundle split check passed.');
