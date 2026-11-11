/**
 * Type-checks every `ts` code fence in the JSDoc under `src`, in the Markdown under `src` and
 * `examples/tutorials` (the guides and tutorial steps) and in `README.md` against the source, so an
 * example breaks when the API it shows changes. `npm run test:docs` runs it on everything; pass a
 * file or folder to check part of it, as in `node scripts/typedoc/check-examples.mts src/scene`.
 *
 * Each example compiles as its own module, importing the names it uses from `@pixi/3d`,
 * `@pixi/3d/extras`, `pixi.js` and the file it documents. Context the example assumes rather than
 * shows, such as `app`, `view3d` or `model`, is declared `any`, and so is a stand-in user class named
 * `My…`. Examples on file-private functions can't import what they document, so they aren't checked.
 * Runs on the TypeScript 5.9 that the `scripts/typedoc` workspace installs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';

/** A `ts` code fence from a JSDoc block or a Markdown guide, with the source line its first code line sits on */
interface Example {
  file: string;
  line: number;
  code: string;
}

/** An example turned into a module: the imports and declarations it needed, then its code from `codeStart` */
interface VirtualExample extends Example {
  path: string;
  text: string;
  codeStart: number;
}

/** Where an example's free names can come from: the package modules, and the file the example documents */
interface ExportIndex {
  packageOwner: Map<string, string>;
  fileExports: Map<string, Set<string>>;
}

const root = path.resolve(import.meta.dirname, '../..');
const configPath = path.join(import.meta.dirname, 'tsconfig.json');
const virtualDir = path.join(root, '.examples-check');

/**
 * Modules whose exports an example may use without importing them, in lookup order: examples are
 * written against the published package and assume its names are in scope
 */
const PACKAGE_MODULES = ['@pixi/3d', '@pixi/3d/extras', 'pixi.js'];

/**
 * Diagnostics that come from context an example assumes rather than shows, such as an `app` or a
 * loaded `model`, which are declared as `any` so everything typed from a real import is still checked.
 * A member snippet is wrapped in a class with no base, so its `override` modifiers are expected.
 */
const CONTEXT_CODES = new Set([18004, 7005, 7006, 7031, 7034, 4112, 4113]);

/** "Cannot find name" diagnostics, which only count for a name that reads as a package class or type */
const UNKNOWN_NAME_CODES = new Set([2304, 2552]);

/** Browser and runtime globals an example may use as themselves rather than as assumed context */
const REAL_GLOBALS = new Set([
  'console',
  'document',
  'window',
  'globalThis',
  'navigator',
  'performance',
  'location',
  'crypto',
  'fetch',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'structuredClone',
  'undefined',
]);

/** A snippet that starts with a class member, such as a method to override, rather than a statement */
const MEMBER_SNIPPET = /^\s*(?:public|protected|private|static|override|readonly|abstract|async|get|set)\b/;

/**
 * Every `ts` code fence in the lines, as examples whose line numbers count from `firstLine`.
 * @param file - Absolute path of the file the lines come from
 * @param lines - The text to search, one entry per line
 * @param firstLine - Source line of `lines[0]`
 */
function fencedExamples(file: string, lines: string[], firstLine: number): Example[] {
  const examples: Example[] = [];
  let start = -1;

  lines.forEach((line, index) => {
    if (start === -1 && /^```ts\s*$/.test(line)) {
      start = index + 1;
    } else if (start !== -1 && /^```\s*$/.test(line)) {
      examples.push({ file, line: firstLine + start, code: lines.slice(start, index).join('\n') });
      start = -1;
    }
  });

  return examples;
}

/**
 * Every `ts` code fence in a Markdown guide, or inside a JSDoc block of a source file.
 * @param file - Absolute path of a source file or guide
 */
