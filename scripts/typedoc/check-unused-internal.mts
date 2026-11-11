/**
 * Checks how `@internal` declarations are used. It reports:
 *
 * - an `@internal` declaration nothing outside tests and benchmarks uses: tagged exports, and the
 *   non-private members of tagged classes, interfaces, type aliases, enums and namespaces. Uses in
 *   `examples/` and `playground/` count, and so does a runtime dependency calling a declaration by
 *   name, such as an extension's static `extension`, once it's handed to that dependency;
 * - an `@internal` export only its own file needs: no other file references it, tests and
 *   benchmarks included, and no needed exported type names it outside a parameter or return type;
 * - a reference from `examples/` or `playground/` to an `@internal` declaration, since users copy
 *   that code;
 * - a public declaration or member whose type, signature or `extends` base names a type of `src`
 *   the API reference leaves out: one tagged `@internal`, `@ignore`, `@private` or `@hidden`, or one
 *   `@pixi/3d` and `@pixi/3d/extras` don't export. `implements` clauses, a base's type arguments and
 *   type parameter constraints don't count, since the class's own members carry the docs. Public
 *   means exported from those entry points and not hidden by a tag, a `private` or `protected`
 *   modifier, or a leading `_` or `#`.
 *
 * Run with `npm run test:unused`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

/** A problem to print: an unused `@internal` declaration, or a disable comment that hides nothing */
interface Finding {
  file: string;
  line: number;
  column: number;
  message: string;
}

/** A function, method or constructor, the declarations that can have overloads */
type Callable = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration;

/** A disable comment: `disable-next-line` covers the line below it, `disable` every line until an `enable` */
interface Directive {
  line: number;
  column: number;
  from: number;
  to: number;
  used: boolean;
}

const root = path.resolve(import.meta.dirname, '../..');
const srcDir = path.join(root, 'src') + '/';
const configPath = path.join(import.meta.dirname, 'tsconfig.json');

/** The modules users import, `@pixi/3d` and `@pixi/3d/extras`, relative to `src` */
const ENTRY_POINTS = ['index.ts', 'extras/index.ts'];

/** JSDoc tags that leave a declaration, and everything inside it, out of the API reference */
const HIDDEN_TAGS = new Set(['internal', 'ignore', 'private', 'hidden']);

/**
 * Declarations whose `@internal` tag also covers the members and nested shapes inside them, so a
 * tagged class, interface, type alias, enum or namespace makes all of its public members internal
 */
const TAG_SCOPES = new Set([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.TypeLiteral,
  ts.SyntaxKind.UnionType,
  ts.SyntaxKind.IntersectionType,
  ts.SyntaxKind.ParenthesizedType,
  ts.SyntaxKind.ArrayType,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
]);

/** A line that opens with a disable comment, such as `// unused-internal-disable-next-line -- <reason>` */
const DIRECTIVE = /^(\s*)(?:\/\/|\/\*)\s*unused-internal-(disable-next-line|disable|enable)\b/;

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
/** Packages that run alongside the library and call into the objects it hands them, such as pixi.js */
const runtimeDependencies = new Set(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }));

/**
 * The program for `src` without workers, plus `examples` and `playground`, whose uses count too, and
 * the tests and benchmarks, whose imports keep an `@internal` declaration exported
 */
function createProjectProgram(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} },
  );
  if (!config) throw new Error(`Could not parse ${configPath}`);
  const rootNames = config.fileNames.concat(
    ts.sys.readDirectory(path.join(root, 'examples'), ['.ts', '.tsx'], ['**/node_modules', '**/mirror'], ['**/*']),
    ts.sys.readDirectory(path.join(root, 'playground'), ['.ts', '.tsx'], ['**/node_modules'], ['**/*']),
    ts.sys.readDirectory(srcDir, ['.ts'], ['**/*.worker.ts'], ['**/__tests__/**/*', '**/*.test.ts']),
    ts.sys.readDirectory(path.join(root, 'tests'), ['.ts'], [], ['**/*']),
    ts.sys.readDirectory(path.join(root, 'bench'), ['.ts'], ['**/node_modules', '**/results'], ['**/*']),
  );
  return ts.createProgram(rootNames, {
    ...config.options,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'preact',
    noEmit: true,
  });
}

/**
 * True for code whose references count as uses: everything in the repo but tests and benchmarks.
 * @param file - Absolute path of a source file
 */
