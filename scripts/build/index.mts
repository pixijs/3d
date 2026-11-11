import fs from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';

const directoryPath = path.join(process.cwd(), './src');
const command = process.argv[2];

if (command !== '--check' && command !== '--write') {
  console.error(`ERROR: Invalid command. Use '--check' or '--write'.`);
  process.exit(1);
}

/**
 * The backend folders. Each gets its own barrel, which its `init.ts` re-exports as `@pixi/3d/webgl`
 * or `@pixi/3d/webgpu`, and no other barrel exports their files. `src/init.ts` loads each `init.ts`
 * lazily; a folder barrel that also imported a backend would put it on the entry's static graph, and
 * esbuild and Turbopack then load both backends upfront.
 */
const BACKENDS = ['gl', 'gpu'];

/**
 * Whether a file sits in a backend folder
 * @param file - Source file path
 */
const isBackend = (file: string): boolean => BACKENDS.some((backend) => file.startsWith(`${backend}/`));

function writeBarrel(directory: string, name: string, files: string[]): void {
  const output = [
    '// Auto-generated code, do not edit manually',
    ...files.map((file) => `export * from './${file.replace(/\.ts$/, '')}';`),
    '',
  ].join('\n');
  const filePath = path.join(directory, name);
  const localFile = path.relative(process.cwd(), filePath);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

  if (existing === output) return;

  if (command === '--check') {
    console.error(
      `ERROR: File ${localFile} is out of date, run 'node scripts/build/index.mts --write' to update it.\n`,
    );
    process.exit(1);
  }
  console.log(`Updating ${localFile}`);
  fs.writeFileSync(filePath, output, 'utf-8');
}

// find all directories in src, except the guides that span modules
const directories = glob.sync('*/', { cwd: directoryPath, absolute: true, ignore: '__docs__/' });

// Use glob to find all TypeScript files recursively in the directory
directories.forEach((directory) => {
  const files = glob
    .sync('**/!(*.d).ts', {
      cwd: directory,
      ignore: [
        '**/init.ts',
        // these shouldn't be exported as the webworker plugin will handle them
        '**/*.worker.ts',
        // Ignore circular imports
        '**/index.ts',
        // Tests
        '**/__tests__/**',
        // Docs / examples (internal only, not part of public API)
        '**/__docs__/**',
      ],
    })
    .sort((a, b) => a.localeCompare(b));

  writeBarrel(
    directory,
    'index.ts',
    files.filter((file) => !isBackend(file)),
  );
  for (const backend of BACKENDS) {
    const backendFiles = files.filter((file) => file.startsWith(`${backend}/`));

    if (backendFiles.length > 0) {
      writeBarrel(
        path.join(directory, backend),
        'index.ts',
        backendFiles.map((file) => file.slice(backend.length + 1)),
      );
    }
  }
});
