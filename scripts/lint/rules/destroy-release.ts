import type { AstNode, Rule } from '../ast.ts';

/**
 * `destroy()` releases a field by nulling it, `(this.field as FieldType | null) = null`, not by emptying the
 * container it holds. Nulling drops the whole container in one write and leaves nothing to walk, while
 * `.clear()`, `.length = 0` and a `delete` loop keep the emptied container alive on a dead object. A cast
 * field is released with `null`, not `undefined`, so every destroyed field reads the same. The contract is
 * in CODING_STANDARDS.md under "Resource lifetime".
 */
export const destroyRelease: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require destroy() to null fields rather than empty their containers' },
  },
  create(context) {
    function report(node: AstNode, field: string, form: string): void {
      const problem = form === '`undefined`' ? 'releases' : 'empties';
      context.report({
        node,
        message:
          `destroy() ${problem} \`this.${field}\` with ${form}. Release the field with \`null\` instead: ` +
          `\`(this.${field} as FieldType | null) = null\`, keeping \`readonly\` (CODING_STANDARDS.md, Resource lifetime).`,
      });
    }

    return {
      UnaryExpression(node: AstNode): void {
        if (node.operator !== 'delete') return;
        const target = node.argument;
        if (target?.type !== 'MemberExpression') return;
        const field = thisFieldName(target.object);
        if (field && insideDestroy(node)) report(node, field, '`delete`');
      },
      CallExpression(node: AstNode): void {
        const callee = node.callee;
        if (callee?.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property?.name !== 'clear' || node.arguments?.length) return;
        const field = thisFieldName(callee.object);
        if (field && insideDestroy(node)) report(node, field, '`.clear()`');
      },
      AssignmentExpression(node: AstNode): void {
        const left = node.left;
        if (node.operator !== '=') return;
        if (left?.type === 'TSAsExpression' && node.right?.type === 'Identifier' && node.right.name === 'undefined') {
          const field = thisFieldName(left.expression);
          if (field && insideDestroy(node)) report(node, field, '`undefined`');
          return;
        }
        if (left?.type !== 'MemberExpression' || left.computed) return;
        if (left.property?.name !== 'length' || node.right?.type !== 'Literal' || node.right.raw !== '0') return;
        const field = thisFieldName(left.object);
        if (field && insideDestroy(node)) report(node, field, '`.length = 0`');
      },
    };
  },
};

/**
 * The field name when the node reads a field of `this`, as in `this.field` or `this._field`.
 * @param node - The expression to inspect
 */
function thisFieldName(node: AstNode | null | undefined): string | null {
  if (node?.type !== 'MemberExpression' || node.computed || node.object?.type !== 'ThisExpression') return null;
  return node.property?.name ?? null;
}

/**
 * True when the node runs as part of a `destroy()` method body, looking through arrow functions,
 * which share the method's `this`.
 * @param node - The node to place
 */
function insideDestroy(node: AstNode): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'ArrowFunctionExpression') continue;
    if (current.type === 'FunctionExpression' || current.type === 'FunctionDeclaration') {
      const method = current.parent;
      return method?.type === 'MethodDefinition' && !method.static && method.key?.name === 'destroy';
    }
  }
  return false;
}
