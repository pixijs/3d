/**
 * Fails when a markdown link leads nowhere, so moving a file or renaming a heading breaks the docs
 * loudly instead of leaving a dead link: `node scripts/lint/check-doc-links.mts`, run by
 * `npm run test:docs`.
 *
 * It reads every tracked markdown file outside `.claude/` and the beta release overlay, skipping
 * code fences and code spans, and checks each link target: Markdown links, reference definitions,
 * and `href` or `src` attributes. A relative path must exist from the doc's folder, and a `#anchor`
 * must match a heading in the target, slugged the way GitHub slugs it, or an `id` or `name` on an
 * `<a>` tag. A gallery link, `/3d/examples?example=<folder>`, must name a folder in `examples/` with
 * an `index.ts`. Full URLs and other site routes starting with `/` are skipped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKIPPED_DOCS = /^(?:\.claude\/|scripts\/beta\/files\/)/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)(?:(?!\1).)+?\1/g;
const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;
const HTML_ANCHOR = /<a\s+[^>]*(?:id|name)="([^"]+)"/g;
const INLINE_LINK = /\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE_DEFINITION = /^\s*\[[^\]]+\]:\s*(\S+)/g;
const HTML_LINK = /\s(?:href|src)="([^"]+)"/g;
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const GALLERY_LINK = /^\/3d\/examples\?example=([\w-]+)$/;

const docs = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((doc) => doc && !SKIPPED_DOCS.test(doc));

/**
 * A doc's lines, with code fences blanked so the links and headings inside them don't count
 * @param file - Absolute path of a markdown file
 */
function linesOutsideFences(file: string): string[] {
  let fence: string | undefined;

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];

      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;

        return '';
      }
      if (marker) fence = marker;

      return marker ? '' : line;
    });
}

/**
 * The anchor GitHub gives a heading: lowercased, with everything but letters, numbers, marks, `_`,
 * `-` and spaces dropped, then spaces turned into `-`
 * @param raw - The heading's markdown, after the `#` marks
 */
function slug(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/\{@link\s+([^}|]+?)(?:\s*\|\s*([^}]+))?\}/g, (_, target: string, label?: string) => label ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map<string, Set<string>>();

/**
 * Every anchor a markdown file offers: its heading slugs, numbered the way GitHub numbers repeats,
 * and the `id` or `name` of each `<a>` tag
 * @param file - Absolute path of a markdown file
 */
function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);

  if (cached) return cached;

  const repeats = new Map<string, number>();
  const anchors = new Set<string>();

  for (const line of linesOutsideFences(file)) {
    const heading = HEADING.exec(line);

    if (heading) {
      const base = slug(heading[1]);
      const count = repeats.get(base) ?? 0;

      repeats.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    for (const [, id] of line.matchAll(HTML_ANCHOR)) anchors.add(id);
  }
  anchorCache.set(file, anchors);

  return anchors;
}

/**
 * Why a link target leads nowhere, or `undefined` when it resolves or isn't checked
 * @param target - The link target as written
 * @param doc - Absolute path of the doc that links it
 */
function problemWith(target: string, doc: string): string | undefined {
  const gallery = GALLERY_LINK.exec(target);

  if (gallery) {
    return fs.existsSync(path.join(ROOT, 'examples', gallery[1], 'index.ts'))
      ? undefined
      : `no gallery example examples/${gallery[1]}/index.ts`;
  }
  if (ABSOLUTE_URL.test(target) || target.startsWith('/')) return undefined;

  const [pathPart, anchor] = target.split('#');
  const file = pathPart ? path.resolve(path.dirname(doc), decodeURIComponent(pathPart)) : doc;

  if (!fs.existsSync(file)) return 'no such file';
  if (anchor === undefined) return undefined;
  if (!file.endsWith('.md')) return "anchor on a file that isn't markdown";
  if (!anchorsOf(file).has(decodeURIComponent(anchor))) {
    return `no heading in ${path.relative(ROOT, file)} slugs to #${anchor}`;
  }

  return undefined;
}

const problems: string[] = [];

for (const doc of docs) {
  const file = path.join(ROOT, doc);

  linesOutsideFences(file).forEach((rawLine, index) => {
    const line = rawLine.replace(CODE_SPAN, '');
    const targets = [
      ...line.matchAll(INLINE_LINK),
      ...line.matchAll(REFERENCE_DEFINITION),
      ...line.matchAll(HTML_LINK),
    ].map((match) => match[1]);

    for (const target of targets) {
      const problem = target && problemWith(target, file);

      if (problem) problems.push(`${doc}:${index + 1}: ${target} (${problem})`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\ncheck-doc-links: ${problems.length} broken link(s). Point each at the file or heading it means.`);
  process.exit(1);
}
console.log(`check-doc-links: every link in ${docs.length} markdown files resolves`);
