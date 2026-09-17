/** The slice of the oxlint JS plugin API (ESTree nodes, rule context) the pixi3d rules rely on. */

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
  argument?: AstNode | null;
  init?: AstNode | null;
  source?: AstNode | null;
  comments?: AstComment[];
}

interface SourceCode {
  getCommentsBefore(node: AstNode): AstComment[];
}

interface Fixer {
  replaceText(node: AstNode, text: string): unknown;
}

interface NodeDiagnostic {
  node: AstNode;
  message: string;
  fix?: (fixer: Fixer) => unknown;
}

interface LocDiagnostic {
  loc: { start: LineColumn };
  message: string;
}

interface RuleContext {
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

/**
 * The JSDoc block directly above a node (at most one blank line of separation), if any.
 * @param sourceCode - The linted file's source
 * @param node - The declaration being documented
 */
export function getDocComment(sourceCode: SourceCode, node: AstNode): AstComment | null {
  const target = docTarget(node);
  const comments = sourceCode.getCommentsBefore(target);
  const last = comments[comments.length - 1];
  if (!last || last.type !== 'Block' || !last.value.startsWith('*')) return null;
  if (target.loc.start.line - last.loc.end.line > 1) return null;
  return last;
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
