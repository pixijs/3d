import type { AstComment, AstNode, Rule } from '../ast.ts';
import { getDocComment } from '../ast.ts';

const FENCE = /```([a-zA-Z0-9_-]*)/g;
const PARAM_TAG = /@param\s+(?:\{[^}]*\}\s*)?\[?([\w$]+)/g;

function paramName(param: AstNode): string | null {
  switch (param.type) {
    case 'Identifier':
      return param.name ?? null;
    case 'AssignmentPattern':
      return param.left ? paramName(param.left) : null;
    case 'RestElement':
      return param.argument ? paramName(param.argument) : null;
    case 'TSParameterProperty':
      return param.parameter ? paramName(param.parameter) : null;
    default:
      return null;
  }
}

/**
 * Code fences are ```ts rather than the ```js/```typescript/bare variants (other languages such as
 * wgsl or json are deliberate and allowed), `@param` names match real parameters, and summary lines
 * carry no trailing period and start with a capital letter or a code reference.
 */
export const jsdocStyle: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce ```ts example fences and @param names that match real parameters' },
  },
  create(context) {
    function checkParams(fnLike: AstNode, docHolder: AstNode): void {
      const doc = getDocComment(context.sourceCode, docHolder);
      if (!doc) return;
      const params = fnLike.params ?? [];
      const names = params.map(paramName);
      if (names.some((name) => name === null)) return;
      const actual = new Set(names as string[]);
      for (const match of doc.value.matchAll(PARAM_TAG)) {
        if (!actual.has(match[1])) {
          context.report({
            node: docHolder,
            message: `@param "${match[1]}" does not match any parameter (expected: ${[...actual].join(', ') || 'none'})`,
          });
        }
      }
    }

    function checkSummary(comment: AstComment): void {
      const lines = comment.value.split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trimEnd());
      const single = comment.loc.start.line === comment.loc.end.line;
      let summary: string;
      if (single) {
        const tagAt = lines[0].search(/(?:^|\s)@[a-z]/);
        summary = (tagAt === -1 ? lines[0] : lines[0].slice(0, tagAt)).replace(/\*?$/, '').trim();
      } else {
        summary = lines.find((line) => line !== '') ?? '';
      }
      if (summary !== '' && !summary.startsWith('@')) {
        if (/(?<!\.)\.$/.test(summary)) {
          context.report({
            loc: { start: { line: comment.loc.start.line, column: 0 } },
            message: 'JSDoc summary line must not end with a period',
          });
        }
        if (/^[a-z]/.test(summary) && !/^[a-z$_][\w$]*[.#]/.test(summary)) {
          context.report({
            loc: { start: { line: comment.loc.start.line, column: 0 } },
            message: 'JSDoc summary must start with a capital letter (or a code reference)',
          });
        }
      }
    }

    return {
      Program(node) {
        for (const comment of node.comments ?? []) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
          checkSummary(comment);
          let open = true;
          for (const match of comment.value.matchAll(FENCE)) {
            const lang = match[1];
            if (open && (lang === '' || lang === 'js' || lang === 'javascript' || lang === 'typescript')) {
              const lineOffset = comment.value.slice(0, match.index).split('\n').length - 1;
              context.report({
                loc: { start: { line: comment.loc.start.line + lineOffset, column: 0 } },
                message: `JSDoc example fences must be \`\`\`ts, found \`\`\`${match[1] || '(none)'}`,
              });
            }
            open = !open;
          }
        }
      },
      FunctionDeclaration(node) {
        checkParams(node, node);
      },
      TSDeclareFunction(node) {
        checkParams(node, node);
      },
      TSMethodSignature(node) {
        checkParams(node, node);
      },
      MethodDefinition(node) {
        const value = node.value;
        if (value && typeof value === 'object') checkParams(value, node);
      },
      VariableDeclaration(node) {
        const init = node.declarations?.[0]?.init;
        if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
          checkParams(init, node);
        }
      },
    };
  },
};
