/**
 * Fails on a guide or tutorial step link that leads nowhere, so a renamed or hidden API breaks the
 * page loudly. It reads every `{@link}` in `src/**\/__docs__/**\/*.md` and
 * `examples/tutorials/**\/step.md`, outside code, and resolves it against the public exports of
 * `@pixi/3d` and `@pixi/3d/extras`; a link to something `@internal`, private or protected fails too.
 * Each `@stackblitz` embed must name an example in a `__docs__/examples` folder. Run by
 * `npm run test:docs`; `check-doc-links` covers gallery links.
 *
 * Pass guide paths to check only those pages, as in
 * `node scripts/typedoc/check-guides.mts src/scene/__docs__/lights.md`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const srcDir = path.join(root, 'src') + '/';
const configPath = path.join(import.meta.dirname, 'tsconfig.json');
const ENTRY_POINTS = ['index.ts', 'extras/index.ts'];
const GUIDES = ['src/**/__docs__/**/*.md', 'examples/tutorials/**/step.md'];
const HIDDEN_TAGS = new Set(['internal', 'ignore', 'private', 'hidden']);
const LINK = /\{@link(?:code|plain)?\s+([^\s|}]+)[^}]*\}/g;
const CODE_SPAN = /(`+)(?:(?!\1).)+?\1/g;
const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;
const EMBED = /^@stackblitz\(([\w/-]+)\)\s*$/;

/**
 * Every `{@link}` target and `@stackblitz` embed of a Markdown page, outside front matter, code
 * fences and code spans, with the lines it sits on. Embeds are keyed `embed:<name>`.
 * @param text - The page's source
 */
function targetsIn(text: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const add = (key: string, line: number): void => {
    found.set(key, [...(found.get(key) ?? []), line]);
  };
  const lines = text.split('\n');
  let fence: string | undefined;
  let start = 0;

  if (lines[0] === '---') start = lines.indexOf('---', 1) + 1;
  for (let index = start; index < lines.length; index++) {
    const marker = FENCE.exec(lines[index])?.[1];

    if (fence) {
      const closes = marker && marker[0] === fence[0] && marker.length >= fence.length;

      if (closes && lines[index].trim().replace(/^(?:>\s*)*/, '') === marker) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }

    const line = lines[index].replace(CODE_SPAN, '');
    const embed = EMBED.exec(line.trim());

    if (embed) add(`embed:${embed[1]}`, index + 1);
    for (const [, target] of line.matchAll(LINK)) add(target, index + 1);
  }

  return found;
}

function createSourceProgram(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} },
  );

  if (!config) throw new Error(`Could not parse ${configPath}`);

  return ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
}

function hiddenTag(node: ts.Node): string | undefined {
  return ts.getJSDocTags(node).find((tag) => HIDDEN_TAGS.has(tag.tagName.text))?.tagName.text;
}

/**
 * The visibility tag that hides a declaration from the API reference, read from the declaration
 * and from every declaration around it up to, but not including, `stop`.
 * @param node - A declaration
 * @param stop - An enclosing node whose tags don't count, such as the class that owns a member
 */
function hiddenBy(node: ts.Node, stop?: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node; current && current !== stop; current = current.parent) {
    const tag = hiddenTag(current);

    if (tag) return tag;
  }

  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.ModifierSyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

/**
 * Resolves `Name`, `Name.member` and `Name#member` against the public exports, returning why a
 * target names no public API, or undefined when it does. A `.` tries the static side first and a
 * `#` the instance side first, each falling back to the other.
 * @param program - The source program
 */
function createResolver(program: ts.Program): (target: string) => string | undefined {
  const checker = program.getTypeChecker();
  const exports = new Map<string, ts.Symbol>();

  for (const entry of ENTRY_POINTS) {
    const file = program.getSourceFile(path.join(srcDir, entry));
    const moduleSymbol = file && checker.getSymbolAtLocation(file);

    if (!moduleSymbol) throw new Error(`Could not read the exports of src/${entry}`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (exports.has(exported.name)) continue;
      exports.set(exported.name, exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported);
    }
  }

  const instanceMember = (symbol: ts.Symbol, name: string): ts.Symbol | undefined =>
    symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
      ? checker.getDeclaredTypeOfSymbol(symbol).getProperty(name)
      : undefined;
  const staticMember = (symbol: ts.Symbol, name: string): ts.Symbol | undefined => {
    if (symbol.flags & ts.SymbolFlags.Value) {
      const member = checker.getTypeOfSymbol(symbol).getProperty(name);

      if (member) return member;
    }

    return symbol.flags & ts.SymbolFlags.Namespace
      ? checker.getExportsOfModule(symbol).find((exported) => exported.name === name)
      : undefined;
  };

  return (target) => {
    const [, name, separator, memberName] = /^([^.#]+)(?:([.#])(.+))?$/.exec(target) ?? [];
    const symbol = name ? exports.get(name) : undefined;

    if (!symbol) return `${name ?? target} isn't exported from @pixi/3d or @pixi/3d/extras`;
    const tags = (symbol.declarations ?? []).map((node) => hiddenBy(node));

    if (tags.length > 0 && tags.every(Boolean)) return `${name} is @${tags[0]}`;
    if (!memberName) return undefined;

    const member =
      separator === '#'
        ? (instanceMember(symbol, memberName) ?? staticMember(symbol, memberName))
        : (staticMember(symbol, memberName) ?? instanceMember(symbol, memberName));

    if (!member) return `${name} has no member ${memberName}`;
    if (/^[_#]/.test(memberName)) return `${target} is private by its name`;
    const problems = (member.declarations ?? []).map((node) => {
      const owner = ts.isClassLike(node.parent) || ts.isInterfaceDeclaration(node.parent) ? node.parent : undefined;
      const tag = hiddenBy(node, owner);

      if (tag) return `${target} is @${tag}`;
      if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return `${target} is private`;
      if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return `${target} is protected`;

      return undefined;
    });

    return problems.length > 0 && problems.every(Boolean) ? problems[0] : undefined;
  };
}

const requested = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--'))
  .map((arg) => path.relative(root, path.resolve(arg)).split(path.sep).join('/'));
const guides = globSync(GUIDES, { cwd: root }).sort();
const problems = requested
  .filter((page) => !guides.includes(page))
  .map((page) => `${page} isn't a guide or tutorial step; pass a file that ${GUIDES.join(' or ')} matches.`);
const pages = guides.filter((page) => requested.length === 0 || requested.includes(page));
const guideExamples = new Set(
  globSync(['src/**/__docs__/examples/*.ts', 'src/**/__docs__/examples/*/index.ts'], { cwd: root }).map((file) =>
    path.basename(file) === 'index.ts' ? path.basename(path.dirname(file)) : path.basename(file, '.ts'),
  ),
);
const resolveSource = createResolver(createSourceProgram());
const resolve = (target: string): string | undefined => {
  if (!target.startsWith('embed:')) return resolveSource(target);
  const name = target.slice('embed:'.length);

  return guideExamples.has(name)
    ? undefined
    : `no guide example is named ${name}; embed one from a __docs__/examples folder`;
};
const resolutions = new Map<string, string | undefined>();
let linkCount = 0;

for (const page of pages) {
  for (const [target, lines] of targetsIn(fs.readFileSync(path.join(root, page), 'utf8'))) {
    if (!resolutions.has(target)) resolutions.set(target, resolve(target));
    const problem = resolutions.get(target);

    linkCount += lines.length;
    if (!problem) continue;
    problems.push(
      `${page}:${lines.join(',')} links ${target}, which doesn't resolve: ${problem}. ` +
        (target.startsWith('embed:') ? 'Point it at one that exists.' : 'Link a public export or member instead.'),
    );
  }
}

for (const problem of problems) console.log(problem);
console.log(`check-guides: ${linkCount} links in ${pages.length} pages, ${problems.length} errors`);
process.exitCode = problems.length > 0 ? 1 : 0;