function isUsageFile(file: string): boolean {
  if (!file.startsWith(root + '/') || file.includes('/node_modules/') || file.includes('/__tests__/')) return false;
  return !/^(?:tests|bench)\//.test(path.relative(root, file)) && !/\.test\.tsx?$/.test(file);
}

function hasModifier(node: ts.Node, kind: ts.ModifierSyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function hasInternalTag(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal');
}

/**
 * Whether the declaration is tagged `@internal` itself or sits inside a tagged {@link TAG_SCOPES} scope.
 * @param node - A declaration
 */
function isInternal(node: ts.Node): boolean {
  for (let current = node; ; current = current.parent) {
    if (hasInternalTag(current)) return true;
    if (!current.parent || !TAG_SCOPES.has(current.parent.kind)) return false;
  }
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/**
 * The name of a declaration the check covers: a top-level or namespace export, or a non-private
 * member of a class, interface, object type or enum.
 * @param node - Any node of a source file
 */
function checkedName(node: ts.Node): ts.Identifier | ts.StringLiteral | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isVariableDeclaration(node)
  ) {
    const exported = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export;
    return exported && node.name && ts.isIdentifier(node.name) ? node.name : undefined;
  }
  const isMember =
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node) ||
    ts.isEnumMember(node);
  if (!isMember || ts.isObjectLiteralExpression(node.parent)) return undefined;
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return undefined;
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name : undefined;
}

/**
 * The declaration's name prefixed with the names of the scopes around it, such as `GltfFormat.Asset.version`.
 * @param node - The declaration
 * @param name - Its own name
 */
