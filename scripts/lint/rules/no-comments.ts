import type { AstComment, AstNode, Rule } from '../ast.ts';
import { getDocComment, isDirective } from '../ast.ts';

const DOCUMENTED_NODES = [
  'ClassDeclaration',
  'FunctionDeclaration',
  'TSDeclareFunction',
  'VariableDeclaration',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSEnumMember',
  'TSModuleDeclaration',
  'MethodDefinition',
  'PropertyDefinition',
  'AccessorProperty',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSPropertySignature',
  'TSMethodSignature',
  'TSIndexSignature',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'Property',
  'TSParameterProperty',
  'ExportDefaultDeclaration',
];

function key(comment: AstComment): string {
  return `${comment.loc.start.line}:${comment.loc.start.column}`;
}

/**
 * The only comments are JSDoc blocks on declarations and tool directives (lint and TypeScript
 * suppressions, formatter ignores, bundler annotations, license headers, shader language tags). An
 * explanation that would be a comment moves into a name, a type, a test, or the JSDoc of an
 * extracted declaration.
 */
export const noComments: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Allow only JSDoc on declarations and tool directives as comments' },
  },
  create(context) {
    const attached = new Set<string>();
    const visitor: Record<string, (node: AstNode) => void> = {};

    for (const type of DOCUMENTED_NODES) {
      visitor[type] = (node) => {
        const doc = getDocComment(
          context.sourceCode,
          node,
          (comment) => comment.type === 'Line' || isDirective(comment),
        );
        if (doc) attached.add(key(doc));
      };
    }

    visitor['Program:exit'] = (node) => {
      for (const comment of node.comments ?? []) {
        if (isDirective(comment)) continue;
        if (comment.type === 'Block' && comment.value.startsWith('*')) {
          if (attached.has(key(comment))) continue;
          context.report({
            loc: { start: comment.loc.start },
            message: 'JSDoc must sit directly on a declaration; move this onto one or delete it',
          });
          continue;
        }
        context.report({
          loc: { start: comment.loc.start },
          message:
            'Code comments are not allowed; move the explanation into a name, a type, a test, or the JSDoc of a declaration',
        });
      }
    };

    return visitor;
  },
};
