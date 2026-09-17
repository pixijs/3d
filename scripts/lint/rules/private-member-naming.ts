import type { AstNode, Rule } from '../ast.ts';
import { memberName } from '../ast.ts';

/**
 * typescript-eslint's `camelCase` format: a lowercase first character and no underscores.
 * @param name - The member name with its leading underscore removed
 */
function isCamelCase(name: string): boolean {
  return name === '' || (name[0] === name[0].toLowerCase() && !name.includes('_'));
}

function privateMemberName(node: AstNode): string | null {
  if (node.type === 'TSParameterProperty') {
    const param = node.parameter?.type === 'AssignmentPattern' ? node.parameter.left : node.parameter;
    return param?.type === 'Identifier' ? (param.name ?? null) : null;
  }
  if (node.computed || node.kind === 'constructor' || node.key?.type === 'PrivateIdentifier') return null;
  return memberName(node);
}

/**
 * A `private` class member's name is one leading underscore followed by camelCase, so
 * `private static readonly FOO` fails. The oxlint stand-in for pixijs's typescript-eslint
 * `naming-convention` selector `{ selector: 'memberLike', modifiers: ['private'], format: ['camelCase'],
 * leadingUnderscore: 'require' }`. Constructors, computed keys and `#private` names are not checked.
 */
export const privateMemberNaming: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require private class members to be named `_camelCase`' },
  },
  create(context) {
    function check(node: AstNode): void {
      if (node.accessibility !== 'private') return;
      const name = privateMemberName(node);
      if (name === null) return;
      if (!name.startsWith('_')) {
        context.report({ node, message: `Private member \`${name}\` must have one leading underscore` });
      } else if (!isCamelCase(name.slice(1))) {
        context.report({ node, message: `Private member \`${name}\` must be camelCase after its leading underscore` });
      }
    }

    return {
      PropertyDefinition: check,
      MethodDefinition: check,
      AccessorProperty: check,
      TSAbstractPropertyDefinition: check,
      TSAbstractMethodDefinition: check,
      TSAbstractAccessorProperty: check,
      TSParameterProperty: check,
    };
  },
};
