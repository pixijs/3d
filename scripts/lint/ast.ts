/** The slice of the oxlint JS plugin API (ESTree nodes, rule context) the PixiJS 3D rules rely on. */

interface LineColumn {
  line: number;
  column: number;
}

interface Loc {
  start: LineColumn;
  end: LineColumn;
}

export interface AstComment {
  type: 'Line' | 'Block' | 'Shebang';
  value: string;
  range: [number, number];
  loc: Loc;
}

export interface AstNode {
  type: string;
  loc: Loc;
  parent?: AstNode | null;
  declaration?: AstNode | null;
  declarations?: AstNode[];
  accessibility?: 'public' | 'private' | 'protected';
  kind?: string;
  computed?: boolean;
  key?: AstNode | null;
  value?: AstNode | string | null;
  raw?: string;
  name?: string;
  params?: AstNode[];
  parameter?: AstNode | null;
  left?: AstNode | null;
  right?: AstNode | null;
  operator?: string;
  object?: AstNode | null;
  property?: AstNode | null;
  callee?: AstNode | null;
  arguments?: AstNode[];
  argument?: AstNode | null;
  expression?: AstNode | null;
  init?: AstNode | null;
  source?: AstNode | null;
  comments?: AstComment[];
  typeAnnotation?: AstNode | null;
  declare?: boolean;
  optional?: boolean;
  definite?: boolean;
  readonly?: boolean;
  static?: boolean;
  body?: AstNode | AstNode[] | null;
}

interface SourceCode {
  getCommentsBefore(node: AstNode): AstComment[];
}

interface Fixer {
  replaceText(node: AstNode, text: string): unknown;
  insertTextAfter(node: AstNode, text: string): unknown;
  replaceTextRange(range: [number, number], text: string): unknown;
}

interface NodeDiagnostic {
  node: AstNode;
  message: string;
  fix?: (fixer: Fixer) => unknown;
}

interface LocDiagnostic {
  loc: { start: LineColumn };
  message: string;
  fix?: (fixer: Fixer) => unknown;
}

export interface RuleContext {
  sourceCode: SourceCode;
  filename: string;
  cwd: string;
  report(diagnostic: NodeDiagnostic | LocDiagnostic): void;
}

export type Visitor = Record<string, (node: AstNode) => void>;

export interface Rule {
  meta: { type: 'problem'; docs: { description: string }; fixable?: 'code' };
  create(context: RuleContext): Visitor;
}

/**
 * Doc comments attach ahead of the `export` keyword, so look up from the export wrapper.
 * @param node - The declaration being documented
 */
function docTarget(node: AstNode): AstNode {
  const parent = node.parent;
  if (parent && (parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration')) {
    return parent;
  }
  return node;
}

const LINE_DIRECTIVE =
  /^\s*(?:(?:oxlint|eslint|unused-internal)-(?:disable|enable)|@ts-(?:expect-error|ignore|nocheck)|prettier-ignore|oxfmt-ignore|(?:c8|v8|istanbul) ignore|Auto-generated|AUTO-GENERATED)\b|^\/\s*<reference\b/;
const BLOCK_DIRECTIVE =
  /^\s*(?:[#@]__(?:PURE|NO_SIDE_EFFECTS)__|@vite-ignore|webpack[A-Z]\w*:|(?:oxlint|eslint|unused-internal)-(?:disable|enable)|prettier-ignore|(?:c8|v8|istanbul) ignore)\b|^!|@license\b|^\s*(?:wgsl|glsl)\s*$/;

/**
 * True for comments that instruct a tool rather than explain code: lint, TypeScript and
 * `check-unused-internal` suppressions, formatter ignores, coverage hints, triple-slash references,
 * bundler annotations, license headers, the `wgsl` and `glsl` tags editors read to highlight a
 * shader string, and the header `scripts/build/index.mts` writes into generated barrels.
 * @param comment - The comment to classify
 */
export function isDirective(comment: AstComment): boolean {
  if (comment.type === 'Shebang') return true;
  if (comment.type === 'Line') return LINE_DIRECTIVE.test(comment.value);
  return !comment.value.startsWith('*') && BLOCK_DIRECTIVE.test(comment.value);
}

/**
 * The JSDoc block directly above a node, if any. Comments that `skip` accepts may sit between the
 * block and the node; by default those are tool directives such as `oxlint-disable-next-line`.
 * @param sourceCode - The linted file's source
 * @param node - The declaration being documented
 * @param skip - Comments allowed between the JSDoc block and the node
 */
export function getDocComment(
  sourceCode: SourceCode,
  node: AstNode,
  skip: (comment: AstComment) => boolean = isDirective,
): AstComment | null {
  const target = docTarget(node);
  const comments = sourceCode.getCommentsBefore(target);
  let nextLine = target.loc.start.line;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (nextLine - comment.loc.end.line > 1) return null;
    if (comment.type === 'Block' && comment.value.startsWith('*')) return comment;
    if (!skip(comment)) return null;
    nextLine = comment.loc.start.line;
  }
  return null;
}

/**
 * True when any doc comment on the node or an enclosing declaration matches the pattern.
 * @param sourceCode - The linted file's source
 * @param node - The innermost declaration to check
 * @param pattern - Tested against each doc comment's text
 */
export function chainDocMatches(sourceCode: SourceCode, node: AstNode, pattern: RegExp): boolean {
  for (let current: AstNode | null | undefined = node; current; current = current.parent) {
    const doc = getDocComment(sourceCode, current);
    if (doc && pattern.test(doc.value)) return true;
  }
  return false;
}

export function isExported(node: AstNode): boolean {
  for (let current: AstNode | null | undefined = node; current; current = current.parent) {
    if (current.type === 'ExportNamedDeclaration' || current.type === 'ExportDefaultDeclaration') return true;
  }
  return false;
}

export function memberName(node: AstNode): string | null {
  const key = node.key;
  if (!key) return null;
  if (key.type === 'Identifier' || key.type === 'PrivateIdentifier') return key.name ?? null;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}
