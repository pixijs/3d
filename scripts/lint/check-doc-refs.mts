/**
 * Fails when a markdown doc names a file or a code symbol that no longer exists, so a rename or a
 * deletion breaks the doc loudly instead of leaving it stale: `node scripts/lint/check-doc-refs.mts`,
 * run by `npm run test:docs`.
 *
 * It reads the inline code spans of every tracked markdown file outside `.claude/` and the beta
 * release overlay, skipping fenced blocks. A span shaped like a path must exist from the repo root,
 * the doc's folder or `src/`, or name a tracked file or an installed package; paths git ignores,
 * home paths, URLs, URL routes and placeholders such as `<name>` or `*` are skipped. In every other span, each
 * identifier shaped like code (camelCase, PascalCase, or containing `_`) must appear in a tracked
 * source file or in pixi.js's type declarations. Markdown doesn't count as a source, so renaming the
 * code without the doc fails.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|json|ya?ml|css|html|wgsl|glsl)$/;
const SKIPPED_DOCS = /^(?:\.claude\/|scripts\/beta\/files\/)/;
const PLACEHOLDER = /[<>*{}…]|^[~@/]|\s/;
const PATH_SHAPED = /\/|\.(?:[cm]?[jt]s|tsx|md|json|ya?ml|png|css|html)$/;
const CODE_SHAPED = /_|[a-z0-9][A-Z]|^[A-Z][A-Za-z0-9]*[a-z]/;
const IDENTIFIER = /(?<![@\w$-])[A-Za-z_$][\w$]*/g;
const COMMAND = /^(?:npm|npx|node|git|gh|benchy|tsc|oxlint|oxfmt|vitest)\s/;
const ABSOLUTE_URL = /^[a-z][a-z+.-]*:\/\//;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const trackedNames = new Set(tracked.map((file) => path.basename(file)));

/**
 * Adds every identifier in a file's text to the set of known symbols
 * @param file - Absolute path of a source file
 * @param symbols - The set to fill
 */
function collectSymbols(file: string, symbols: Set<string>): void {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(IDENTIFIER)) symbols.add(match[0]);
}

const symbols = new Set<string>();
for (const file of tracked) {
  if (SOURCE_FILE.test(file) && file !== 'package-lock.json') collectSymbols(path.join(ROOT, file), symbols);
}
const pixiTypes = path.join(ROOT, 'node_modules/pixi.js/lib');
if (fs.existsSync(pixiTypes)) {
  for (const file of fs.readdirSync(pixiTypes, { recursive: true, encoding: 'utf8' })) {
    if (file.endsWith('.d.ts')) collectSymbols(path.join(pixiTypes, file), symbols);
  }
}

/**
 * Whether git ignores a path, so the doc may name a generated or local-only file
 * @param relative - Path from the repo root
 */
function isIgnored(relative: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relative], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a path a doc names exists, or is one git ignores
 * @param span - The code span, without a trailing `:line`
 * @param docDir - The doc's folder, relative to the repo root
 */
function pathExists(span: string, docDir: string): boolean {
  const relative = span.replace(/\/$/, '');
  if (!relative.includes('/') && trackedNames.has(relative)) return true;
  const candidates = [
    relative,
    path.join(docDir, relative),
    path.join('src', relative),
    path.join('node_modules', relative),
  ];
  return candidates.some((candidate) => fs.existsSync(path.join(ROOT, candidate))) || isIgnored(span);
}

const problems: string[] = [];

for (const doc of tracked) {
  if (!doc.endsWith('.md') || SKIPPED_DOCS.test(doc)) continue;
  const docDir = path.dirname(doc);
  let fenced = false;

  fs.readFileSync(path.join(ROOT, doc), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return;

      for (const [, raw] of line.matchAll(/`([^`]+)`/g)) {
        const span = raw.trim().replace(/:\d+(?:-\d+)?$/, '');
        const where = `${doc}:${index + 1}`;

        if (COMMAND.test(span) || ABSOLUTE_URL.test(span)) continue;
        if (PATH_SHAPED.test(span) && !PLACEHOLDER.test(span)) {
          if (!pathExists(span, docDir)) problems.push(`${where}: \`${span}\` doesn't exist`);
          continue;
        }
        for (const [token] of span.matchAll(IDENTIFIER)) {
          if (CODE_SHAPED.test(token) && !symbols.has(token)) {
            problems.push(`${where}: \`${token}\` (in \`${raw}\`) isn't in the repo's source or pixi.js's types`);
          }
        }
      }
    });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(
    `\ncheck-doc-refs: ${problems.length} stale reference(s). Update the doc or the name it points at; ` +
      'write a name from outside this repo without backticks.',
  );
  process.exit(1);
}
console.log('check-doc-refs: every path and symbol the docs name exists');
