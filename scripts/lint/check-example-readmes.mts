/**
 * Fails when an example's README falls out of step with its code: `node scripts/lint/check-example-readmes.mts`, run
 * by `npm run test:docs`.
 *
 * Every `examples/<id>/` with an `index.ts` needs a `README.md` that shows its `reference.png` and names, in inline
 * code, every symbol the folder's files import from `@pixi/3d`, `@pixi/3d/extras` and `pixi.js`, so an agent reading
 * the README sees every API the example uses. Its relative links must lead to files that exist.
 * `npm run test:example-shots -- <id> --update` takes a missing `reference.png`.
 */
import fs from 'node:fs';
import path from 'node:path';

const EXAMPLES = path.resolve(import.meta.dirname, '../../examples');
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(?:@pixi\/3d(?:\/extras)?|pixi\.js)'/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const RELATIVE_LINK = /\]\((?!https?:|#)([^)\s]+)\)/g;

const problems: string[] = [];

for (const id of fs.readdirSync(EXAMPLES).sort()) {
  const folder = path.join(EXAMPLES, id);

  if (!fs.existsSync(path.join(folder, 'index.ts'))) continue;

  const readmePath = path.join(folder, 'README.md');

  if (!fs.existsSync(path.join(folder, 'reference.png'))) problems.push(`${id}: no reference.png`);
  if (!fs.existsSync(readmePath)) {
    problems.push(`${id}: no README.md`);
    continue;
  }

  const readme = fs.readFileSync(readmePath, 'utf8');
  const named = new Set<string>();

  for (const [, span] of readme.matchAll(CODE_SPAN)) {
    for (const [identifier] of span.matchAll(IDENTIFIER)) named.add(identifier);
  }
  if (!readme.includes('](reference.png)')) problems.push(`${id}: README.md doesn't show reference.png`);
  for (const [, target] of readme.matchAll(RELATIVE_LINK)) {
    if (!fs.existsSync(path.join(folder, target.split('#')[0]))) problems.push(`${id}: README.md links to ${target}`);
  }

  const imported = new Set<string>();

  for (const file of fs.readdirSync(folder, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue;
    for (const [, names] of fs.readFileSync(path.join(folder, file), 'utf8').matchAll(IMPORT)) {
      for (const entry of names.split(',')) {
        const name = entry
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];

        if (name) imported.add(name);
      }
    }
  }

  const missing = [...imported].filter((name) => !named.has(name)).sort();

  if (missing.length) problems.push(`${id}: README.md doesn't name ${missing.map((name) => `\`${name}\``).join(', ')}`);
}

if (problems.length) {
  console.error(`Example READMEs out of step with their examples:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Every example has a README that shows its reference image and names its imports');