function extractExamples(file: string): Example[] {
  const text = fs.readFileSync(file, 'utf8');

  if (file.endsWith('.md')) return fencedExamples(file, text.split('\n'), 1);

  return [...text.matchAll(/\/\*\*[\s\S]*?\*\//g)].flatMap((block) =>
    fencedExamples(
      file,
      block[0].split('\n').map((line) => line.replace(/^\s*\*(?!\/) ?/, '')),
      text.slice(0, block.index).split('\n').length,
    ),
  );
}

/**
 * Names an example uses without declaring or importing them.
 * @param code - The example's code
 */
function freeNames(code: string): Set<string> {
  const source = ts.createSourceFile('example.ts', code, ts.ScriptTarget.Latest, true);
  const used = new Set<string>();
  const declared = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) &&
          parent.name === node);
      const isDeclaration =
        (ts.isVariableDeclaration(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isClassDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isImportSpecifier(parent) ||
          ts.isImportClause(parent) ||
          ts.isNamespaceImport(parent) ||
          ts.isBindingElement(parent)) &&
        parent.name === node;

      if (isDeclaration) declared.add(node.text);
      else if (!isMemberName) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return new Set([...used].filter((name) => !declared.has(name)));
}

/**
 * Compiler options from the docs workspace config, loosened only where an example is a fragment
 * rather than a module: unused names are fine and type-only imports need no `type` keyword.
 */
function compilerOptions(): ts.CompilerOptions {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );

  if (!parsed) throw new Error(`Could not read ${configPath}`);

  return {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    emitDeclarationOnly: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    verbatimModuleSyntax: false,
    isolatedModules: false,
  };
}

/**
 * A program over in-memory files plus everything on disk they import.
 * @param rootNames - Paths of the in-memory files
 * @param files - In-memory file contents by path
 * @param options - Compiler options
 */
function createProgram(rootNames: string[], files: Map<string, string>, options: ts.CompilerOptions): ts.Program {
  const base = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName) => files.has(fileName) || base.fileExists(fileName),
    readFile: (fileName) => files.get(fileName) ?? base.readFile(fileName),
    getSourceFile: (fileName, languageVersion, ...rest) => {
      const text = files.get(fileName);

      return text === undefined
        ? base.getSourceFile(fileName, languageVersion, ...rest)
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
  };

  return ts.createProgram(rootNames, options, host);
}

/**
 * The import specifier for a source file, from the in-memory examples' directory.
 * @param file - Absolute path of a source file
 */
function fileSpecifier(file: string): string {
  return path.relative(virtualDir, file).split(path.sep).join('/');
}

/**
 * What each package module and each documented file exports, read from a throwaway program.
 * @param files - Source files that contain examples
 * @param options - Compiler options for the probe
 */
function indexExports(files: string[], options: ts.CompilerOptions): ExportIndex {
  const specifiers = [...PACKAGE_MODULES, ...files.map(fileSpecifier)];
  const probePath = path.join(virtualDir, 'probe.ts');
  const probeText = specifiers.map((specifier, index) => `import * as m${index} from '${specifier}';`).join('\n');
  const program = createProgram([probePath], new Map([[probePath, probeText]]), options);
  const checker = program.getTypeChecker();
  const packageOwner = new Map<string, string>();
  const fileExports = new Map<string, Set<string>>();

  program.getSourceFile(probePath)?.statements.forEach((statement, index) => {
    if (!ts.isImportDeclaration(statement)) return;
    const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);

    if (!symbol) throw new Error(`Could not resolve ${specifiers[index]}`);
    const names = checker.getExportsOfModule(symbol).map((exported) => exported.name);

    if (index < PACKAGE_MODULES.length) {
      for (const name of names) {
        if (!packageOwner.has(name)) packageOwner.set(name, PACKAGE_MODULES[index]);
      }
    } else {
      fileExports.set(files[index - PACKAGE_MODULES.length], new Set(names));
    }
  });

  return { packageOwner, fileExports };
}

/**
 * Turns an example into a module that imports the package and same-file names it uses and declares
 * the context it assumes, such as `app` or `model`, as `any`.
 * @param example - The extracted example
 * @param exports - Where free names can be imported from
 * @param index - Position of the example, used to name its in-memory file
 */
