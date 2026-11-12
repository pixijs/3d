import { destroyRelease } from './rules/destroy-release.ts';
import { jsdocFormat } from './rules/jsdoc-format.ts';
import { jsdocParams } from './rules/jsdoc-params.ts';
import { jsdocStyle } from './rules/jsdoc-style.ts';
import { noComments } from './rules/no-comments.ts';
import { numberFieldInitializer } from './rules/number-field-initializer.ts';
import { privateMemberNaming } from './rules/private-member-naming.ts';
import { requireExportJsdoc } from './rules/require-export-jsdoc.ts';
import { requireMemberApiDoc } from './rules/require-member-api-doc.ts';
import { requireStandardExample } from './rules/require-standard-example.ts';
import { requireTildeImports } from './rules/require-tilde-imports.ts';
import { shaderReservedWords } from './rules/shader-reserved-words.ts';

/** The repo's own oxlint rules, loaded as a JS plugin under the `pixijs-3d` namespace. */
export default {
  meta: { name: 'pixijs-3d' },
  rules: {
    'require-export-jsdoc': requireExportJsdoc,
    'require-member-api-doc': requireMemberApiDoc,
    'jsdoc-style': jsdocStyle,
    'jsdoc-format': jsdocFormat,
    'jsdoc-params': jsdocParams,
    'private-member-naming': privateMemberNaming,
    'require-tilde-imports': requireTildeImports,
    'number-field-initializer': numberFieldInitializer,
    'no-comments': noComments,
    'require-standard-example': requireStandardExample,
    'destroy-release': destroyRelease,
    'shader-reserved-words': shaderReservedWords,
  },
};