function qualifiedName(node: ts.Node, name: string): string {
  const parts = [name];
  for (let current = node.parent; current && TAG_SCOPES.has(current.kind); current = current.parent) {
    const scopeName =
      ts.isClassLike(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isEnumDeclaration(current) ||
      ts.isModuleDeclaration(current) ||
      ts.isPropertySignature(current) ||
      ts.isPropertyDeclaration(current)
        ? nameText(current.name)
        : undefined;
    if (scopeName !== undefined) parts.unshift(scopeName);
  }
  return parts.join('.');
}

/**
 * The name of the npm package a file belongs to, if it sits in `node_modules`.
 * @param file - Absolute path of a source file
 */
function packageOf(file: string): string | undefined {
  const index = file.lastIndexOf('/node_modules/');
  if (index < 0) return undefined;
  const [scope, name] = file.slice(index + '/node_modules/'.length).split('/');
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
}

/**
 * Marks every declaration that code outside tests and benchmarks references, then returns the
 * `@internal` ones left unmarked.
 * @param program - The project's program
 */
function findUnusedInternals(program: ts.Program): { checked: number; unused: Finding[] } {
  const checker = program.getTypeChecker();
  const used = new Set<ts.Symbol>();
  const usedByName = new Map<string, ts.Symbol[]>();
  const dependencyMembers = new Map<string, Set<string>>();

  /**
   * The members of the same name that the symbol's classes and interfaces extend or implement.
   * @param symbol - A class or interface member
   */
  function inheritedMembers(symbol: ts.Symbol): ts.Symbol[] {
    const members: ts.Symbol[] = [];
    for (const declaration of symbol.declarations ?? []) {
      const owner = declaration.parent;
      if (!owner || !(ts.isClassLike(owner) || ts.isInterfaceDeclaration(owner))) continue;
      const isStatic = hasModifier(declaration, ts.SyntaxKind.StaticKeyword);
      for (const clause of owner.heritageClauses ?? []) {
        if (isStatic && clause.token === ts.SyntaxKind.ImplementsKeyword) continue;
        for (const heritage of clause.types) {
          const base = checker.getTypeAtLocation(isStatic ? heritage.expression : heritage);
          const member = base.getProperty(symbol.name);
          if (member) members.push(...checker.getRootSymbols(member));
        }
      }
    }
    return members;
  }

  /**
   * Records a referenced symbol as used, along with the members it overrides or implements.
   * @param symbol - The symbol a reference resolved to
   */
  function mark(symbol: ts.Symbol | undefined): void {
    if (!symbol) return;
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    for (const rootSymbol of checker.getRootSymbols(target)) {
      if (used.has(rootSymbol)) continue;
      used.add(rootSymbol);
      const sameName = usedByName.get(rootSymbol.name);
      if (sameName) sameName.push(rootSymbol);
      else usedByName.set(rootSymbol.name, [rootSymbol]);
      for (const member of inheritedMembers(rootSymbol)) mark(member);
    }
  }

  /**
   * Marks the property an object literal key or destructured name refers to.
   * @param type - The object's type
   * @param name - The property name
   */
  function markProperty(type: ts.Type | undefined, name: string | undefined): void {
    if (!type || name === undefined) return;
    for (const member of type.isUnion() ? type.types : [type]) mark(member.getProperty(name));
  }

  /**
   * Marks what a name refers to, unless the name declares it or only imports or re-exports it.
   * @param node - An identifier, or a string such as the key in `object['key']`
   */
  function markReference(node: ts.Identifier | ts.StringLiteralLike): void {
    const parent = node.parent;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isExportAssignment(parent)) return;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || symbol.declarations?.some((declaration) => ts.getNameOfDeclaration(declaration) === node)) return;
    mark(symbol);
  }

  /**
   * Every class and object type member name a package's declarations contain.
   * @param packageName - A package in the program
   */
  function membersDeclaredBy(packageName: string): Set<string> {
    let names = dependencyMembers.get(packageName);
    if (names) return names;
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isClassElement(node) || ts.isTypeElement(node)) {
        const name = nameText(node.name);
        if (name !== undefined) found.add(name);
      }
      ts.forEachChild(node, visit);
    };
    for (const file of program.getSourceFiles()) {
      if (packageOf(file.fileName) === packageName) visit(file);
    }
    names = found;
    dependencyMembers.set(packageName, names);
    return names;
  }

  /**
   * A value passed to a runtime dependency is the dependency's to call into by name, as pixi does
   * with an extension's static `extension` or a system's `renderStart` runner hook, so its members
   * named like one the dependency declares count as used.
   * @param call - A call or `new` expression
   */
  function markHandedToDependency(call: ts.CallExpression | ts.NewExpression): void {
    const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
    const declaration = checker.getSymbolAtLocation(callee)?.declarations?.[0];
    const packageName = declaration && packageOf(declaration.getSourceFile().fileName);
    if (!packageName || !runtimeDependencies.has(packageName)) return;
    const names = membersDeclaredBy(packageName);
    for (const argument of call.arguments ?? []) {
      let type = checker.getTypeAtLocation(ts.isSpreadElement(argument) ? argument.expression : argument);
      if (ts.isSpreadElement(argument)) type = checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type;
      for (const value of type.isUnion() ? type.types : [type]) {
        const instances = value.getConstructSignatures().map((signature) => signature.getReturnType());
        for (const member of [value, ...instances].flatMap((t) => t.getProperties())) {
          if (names.has(member.name)) mark(member);
        }
      }
    }
  }

  const visitUsage = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      markReference(node);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      mark(checker.getShorthandAssignmentValueSymbol(node));
      markProperty(checker.getContextualType(node.parent), node.name.text);
    } else if (
      (ts.isPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      markProperty(checker.getContextualType(node.parent), nameText(node.name));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      markProperty(checker.getTypeAtLocation(node.parent), nameText(node.propertyName ?? node.name));
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      markHandedToDependency(node);
    }
    ts.forEachChild(node, visitUsage);
  };
  for (const file of program.getSourceFiles()) {
    if (isUsageFile(file.fileName)) visitUsage(file);
  }

  /**
   * Whether the member, or one it overrides or implements, is used or belongs to a contract
   * someone else calls: a dependency's type, or this library's public API.
   * @param symbol - The member or export to check
   * @param seen - Symbols already visited, for cyclic heritage
   */
  function isReached(symbol: ts.Symbol, seen = new Set<ts.Symbol>()): boolean {
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    if (used.has(symbol)) return true;
    const isContract = symbol.declarations?.some(
      (declaration) => !declaration.getSourceFile().fileName.startsWith(srcDir) || !isInternal(declaration),
    );
    return Boolean(isContract) || inheritedMembers(symbol).some((member) => isReached(member, seen));
  }

  /**
   * Whether code reads the member through an object type its owner satisfies without naming it,
   * such as a parameter typed `{ textureCacheKey: number }` that receives a material.
   * @param symbol - An instance member
   * @param owner - The class, interface or object type declaring it
   */
  function isUsedStructurally(symbol: ts.Symbol, owner: ts.Node): boolean {
    const ownerType = checker.getTypeAtLocation(owner);
    return (usedByName.get(symbol.name) ?? []).some((other) =>
      other.declarations?.some((declaration) => {
        const otherOwner = declaration.parent;
        if (otherOwner === owner || !(ts.isTypeLiteralNode(otherOwner) || ts.isInterfaceDeclaration(otherOwner))) {
          return false;
        }
        return checker.isTypeAssignableTo(ownerType, checker.getTypeAtLocation(otherOwner));
      }),
    );
  }

  const unused: Finding[] = [];
  const checked = new Set<ts.Symbol>();
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(srcDir) || !isUsageFile(file.fileName)) continue;
    const visit = (node: ts.Node): void => {
      const name = checkedName(node);
      const symbol = name && isInternal(node) ? checker.getSymbolAtLocation(name) : undefined;
      if (name && symbol && !checked.has(symbol)) {
        checked.add(symbol);
        const owner = node.parent;
        const isInstanceMember =
          (ts.isClassLike(owner) || ts.isInterfaceDeclaration(owner) || ts.isTypeLiteralNode(owner)) &&
          !hasModifier(node, ts.SyntaxKind.StaticKeyword);
        if (!isReached(symbol) && !(isInstanceMember && isUsedStructurally(symbol, owner))) {
          const { line, character } = file.getLineAndCharacterOfPosition(name.getStart(file));
          unused.push({
            file: file.fileName,
            line: line + 1,
            column: character + 1,
            message:
              `'${qualifiedName(node, name.text)}' is @internal but nothing outside tests and benchmarks uses it. ` +
              'Delete it, or keep it with `// unused-internal-disable-next-line -- <reason>` between its JSDoc and ' +
              'the declaration (`/* unused-internal-disable */` ... `/* unused-internal-enable */` for a block).',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { checked: checked.size, unused };
}

/**
 * The top-level exported declaration a node of a source file names, if it is one.
 * @param node - A statement or variable declaration of a source file
 */
function topLevelExport(node: ts.Node): ts.Identifier | undefined {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  if (!statement.parent || !ts.isSourceFile(statement.parent)) return undefined;
  const name = checkedName(node);
  return name && ts.isIdentifier(name) ? name : undefined;
}

/**
 * Whether a type reference inside a declaration sits in a parameter or a function's return type,
 * the places that don't oblige the type it names to be exported.
 * @param reference - The type reference
 * @param declaration - The declaration it sits in
 */
function inSignature(reference: ts.Node, declaration: ts.Node): boolean {
  for (let current = reference; current !== declaration; current = current.parent) {
    if (ts.isParameter(current)) return true;
    const parent = current.parent;
    const isReturnType =
      (ts.isFunctionTypeNode(parent) ||
        ts.isConstructorTypeNode(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isCallSignatureDeclaration(parent) ||
        ts.isConstructSignatureDeclaration(parent) ||
        ts.isFunctionDeclaration(parent)) &&
      parent.type === current;
    if (isReturnType) return true;
  }
  return false;
}

/**
 * Reports the `@internal` exports nothing outside their own file needs. An export is needed when
 * another file, tests and benchmarks included, references it, or when an exported type that is
 * needed names it outside a parameter or return type. Public exports are always needed.
 * @param program - The project's program
 * @param alreadyReported - `file:line` of the declarations the unused check already reports
 */
function findSelfOnlyExports(program: ts.Program, alreadyReported: Set<string>): Finding[] {
  const checker = program.getTypeChecker();
  const exportsBySymbol = new Map<ts.Symbol, { file: ts.SourceFile; node: ts.Node; name: ts.Identifier }>();
  const projectFiles = program
    .getSourceFiles()
    .filter((file) => file.fileName.startsWith(root + '/') && !file.fileName.includes('/node_modules/'));

  for (const file of projectFiles) {
    if (!file.fileName.startsWith(srcDir)) continue;
    const visit = (node: ts.Node): void => {
      const name = topLevelExport(node);
      const symbol = name && checker.getSymbolAtLocation(name);
      if (name && symbol) exportsBySymbol.set(symbol, { file, node, name });
      if (ts.isSourceFile(node) || ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) {
        ts.forEachChild(node, visit);
      }
    };
    visit(file);
  }

  const needed = new Set<ts.Symbol>();
  for (const [symbol, { node }] of exportsBySymbol) {
    if (!isInternal(node)) needed.add(symbol);
  }

  const resolve = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  };

  for (const file of projectFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !ts.isExportSpecifier(node.parent)) {
        const symbol = resolve(node);
        const declared = symbol && exportsBySymbol.get(symbol);
        if (declared && declared.file !== file) needed.add(symbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const namedTypes = new Map<ts.Symbol, ts.Symbol[]>();
  for (const [symbol, { node, file }] of exportsBySymbol) {
    if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node) && !ts.isClassDeclaration(node)) continue;
    const names: ts.Symbol[] = [];
    const visit = (child: ts.Node): void => {
      const typeName = ts.isTypeReferenceNode(child)
        ? child.typeName
        : ts.isTypeQueryNode(child)
          ? child.exprName
          : ts.isExpressionWithTypeArguments(child)
            ? child.expression
            : undefined;
      if (typeName && !inSignature(child, node)) {
        const target = resolve(typeName);
        if (target && exportsBySymbol.get(target)?.file === file) names.push(target);
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    namedTypes.set(symbol, names);
  }

  const pending = [...needed];
  while (pending.length) {
    for (const named of namedTypes.get(pending.pop()!) ?? []) {
      if (needed.has(named)) continue;
      needed.add(named);
      pending.push(named);
    }
  }

  const findings: Finding[] = [];
  for (const [symbol, { file, node, name }] of exportsBySymbol) {
    if (needed.has(symbol) || !isInternal(node)) continue;
    const { line, character } = file.getLineAndCharacterOfPosition(name.getStart(file));
    if (alreadyReported.has(`${file.fileName}:${line + 1}`)) continue;
    findings.push({
      file: file.fileName,
      line: line + 1,
      column: character + 1,
      message:
        `'${name.text}' is @internal and exported, but only its own file uses it. Drop the \`export\`, unless a ` +
        'type that other files use names it outside a parameter or return type.',
    });
  }
  return findings;
}

/**
 * The tag that hides a declaration from the API reference, on the declaration or on any declaration
 * around it.
 * @param node - A declaration
 */
function hiddenTag(node: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    const tag = ts.getJSDocTags(current).find((jsDocTag) => HIDDEN_TAGS.has(jsDocTag.tagName.text));
    if (tag) return tag.tagName.text;
  }
  return undefined;
}

/**
 * True for a class or interface member the API reference leaves out: private or protected, named
 * with a leading `_` or `#`, or tagged hidden.
 * @param node - A class element or type element
 */
function isHiddenMember(node: ts.Node): boolean {
  const name = ts.isClassElement(node) || ts.isTypeElement(node) ? node.name : undefined;
  return (
    hasModifier(node, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(node, ts.SyntaxKind.ProtectedKeyword) ||
    Boolean(name && (ts.isPrivateIdentifier(name) || nameText(name)?.startsWith('_'))) ||
    hiddenTag(node) !== undefined
  );
}

/**
 * True for a function, method or constructor body that sits behind overload signatures, which
 * users never see.
 * @param node - A declaration
 */
function isOverloadImplementation(node: ts.Node): boolean {
  if (!isCallable(node) || !node.body) return false;
  const siblings: readonly ts.Node[] = ts.isClassLike(node.parent)
    ? node.parent.members
    : ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent)
      ? node.parent.statements
      : [];
  const name = nameText(ts.getNameOfDeclaration(node));
  return siblings.some(
    (sibling) =>
      sibling !== node &&
      sibling.kind === node.kind &&
      isCallable(sibling) &&
      !sibling.body &&
      nameText(ts.getNameOfDeclaration(sibling)) === name,
  );
}

function isCallable(node: ts.Node): node is Callable {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node);
}

/**
 * Reports each public declaration or member whose type, signature or `extends` base names a type of `src`
 * that the API reference leaves out: one tagged hidden, or one the entry points don't export. Only
 * what users see counts: annotations, or the inferred type where there is none, never function
 * bodies or initializers.
 * @param program - The project's program
 */
function findHiddenTypesInPublicApi(program: ts.Program): Finding[] {
  const checker = program.getTypeChecker();
  const alias = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  const publicSymbols = new Set<ts.Symbol>();
  const addPublic = (exported: ts.Symbol): void => {
    const symbol = alias(exported);
    const declarations = symbol.declarations ?? [];
    if (publicSymbols.has(symbol) || (declarations.length > 0 && declarations.every((node) => hiddenTag(node)))) {
      return;
    }
    publicSymbols.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Namespace) checker.getExportsOfModule(symbol).forEach(addPublic);
  };
  for (const entry of ENTRY_POINTS) {
    const file = program.getSourceFile(path.join(srcDir, entry));
    const moduleSymbol = file && checker.getSymbolAtLocation(file);
    if (!moduleSymbol) throw new Error(`Could not read the exports of src/${entry}`);
    checker.getExportsOfModule(moduleSymbol).forEach(addPublic);
  }

  /**
   * Why users can't look a referenced type up, or undefined when they can: it's public, a type
   * parameter, a local, or declared outside `src` or in a global augmentation.
   * @param symbol - The symbol a type reference resolves to
   */
  function hiddenReason(symbol: ts.Symbol): string | undefined {
    const declarations = symbol.declarations ?? [];
    const isAmbient = (node: ts.Node): boolean =>
      ts.findAncestor(
        node,
        (ancestor) =>
          ts.isModuleDeclaration(ancestor) &&
          (ts.isStringLiteral(ancestor.name) || Boolean(ancestor.flags & ts.NodeFlags.GlobalAugmentation)),
      ) !== undefined;
    if (
      declarations.length === 0 ||
      publicSymbols.has(symbol) ||
      symbol.flags & ts.SymbolFlags.TypeParameter ||
      declarations.some(
        (node) =>
          !node.getSourceFile().fileName.startsWith(srcDir) ||
          isAmbient(node) ||
          ts.isParameter(node) ||
          ts.findAncestor(node.parent, ts.isFunctionLike) !== undefined,
      )
    ) {
      return undefined;
    }
    const tag = declarations.map(hiddenTag).find(Boolean);
    if (tag) return `is @${tag}`;
    const ownerName = ts.getNameOfDeclaration(declarations[0].parent as ts.Declaration);
    const owner = ownerName && checker.getSymbolAtLocation(ownerName);
    const isMember = symbol.flags & (ts.SymbolFlags.ClassMember | ts.SymbolFlags.EnumMember);
    if (isMember && owner && publicSymbols.has(owner)) {
      return declarations.some(isHiddenMember) ? `is hidden from the API reference` : undefined;
    }
    return "isn't exported from @pixi/3d or @pixi/3d/extras";
  }

  /**
   * The symbols an inferred type is built from: aliases, classes, interfaces and enums, through
   * unions, intersections, type arguments and the properties of object literal types.
   * @param type - The inferred type
   * @param found - Collects the symbols
   * @param seen - Types already visited
   */
  function symbolsOfType(type: ts.Type, found: Set<ts.Symbol>, seen = new Set<ts.Type>()): void {
    if (seen.has(type)) return;
    seen.add(type);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const named = ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.Enum;
    if (symbol && symbol.flags & named) found.add(symbol);
    if (type.aliasSymbol) {
      type.aliasTypeArguments?.forEach((argument) => symbolsOfType(argument, found, seen));
      return;
    }
    if (type.isUnionOrIntersection()) {
      type.types.forEach((member) => symbolsOfType(member, found, seen));
      return;
    }
    const objectFlags = type.flags & ts.TypeFlags.Object ? (type as ts.ObjectType).objectFlags : 0;
    if (objectFlags & ts.ObjectFlags.Reference) {
      checker.getTypeArguments(type as ts.TypeReference).forEach((argument) => symbolsOfType(argument, found, seen));
    }
    if (symbol && symbol.flags & ts.SymbolFlags.ObjectLiteral) {
      for (const property of type.getProperties()) symbolsOfType(checker.getTypeOfSymbol(property), found, seen);
    }
  }

  const findings: Finding[] = [];
  const reported = new Set<string>();

  /**
   * Reports each hidden type that a part of a public declaration names.
   * @param owner - The public declaration or member to report against
   * @param label - How users name it, such as `BatchedMesh3D#items`
   * @param part - What names the type: `type`, `signature` or `declaration`
   * @param nodes - The type nodes to search, plus declarations whose inferred type counts
   * @param isMember - Whether the declaration is a class or interface member
   */
  function report(
    owner: ts.Declaration,
    label: string,
    part: string,
    nodes: readonly (ts.Node | undefined)[],
    isMember = false,
  ): void {
    const found = new Set<ts.Symbol>();
    const visit = (node: ts.Node): void => {
      if (ts.isTypeElement(node) && (isHiddenMember(node) || isNeverOption(node))) return;
      const name = ts.isTypeReferenceNode(node)
        ? node.typeName
        : ts.isExpressionWithTypeArguments(node)
          ? node.expression
          : ts.isTypeQueryNode(node)
            ? node.exprName
            : undefined;
      if (name) {
        const last = ts.isQualifiedName(name) ? name.right : ts.isPropertyAccessExpression(name) ? name.name : name;
        const symbol = checker.getSymbolAtLocation(last);
        if (symbol) found.add(alias(symbol));
      }
      ts.forEachChild(node, visit);
    };
    for (const node of nodes) {
      if (!node) continue;
      if (ts.isExpressionWithTypeArguments(node)) {
        const base = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        const symbol = checker.getSymbolAtLocation(base);
        if (symbol) found.add(alias(symbol));
      } else if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) visit(node);
      else if (ts.isGetAccessorDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) {
        symbolsOfType(checker.getTypeAtLocation(node.name), found);
      } else if (ts.isFunctionLike(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        if (signature) symbolsOfType(signature.getReturnType(), found);
      }
    }
    const file = owner.getSourceFile();
    const nameNode = ts.getNameOfDeclaration(owner) ?? owner;
    const { line, character } = file.getLineAndCharacterOfPosition(nameNode.getStart(file));
    for (const symbol of found) {
      const reason = hiddenReason(symbol);
      const key = `${label}\0${checker.getFullyQualifiedName(symbol)}`;
      if (!reason || reported.has(key)) continue;
      reported.add(key);
      const declaration = symbol.declarations![0];
      const typeName = qualifiedName(declaration, symbol.name);
      findings.push({
        file: file.fileName,
        line: line + 1,
        column: character + 1,
        message:
          `${label} is public but its ${part} names ${typeName}, which ${reason}; make the type public with ` +
          `docs, or hide ${isMember ? 'the member' : 'it'}`,
      });
    }
  }

  /**
   * The type nodes of a function-like signature, or the declaration itself where its return type
   * is inferred.
   * @param node - A function, method, constructor, accessor or signature
   */
  function signatureParts(node: ts.SignatureDeclaration): (ts.Node | undefined)[] {
    const returnType =
      ts.isConstructorDeclaration(node) || ts.isSetAccessorDeclaration(node) ? undefined : (node.type ?? node);
    return [...(node.typeParameters ?? []), ...node.parameters.map((parameter) => parameter.type), returnType];
  }

  /**
   * Reports the hidden types a public class or interface member shows.
   * @param member - The member
   * @param ownerName - The class or interface name
   */
  function reportMember(member: ts.ClassElement | ts.TypeElement, ownerName: string): void {
    if (isHiddenMember(member) || isNeverOption(member) || isOverloadImplementation(member)) return;
    if (ts.isClassStaticBlockDeclaration(member) || ts.isSemicolonClassElement(member)) return;
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const memberName = ts.isConstructorDeclaration(member) ? 'constructor' : nameText(member.name);
    if (memberName === undefined) return;
    const label = `${ownerName}${isStatic || ts.isConstructorDeclaration(member) ? '.' : '#'}${memberName}`;
    if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
      report(member, label, 'type', [member.type ?? (ts.isPropertyDeclaration(member) ? member : undefined)], true);
    } else if (ts.isGetAccessorDeclaration(member)) {
      report(member, label, 'type', [member.type ?? member], true);
    } else if (ts.isSetAccessorDeclaration(member)) {
      report(
        member,
        label,
        'type',
        member.parameters.map((parameter) => parameter.type),
        true,
      );
    } else if (ts.isFunctionLike(member)) {
      report(member, label, 'signature', signatureParts(member), true);
    }
  }

  for (const symbol of publicSymbols) {
    for (const declaration of symbol.declarations ?? []) {
      const file = declaration.getSourceFile();
      if (!file.fileName.startsWith(srcDir) || hiddenTag(declaration) || isOverloadImplementation(declaration)) {
        continue;
      }
      const label = qualifiedName(declaration, symbol.name);
      if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
        const bases = (declaration.heritageClauses ?? [])
          .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
          .flatMap((clause) => clause.types);
        report(declaration, label, 'base', bases);
        for (const member of declaration.members) reportMember(member, label);
      } else if (ts.isTypeAliasDeclaration(declaration)) {
        report(declaration, label, 'type', [...(declaration.typeParameters ?? []), declaration.type]);
      } else if (ts.isFunctionDeclaration(declaration)) {
        report(declaration, label, 'signature', signatureParts(declaration));
      } else if (ts.isVariableDeclaration(declaration)) {
        report(declaration, label, 'type', [declaration.type ?? declaration]);
      }
    }
  }
  return findings;
}

/**
 * True for an option typed `?: never`, which only exists to forbid a key.
 * @param node - A class or type member
 */
function isNeverOption(node: ts.Node): boolean {
  return (
    (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.type?.kind === ts.SyntaxKind.NeverKeyword
  );
}

/**
 * True for the code users copy, `examples/` and `playground/`, which shows only the public API.
 * @param file - Absolute path of a source file
 */
function isPublicFacingFile(file: string): boolean {
  return isUsageFile(file) && /^(?:examples|playground)\//.test(path.relative(root, file));
}

/**
 * Reports every reference from `examples/` or `playground/` to an `@internal` declaration of `src`.
 * @param program - The project's program
 */
function findInternalUsesInPublicCode(program: ts.Program): Finding[] {
  const checker = program.getTypeChecker();
  const findings: Finding[] = [];
  for (const file of program.getSourceFiles()) {
    if (!isPublicFacingFile(file.fileName)) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const declarations = symbol?.declarations ?? [];
        const internal =
          declarations.length > 0 &&
          declarations.every(
            (declaration) => declaration.getSourceFile().fileName.startsWith(srcDir) && isInternal(declaration),
          );
        if (internal) {
          const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
          findings.push({
            file: file.fileName,
            line: line + 1,
            column: character + 1,
            message:
              `'${node.text}' is @internal, and examples and the playground show only the public API. ` +
              'Use the public API that does the same, or make the declaration public.',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return findings;
}

/**
 * The disable comments in a file, in line order.
 * @param text - The file's source
 */
function directivesIn(text: string): Directive[] {
  const directives: Directive[] = [];
  let open: Directive | undefined;
  text.split('\n').forEach((source, index) => {
    const match = DIRECTIVE.exec(source);
    if (!match) return;
    const line = index + 1;
    const column = match[1].length + 1;
    if (match[2] === 'disable-next-line') {
      directives.push({ line, column, from: line + 1, to: line + 1, used: false });
    } else if (match[2] === 'disable' && !open) {
      open = { line, column, from: line, to: Infinity, used: false };
      directives.push(open);
    } else if (match[2] === 'enable' && open) {
      open.to = line;
      open = undefined;
    }
  });
  return directives;
}

/**
 * Drops the findings a disable comment covers, and adds one for each disable comment that covers none.
 * @param program - The project's program
 * @param unused - Every finding of the checks above
 */
function applyDirectives(program: ts.Program, unused: Finding[]): Finding[] {
  const remaining: Finding[] = [];
  for (const file of program.getSourceFiles()) {
    if (!isUsageFile(file.fileName)) continue;
    const directives = directivesIn(file.text);
    for (const finding of unused) {
      if (finding.file !== file.fileName) continue;
      const directive = directives.find(({ from, to }) => from <= finding.line && finding.line <= to);
      if (directive) directive.used = true;
      else remaining.push(finding);
    }
    for (const { line, column, used } of directives) {
      if (!used)
        remaining.push({
          file: file.fileName,
          line,
          column,
          message: 'Unused unused-internal-disable directive; what it covered is used now, so delete it',
        });
    }
  }
  return remaining;
}

const program = createProjectProgram();
const { checked, unused } = findUnusedInternals(program);
const selfOnly = findSelfOnlyExports(program, new Set(unused.map(({ file, line }) => `${file}:${line}`)));
const publicUses = findInternalUsesInPublicCode(program);
const hiddenTypes = findHiddenTypesInPublicApi(program);
const findings = applyDirectives(program, [...unused, ...selfOnly, ...publicUses, ...hiddenTypes]).sort(
  (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
);

for (const { file, line, column, message } of findings) {
  console.log(`${path.relative(root, file)}:${line}:${column}: ${message}`);
}
console.log(`check-unused-internal: ${checked} @internal declarations, ${findings.length} errors`);
process.exitCode = findings.length > 0 ? 1 : 0;
