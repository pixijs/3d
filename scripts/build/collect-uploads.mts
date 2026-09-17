import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Stages what the Upload workflow syncs to S3: the CDN bundle that `build:cdn` writes
// into `dist/` (the npm package carries it from there), copied next to the API docs
// typedoc already writes under `.s3_uploads/docs`.
const dist = path.resolve('dist');
const out = path.resolve('.s3_uploads');
const files = readdirSync(dist).filter((name) => name.startsWith('pixi-3d'));

if (files.length === 0) {
  throw new Error('collect-uploads: no pixi-3d* files in dist/; run `npm run build:cdn` first');
}

mkdirSync(out, { recursive: true });
for (const name of files) copyFileSync(path.join(dist, name), path.join(out, name));
console.log(`collect-uploads: copied ${files.length} files into .s3_uploads/`);
