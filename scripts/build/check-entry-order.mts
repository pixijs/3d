// Imports each published entry point first, each in a fresh Node process. An import cycle can
// load fine from the root entry yet throw when a consumer's first import is `@pixi/3d/extras`
// or a backend, because a class then extends one that hasn't finished loading. Run after
// `npm run build`.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.cwd(), 'dist');
const entries = ['index.mjs', 'extras/index.mjs', 'core/gl/init.mjs', 'core/gpu/init.mjs'];

let failed = false;

for (const entry of entries) {
  const url = pathToFileURL(path.join(dist, entry)).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], {
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`ok    ${entry}`);
  } else {
    failed = true;
    console.error(`FAIL  ${entry}\n${result.stderr.trim().split('\n').slice(0, 8).join('\n')}`);
  }
}

if (failed) {
  console.error('\nAn entry point fails when it is the first one a consumer imports.');
  process.exit(1);
}

console.log('\nEntry order check passed.');
