// Compiles small consumers of the built package with TypeScript 5, 6 and 7 and fails if
// the published declarations don't type-check on one of them. Each version takes its
// WebGPU types from a different place (`@webgpu/types` through pixi.js on 5, `lib.dom`
// on 6 and 7), so a declaration that resolves on the repo's compiler can still break a
// consumer's, and only a consumer program shows it. Run after `npm run build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawn } from '../utils/spawn.mts';

const root = process.cwd();
const dist = path.join(root, 'dist');

/** A TypeScript release to check the declarations against */
interface Compiler {
  /** Label used in the output */
  name: string;
  /** A release to install on the side; unset means the repo's own compiler */
  version?: string;
  /** Compiler options only this version understands */
  options?: Record<string, unknown>;
}

// The other releases are installed into directories of their own: every release names its
// binary `tsc`, so adding them as devDependencies would leave node_modules/.bin/tsc pointing
// at whichever npm linked last. They are invoked by path rather than through `npx -p
// typescript@X`, which hands back the locally installed compiler when one is present.
const ts5: Compiler = { name: 'ts5', version: '5.9.3' };
// node10 resolution is deprecated in TypeScript 6, but consumers still run it
const ts6: Compiler = { name: 'ts6', version: '6.0.3', options: { ignoreDeprecations: '6.0' } };
const ts7: Compiler = { name: 'ts7' };

/**
 * Where a compiler's package is installed
 * @param compiler - The compiler to locate
 */
const compilerDir = (compiler: Compiler): string =>
  compiler.version ? path.join(os.tmpdir(), `pixi-tsc-${compiler.version}`) : root;

/**
 * The `tsc` script to run for a compiler
 * @param compiler - The compiler to locate
 */
const tscPath = (compiler: Compiler): string => path.join(compilerDir(compiler), 'node_modules/typescript/bin/tsc');

/**
 * Installs a pinned release and checks it is the version that was asked for
 * @param compiler - The compiler to install
 */
async function ensureTypescript(compiler: Compiler): Promise<void> {
  const { version } = compiler;
  const dir = compilerDir(compiler);

  if (!version) return;

  if (!fs.existsSync(tscPath(compiler))) {
    console.log(`installing typescript@${version} to check the declarations against...`);
    fs.mkdirSync(dir, { recursive: true });
    await spawn('npm', ['install', '--prefix', dir, `typescript@${version}`, '--no-save', '--silent']);
  }

  const installed = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/typescript/package.json'), 'utf8')).version;

  if (installed !== version) {
    throw new Error(`expected typescript@${version} in ${dir}, found ${installed}`);
  }
}

/**
 * A module resolution mode to check under. `bundler` goes through the `exports` map and its
 * `types` conditions; `node10` goes through the `types` field. `node16` is left out: pixi.js's
 * CommonJS declarations import the ESM-only `earcut`, which reports TS1479 on every compiler.
 */
interface Resolution {
  /** Label used in the output */
  name: string;
  /** The `moduleResolution` and matching `module` values */
  moduleResolution: string;
  module: string;
  /** The compilers that still offer this mode */
  compilers: Compiler[];
}

const bundler: Resolution = {
  name: 'bundler',
  moduleResolution: 'bundler',
  module: 'esnext',
  compilers: [ts7, ts6, ts5],
};
// TypeScript 7 removed node10 resolution outright
const node10: Resolution = { name: 'node10', moduleResolution: 'node10', module: 'commonjs', compilers: [ts6, ts5] };

/** A consumer program for one published entry point */
interface Entry {
  /** Label used in the output */
  name: string;
  /** The program, one line per element */
  source: string[];
  /** Resolution modes it is checked under */
  resolutions: Resolution[];
}

const entries: Entry[] = [
  {
    name: 'root',
    source: [
      "import type { Model3D, View3D } from '@pixi/3d';",
      'export const view: View3D | null = null;',
      'export const model: Model3D | null = null;',
    ],
    resolutions: [bundler, node10],
  },
  // node10 ignores `exports`, so the subpaths only resolve through the bundler route
  {
    name: 'extras',
    source: ["import type { OrbitCamera } from '@pixi/3d/extras';", 'export const camera: OrbitCamera | null = null;'],
    resolutions: [bundler],
  },
  { name: 'webgl', source: ["import '@pixi/3d/webgl';"], resolutions: [bundler] },
  { name: 'webgpu', source: ["import '@pixi/3d/webgpu';"], resolutions: [bundler] },
];

/**
 * The published declarations must not carry a `/// <reference ... />` directive. A `types`
 * reference makes every consumer install that package (`@webgpu/types` also conflicts with
 * the WebGPU types built into TypeScript 6 and 7), and a `lib` reference overrides the
 * consumer's own `lib` setting.
 */
function checkDeclarationsAreClean(): void {
  const offenders = fs
    .readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) =>
        /\.d\.c?ts$/.test(file) && /^\s*\/\/\/\s*<reference\b/m.test(fs.readFileSync(path.join(dist, file), 'utf8')),
    );

  if (offenders.length > 0) {
    throw new Error(`these declarations carry a reference directive:\n  ${offenders.join('\n  ')}`);
  }
}

if (!fs.existsSync(path.join(dist, 'index.d.ts'))) {
  console.error('dist/ has no declarations; run `npm run build` first.');
  process.exit(1);
}

await Promise.all([ts5, ts6].map(ensureTypescript));
checkDeclarationsAreClean();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixi3d-check-dts-'));
const failures: string[] = [];

try {
  // The fixtures resolve `@pixi/3d` through a symlink into node_modules, so the package
  // `exports` map is exercised the way a real consumer hits it. pixi.js and everything else
  // resolve from the repo's own node_modules through the symlink's real path.
  fs.mkdirSync(path.join(tmpDir, 'node_modules/@pixi'), { recursive: true });
  fs.symlinkSync(root, path.join(tmpDir, 'node_modules/@pixi/3d'), 'dir');

  for (const entry of entries) {
    for (const resolution of entry.resolutions) {
      for (const compiler of resolution.compilers) {
        const label = `${entry.name} / ${resolution.name} / ${compiler.name}`;
        const dir = path.join(tmpDir, `${entry.name}-${resolution.name}-${compiler.name}`);
        const tsconfig = path.join(dir, 'tsconfig.json');

        fs.mkdirSync(dir);
        fs.writeFileSync(
          tsconfig,
          JSON.stringify(
            {
              compilerOptions: {
                target: 'es2020',
                module: resolution.module,
                moduleResolution: resolution.moduleResolution,
                strict: true,
                noEmit: true,
                skipLibCheck: false,
                // a side-effect import that fails to resolve is otherwise silently ignored
                noUncheckedSideEffectImports: true,
                ...compiler.options,
              },
              files: ['use.ts'],
            },
            null,
            2,
          ),
        );
        fs.writeFileSync(path.join(dir, 'use.ts'), `${entry.source.join('\n')}\n`);

        try {
          await spawn('node', [tscPath(compiler), '-p', tsconfig]);
          console.log(`  ${label}  ✓`);
        } catch {
          console.log(`  ${label}  ✗`);
          failures.push(label);
        }
      }
    }
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nDeclaration check failed on:\n${failures.map((label) => `  - ${label}`).join('\n')}`);
  process.exit(1);
}

console.log('\nDeclaration check passed.');
