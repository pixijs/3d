import type { AstNode, Rule } from '../ast.ts';
import { memberName } from '../ast.ts';

/**
 * A class field typed `number` needs an initializer. Under `target: esnext` a bare `x: number;`
 * compiles to a field that starts as `undefined`, so V8 stores it as a generic slot and allocates
 * a fresh heap box for every float written to it. An initializer gives the field a number from
 * the start, and V8 then overwrites the float in place. `declare` and abstract fields emit no
 * runtime field, and an optional field may legitimately hold `undefined`, so none of them are
 * checked. The autofix seeds `0` (the constructor still assigns the real value) and drops the
 * annotation, except on `readonly` fields, where TypeScript would otherwise infer the literal
 * type `0`.
 */
export const numberFieldInitializer: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require an initializer on class fields typed `number`' },
    fixable: 'code',
  },
  create(context) {
    return {
      PropertyDefinition(node: AstNode): void {
        if (node.value || node.declare || node.optional) return;
        const annotation = node.typeAnnotation;
        if (annotation?.typeAnnotation?.type !== 'TSNumberKeyword') return;

        context.report({
          node,
          message:
            `Number field \`${memberName(node) ?? '?'}\` needs an initializer. Without one it starts as ` +
            '`undefined`, and V8 then allocates a new box for every float written to it.',
          // The fixer edits only the annotation and can't drop a definite-assignment `!`, so those fields are
          // reported without a fix.
          fix: node.definite
            ? undefined
            : (fixer) =>
                node.readonly ? fixer.insertTextAfter(annotation, ' = 0') : fixer.replaceText(annotation, ' = 0'),
        });
      },
    };
  },
};
