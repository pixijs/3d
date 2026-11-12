/**
 * Prints what changed in the code itself: every `.ts`/`.mts` file that differs from `HEAD`, printed
 * with comments stripped on both sides and diffed. A docs-only edit prints nothing for its file, so
 * whatever this prints belongs in the report's list of code changes.
 *
 * Uses the docs workspace's TypeScript 5.9, because the root TypeScript 7 has no compiler API.
 *
 *   node .claude/skills/audit-docs/scripts/code-diff.mjs                     # the current checkout
 *   node .claude/skills/audit-docs/scripts/code-diff.mjs <worktree>          # another checkout
 *   node .claude/skills/audit-docs/scripts/code-diff.mjs . <path> [<path>…]  # only these paths
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [rootArg, ...paths] = process.argv.slice(2);
const root = path.resolve(rootArg ?? process.cwd());
const ts = createRequire(path.join(root, 'scripts/typedoc/package.json'))('typescript');
const printer = ts.createPrinter({ removeComments: true });

function strip(file, text) {
  return printer.printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
}

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

function readOrEmpty(read) {
  try {
    return read();
  } catch {
    return '';
  }
}

const files = git('diff', 'HEAD', '--name-only', '--', ...paths)
  .split('\n')
  .filter((file) => /\.m?ts$/.test(file));
const scratch = mkdtempSync(path.join(tmpdir(), 'code-diff-'));
let changed = 0;

for (const file of files) {
  const before = strip(
    file,
    readOrEmpty(() => git('show', `HEAD:${file}`)),
  );
  const after = strip(
    file,
    readOrEmpty(() => readFileSync(path.join(root, file), 'utf8')),
  );

  if (before === after) continue;
  changed++;
  writeFileSync(path.join(scratch, 'a'), before);
  writeFileSync(path.join(scratch, 'b'), after);
  try {
    execFileSync('diff', ['-u', '--label', `a/${file}`, '--label', `b/${file}`, 'a', 'b'], { cwd: scratch });
  } catch (error) {
    process.stdout.write(error.stdout);
  }
}

rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`\n${changed} of ${files.length} changed .ts files differ once comments are stripped\n`);
