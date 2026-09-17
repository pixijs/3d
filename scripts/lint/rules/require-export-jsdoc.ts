import type { Rule } from '../ast.ts';
import { getDocComment } from '../ast.ts';

/** Must stay in sync with `categoryOrder` in `.configs/typedoc.json`. */
const CATEGORIES = new Set([
  'animation',
  'scene',
  'rendering',
  'filters',
  'accessibility',
  'assets',
  'utils',
  'environment',
  'events',
  'extensions',
  'maths',
  'geometry',
  'materials',
  'extras:camera',
  'extras:debug',
  'extras:materials',
  'extras:particles',
  'extras:post-processing',
]);

const REQUIRED_TAG = /@(category|internal|ignore|private)\b/g;
const CATEGORY_VALUE = /@category\s+([^\s*]+)/;

/**
 * Every exported declaration has a JSDoc block carrying exactly one of `@category` / `@internal` /
 * `@ignore` / `@private`, and `@category` values come from the typedoc category list. Ported from
 * pixijs's `require-export-jsdoc`, made stricter by the exactly-one and category checks.
 *
 * Default exports, `declare global` / PixiMixins augmentations, and re-exported renames are not
 * visited; symbols re-exported through the auto-generated barrels are judged where they are declared.
 */
export const requireExportJsdoc: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require JSDoc with exactly one of @category/@internal/@ignore/@private on exports' },
  },
  create(context) {
    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration) return;
        const doc = getDocComment(context.sourceCode, node);
        if (!doc) {
          context.report({ node, message: 'Exported items must have JSDoc comments' });
          return;
        }
        const tags = doc.value.match(REQUIRED_TAG) ?? [];
        if (tags.length === 0) {
          context.report({ node, message: 'JSDoc must include one of: @category, @internal, @ignore, @private' });
          return;
        }
        if (tags.length > 1) {
          context.report({
            node,
            message: `JSDoc must include exactly one of @category/@internal/@ignore/@private, found: ${tags.join(', ')}`,
          });
          return;
        }
        if (tags[0] === '@category') {
          const value = CATEGORY_VALUE.exec(doc.value)?.[1];
          if (!value || !CATEGORIES.has(value)) {
            context.report({
              node,
              message: `@category "${value ?? ''}" is not in .configs/typedoc.json categoryOrder`,
            });
          }
        }
      },
    };
  },
};
