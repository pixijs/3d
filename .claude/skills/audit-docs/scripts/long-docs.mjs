/**
 * Lists the JSDoc blocks longer than a line limit, longest first, so an audit can find what's left
 * to cut. Tags and `@example` code count toward a block's length. `@internal` marks a block with
 * that tag; members of an internal class show blank, so check the class too.
 *
 *   node .claude/skills/audit-docs/scripts/long-docs.mjs <path> [<path>…] [--min=6]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const min = Number(args.find((arg) => arg.startsWith('--min='))?.slice(6) ?? 6);
const roots = args.filter((arg) => !arg.startsWith('--'));
const blocks = [];

function visit(target) {
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target)) visit(path.join(target, entry));
  } else if (/\.m?ts$/.test(target)) {
    const text = readFileSync(target, 'utf8');
    for (const match of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
      const lines = match[0].split('\n');
      if (lines.length < min) continue;
      const line = text.slice(0, match.index).split('\n').length;
      const summary = lines.map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').trim()).find(Boolean) ?? '';
      const internal = /@internal|@ignore|@private/.test(match[0]);
      blocks.push({ where: `${target}:${line}`, size: lines.length, internal, summary });
    }
  }
}

for (const root of roots) visit(root);
blocks.sort((a, b) => b.size - a.size);
for (const block of blocks) {
  process.stdout.write(
    `${String(block.size).padStart(4)} ${block.internal ? '@internal' : '         '} ${block.where}  ${block.summary.slice(0, 90)}\n`,
  );
}
process.stdout.write(`${blocks.length} blocks of ${min}+ lines\n`);
