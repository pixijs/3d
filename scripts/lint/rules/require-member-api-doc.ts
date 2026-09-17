import type { AstNode, Rule } from '../ast.ts';
import { chainDocMatches, getDocComment, isExported, memberName } from '../ast.ts';

const HIDDEN_TAG = /@(?:hidden|internal|ignore|private)\b/;
const API_TAG = /@(?:standard|advanced)\b/;

/**
 * Public members are tagged `@standard` or `@advanced`, unless an enclosing declaration already
 * carries the tag or the chain is hidden from docs. Ported from pixijs's `require-member-api-doc`,
 * made stricter: a class-level tag does not exempt its members from having JSDoc.
 */
export const requireMemberApiDoc: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require @standard or @advanced JSDoc tags for public API surfaces' },
  },
  create(context) {
    function check(node: AstNode): void {
      if (node.accessibility === 'private' || node.accessibility === 'protected') return;
      if (node.kind === 'constructor') return;
      const name = memberName(node);
      if (name !== null && name.startsWith('_')) return;
      if (node.key?.type === 'PrivateIdentifier') return;
      if (chainDocMatches(context.sourceCode, node, HIDDEN_TAG)) return;
      const doc = getDocComment(context.sourceCode, node);
      if (!doc) {
        context.report({ node, message: 'Public members must have JSDoc comments' });
        return;
      }
      if (chainDocMatches(context.sourceCode, node, API_TAG)) return;
      context.report({ node, message: 'Public members must have either @standard or @advanced JSDoc tag' });
    }

    function checkSignature(node: AstNode): void {
      if (!isExported(node)) return;
      check(node);
    }

    function checkExportedDeclaration(node: AstNode): void {
      if (node.parent?.type !== 'ExportNamedDeclaration') return;
      check(node);
    }

    return {
      MethodDefinition: check,
      PropertyDefinition: check,
      TSMethodSignature: checkSignature,
      TSPropertySignature: checkSignature,
      FunctionDeclaration: checkExportedDeclaration,
      VariableDeclaration: checkExportedDeclaration,
      TSTypeAliasDeclaration: checkExportedDeclaration,
      TSInterfaceDeclaration: checkExportedDeclaration,
      TSEnumDeclaration: checkExportedDeclaration,
      ClassDeclaration: checkExportedDeclaration,
    };
  },
};
