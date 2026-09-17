import { jsdocStyle } from './rules/jsdoc-style.ts';
import { privateMemberNaming } from './rules/private-member-naming.ts';
import { requireExportJsdoc } from './rules/require-export-jsdoc.ts';
import { requireMemberApiDoc } from './rules/require-member-api-doc.ts';
import { requireTildeImports } from './rules/require-tilde-imports.ts';

/** The repo's own oxlint rules, loaded as a JS plugin under the `pixi3d` namespace. */
export default {
  meta: { name: 'pixi3d' },
  rules: {
    'require-export-jsdoc': requireExportJsdoc,
    'require-member-api-doc': requireMemberApiDoc,
    'jsdoc-style': jsdocStyle,
    'private-member-naming': privateMemberNaming,
    'require-tilde-imports': requireTildeImports,
  },
};
