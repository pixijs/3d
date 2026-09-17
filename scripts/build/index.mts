// oxlint-disable no-console
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
 * A `gl/` or `gpu/` path segment marks backend code; see docs/architecture.md
 * @param file - Source file path
 */
const isBackend = (file: string): boolean => /(^|\/)(gl|gpu)\//.test(file);

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
    console.error(`ERROR: File ${localFile} is out of date, run 'npm run build' to update it.\n`);
    process.exit(1);
  }
  console.log(`Updating ${localFile}`);
  fs.writeFileSync(filePath, output, 'utf-8');
}

// find all directories in src
const directories = glob.sync('*/', { cwd: directoryPath, absolute: true });

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
        '**/index.bundle.ts',
        // Tests
        '**/__tests__/**',
        // Docs / examples (internal only, not part of public API)
        '**/__docs__/**',
      ],
    })
    .sort((a, b) => a.localeCompare(b));

  writeBarrel(directory, 'index.ts', files);

  // The CDN entry re-exports this barrel instead, so the backends stay in their lazy chunks.
  if (files.some(isBackend)) {
    writeBarrel(
      directory,
      'index.bundle.ts',
      files.filter((file) => !isBackend(file)),
    );
  }
});
