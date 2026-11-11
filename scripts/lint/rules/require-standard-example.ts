import type { AstNode, Rule, RuleContext } from '../ast.ts';
import { chainDocMatches, getDocComment, isExported, memberName } from '../ast.ts';

const HIDDEN_TAG = /@(?:hidden|internal|ignore|private)\b/;
const TIER_TAG = /@(standard|advanced)\b/;

/**
 * The tier from the nearest doc comment that sets one, walking out from the node to its enclosing
 * declarations, so a member tagged `@advanced` inside a `@standard` class is advanced.
 * @param context - The rule context
 * @param node - The innermost declaration
 */
function effectiveTier(context: RuleContext, node: AstNode): string | null {
  for (let current: AstNode | null | undefined = node; current; current = current.parent) {
    const doc = getDocComment(context.sourceCode, current);
    const tier = doc ? TIER_TAG.exec(doc.value) : null;
    if (tier) return tier[1];
  }
  return null;
}

function hasExample(context: RuleContext, node: AstNode | undefined): boolean {
  if (!node) return false;
  return getDocComment(context.sourceCode, node)?.value.includes('@example') ?? false;
}

/**
 * The other half of a get/set pair in the same class body, if any.
 * @param node - A `get` or `set` accessor
 */
function accessorPartner(node: AstNode): AstNode | undefined {
  const body = node.parent?.body;
  const siblings = Array.isArray(body) ? body : [];
  const name = memberName(node);
  const otherKind = node.kind === 'get' ? 'set' : 'get';
  return siblings.find(
    (sibling) =>
      sibling !== node &&
      sibling.type === node.type &&
      sibling.kind === otherKind &&
      memberName(sibling) === name &&
      Boolean(sibling.static) === Boolean(node.static),
  );
}

/**
 * Public API whose tier is `@standard`, set on the declaration or inherited from its class or
 * interface, carries an `@example`. Constructors, deprecated members, and `@advanced` API are exempt,
 * and a get/set pair needs the example on only one half.
 */
export const requireStandardExample: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require an @example on @standard public API' },
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
      if (doc && /@deprecated\b/.test(doc.value)) return;
      if (effectiveTier(context, node) !== 'standard') return;
      if (hasExample(context, node)) return;
      if (node.kind === 'get' || node.kind === 'set') {
        const partner = accessorPartner(node);
        if (partner && (node.kind === 'set' || hasExample(context, partner))) return;
      }
      context.report({
        node,
        message:
          'Standard API needs an @example showing typical use. If no example would help, keep @standard and put ' +
          '`// oxlint-disable-next-line pixi3d/require-standard-example -- <reason>` between the JSDoc and the ' +
          'declaration; @advanced is only for API typical users never touch.',
      });
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
