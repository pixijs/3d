import path from 'node:path';

import type { AstNode, Rule, Visitor } from '../ast.ts';

/**
 * Test and scene files import source code through the `~/` alias rather than relative paths. A
 * `.test.ts` file may still reach its own top-level `src/` folder relatively. Ported from pixijs's
 * `require-tilde-imports`; the autofix writes the full `~/` path because this repo's tests import
 * modules directly rather than through the folder barrels.
 */
export const requireTildeImports: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require ~/ imports for source code in .test.ts and .scene.ts files' },
    fixable: 'code',
  },
  create(context): Visitor {
    const filename = context.filename;
    const isTest = filename.endsWith('.test.ts');
    if (!isTest && !filename.endsWith('.scene.ts')) return {};

    const srcDir = path.join(context.cwd, 'src');
    const fileTopLevel = path.relative(srcDir, filename).split(path.sep)[0];

    function checkImport(node: AstNode): void {
      const source = node.source;
      const original = source?.value;
      if (!source || typeof original !== 'string' || !original.startsWith('.')) return;

      const resolved = path.resolve(path.dirname(filename), original);
      if (resolved !== srcDir && !resolved.startsWith(srcDir + path.sep)) return;

      const relativeToSrc = path.relative(srcDir, resolved).split(path.sep).join('/');
      if (isTest && relativeToSrc.split('/')[0] === fileTopLevel) return;

      context.report({
        node: source,
        message:
          `Use '~/${relativeToSrc}' instead of relative import '${original}'. ` +
          'Test and scene files should use ~/ paths for source imports.',
        fix(fixer) {
          const quote = source.raw?.[0] ?? "'";
          return fixer.replaceText(source, `${quote}~/${relativeToSrc}${quote}`);
        },
      });
    }

    return {
      ImportDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ExportAllDeclaration: checkImport,
    };
  },
};
