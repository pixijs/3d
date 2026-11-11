import type { AstComment, Rule } from '../ast.ts';

const FENCE = /```([a-zA-Z0-9_-]*)/g;
const DASH = /[–—]/;

/**
 * Code fences are ```ts rather than the ```js/```typescript/bare variants (other languages such as
 * wgsl or json are deliberate and allowed), summary lines carry no trailing period and start with
 * a capital letter or a code reference, and the prose uses commas, semicolons, colons and full
 * stops rather than em or en dashes.
 */
export const jsdocStyle: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce ```ts example fences and the JSDoc summary style' },
  },
  create(context) {
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

    function checkDashes(comment: AstComment): void {
      const lines = comment.value.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!DASH.test(lines[i])) continue;
        context.report({
          loc: { start: { line: comment.loc.start.line + i, column: 0 } },
          message:
            'JSDoc uses an em or en dash; rewrite the sentence with a comma, semicolon, colon or full stop, ' +
            'and write a range as "0 to 1"',
        });
      }
    }

    return {
      Program(node) {
        for (const comment of node.comments ?? []) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
          checkSummary(comment);
          checkDashes(comment);
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
    };
  },
};