function toVirtual(example: Example, exports: ExportIndex, index: number): VirtualExample {
  const isMember = MEMBER_SNIPPET.test(example.code.split('\n').find((line) => line.trim() !== '') ?? '');
  const code = isMember ? `class Example {\n${example.code}\n}` : example.code;
  const byModule = new Map<string, string[]>();
  const assumed: string[] = [];
  const ownExports = exports.fileExports.get(example.file);

  for (const name of freeNames(code)) {
    const moduleName =
      exports.packageOwner.get(name) ?? (ownExports?.has(name) ? fileSpecifier(example.file) : undefined);

    if (moduleName) byModule.set(moduleName, [...(byModule.get(moduleName) ?? []), name]);
    else if (/^[a-z]/.test(name) && !REAL_GLOBALS.has(name)) assumed.push(name);
  }

  const header = [
    ...[...byModule].map(([moduleName, names]) => `import { ${names.join(', ')} } from '${moduleName}';`),
    ...assumed.map((name) => `declare let ${name}: any;`),
    ...(isMember ? ['class Example {'] : []),
  ];

  return {
    ...example,
    path: path.join(virtualDir, `example${index}.ts`),
    text: [...header, example.code, ...(isMember ? ['}'] : []), 'export {};', ''].join('\n'),
    codeStart: header.length,
  };
}

/**
 * True for a diagnostic caused by a relative import, which points at a file the example's reader has,
 * not at the package.
 * @param diagnostic - A diagnostic from an example
 */
function isRelativeImport(diagnostic: ts.Diagnostic): boolean {
  return diagnostic.code === 2307 && /'\.\.?\//.test(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

/**
 * True for an unknown name that reads as assumed context, such as `AO_FRAGMENT`, `spawnDecal`, or a
 * user class named `MyOutlinePass`, rather than as a package class or type that was renamed or removed.
 * @param diagnostic - A diagnostic from an example
 */
function isAssumedName(diagnostic: ts.Diagnostic): boolean {
  if (!UNKNOWN_NAME_CODES.has(diagnostic.code)) return false;
  const name = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))?.[1] ?? '';

  return !/^[A-Z][a-z]/.test(name) || /^My[A-Z]/.test(name);
}

const targets = process.argv.slice(2);
const patterns = (targets.length > 0 ? targets : ['src', 'examples/tutorials', 'README.md']).map((target) =>
  /\.(?:ts|md)$/.test(target) ? target : `${target.replace(/\/$/, '')}/**/*.{ts,md}`,
);
const sourceFiles = globSync(patterns, {
  cwd: root,
  absolute: true,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.worker.ts'],
}).sort();

const options = compilerOptions();
const extracted = sourceFiles.flatMap(extractExamples);
const exports = indexExports(
  [...new Set(extracted.map((example) => example.file))].filter((file) => file.endsWith('.ts')),
  options,
);
const examples = extracted.map((example, index) => toVirtual(example, exports, index));
const program = createProgram(
  examples.map((example) => example.path),
  new Map(examples.map((example) => [example.path, example.text])),
  options,
);

let errors = 0;

for (const example of examples) {
  const source = program.getSourceFile(example.path);

  if (!source) continue;
  const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].filter(
    (diagnostic) => !CONTEXT_CODES.has(diagnostic.code) && !isRelativeImport(diagnostic) && !isAssumedName(diagnostic),
  );

  for (const diagnostic of diagnostics) {
    const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const sourceLine = example.line + Math.max(0, line - example.codeStart);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const hint = UNKNOWN_NAME_CODES.has(diagnostic.code)
      ? ' (a package symbol was renamed or removed, or a stand-in user class needs a `My` prefix)'
      : '';

    console.log(`${path.relative(root, example.file)}:${sourceLine} TS${diagnostic.code}: ${message}${hint}`);
    errors++;
  }
}

console.log(`check-examples: ${examples.length} examples in ${sourceFiles.length} files, ${errors} errors`);
process.exitCode = errors > 0 ? 1 : 0;
