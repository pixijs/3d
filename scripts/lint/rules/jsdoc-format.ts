import type { AstComment, Rule } from '../ast.ts';
import { afterDelimiters, lineText, parseParam, tagNames } from '../jsdoc.ts';

/** Tags that let a block stay multi-line however short it is */
const MULTILINE_TAGS = new Set(['param', 'returns', 'see', 'deprecated', 'typeParam']);

/** A tagless block whose description reaches this many characters may stay multi-line */
const MULTILINE_DESCRIPTION_LENGTH = 115;

interface Problem {
  /** Line offset from the comment's first line */
  line: number;
  message: string;
}

interface BodyLine {
  text: string;
  line: number;
}

/**
 * Every problem in one JSDoc block, and the block rewritten without them.
 * @param comment - A comment whose value starts with `*`
 */
function formatBlock(comment: AstComment): { problems: Problem[]; fixed: string } {
  const raw = afterDelimiters(comment.value);
  const last = raw.length - 1;
  const problems: Problem[] = [];

  const texts = raw.map((line, i) => {
    if (i === last || !line.startsWith('*')) return lineText(line);
    problems.push({ line: i, message: 'Remove the extra `*` at the start of this line' });
    return lineText(line.replace(/^\*+/, ''));
  });
  if (comment.value.length > 1 && comment.value.endsWith('*')) {
    problems.push({ line: last, message: 'Remove the extra `*` before `*/`' });
    texts[last] = texts[last].replace(/\s*\*+$/, '');
  }

  const body: BodyLine[] = texts
    .map((text, line) => ({ text, line }))
    .filter(({ text, line }) => last === 0 || (line !== 0 && line !== last) || text !== '');
  const tags = tagNames(body.map(({ text }) => text));
  const firstTag = tags.findIndex((tag) => tag !== null);
  const description = body
    .slice(0, firstTag === -1 ? body.length : firstTag)
    .map(({ text }) => text.trim())
    .filter((text) => text !== '')
    .join(' ');

  for (let i = 0; i < body.length; i++) {
    if (tags[i] !== 'param') continue;
    const param = parseParam(body[i].text);
    if (!param || param.descriptionStart === -1 || body[i].text[param.descriptionStart] === '-') continue;
    problems.push({ line: body[i].line, message: 'Put ` - ` between the @param name and its description' });
    const at = param.descriptionStart;
    body[i].text = `${body[i].text.slice(0, at)}- ${body[i].text.slice(at)}`;
  }

  const removed = new Set<number>();
  /**
   * Drops the blank lines that run back from `end`, and reports the run.
   * @param end - Index after the last line of the run
   * @param stop - Lowest index the run may reach
   * @param message - What the report says
   */
  function removeBlankRun(end: number, stop: number, message: string): void {
    let start = end;
    while (start > stop && body[start - 1].text === '') start--;
    if (start === end) return;
    problems.push({ line: body[start].line, message });
    for (let i = start; i < end; i++) removed.add(i);
  }
  if (firstTag > 0 && description !== '') {
    removeBlankRun(firstTag, 0, 'Remove the blank line between the description and the first tag');
  }
  for (let start = firstTag; start !== -1 && start < body.length;) {
    let next = start + 1;
    while (next < body.length && tags[next] === null) next++;
    removeBlankRun(next, start + 1, 'Remove the blank line after this tag');
    start = next;
  }

  const tagList = tags.filter((tag) => tag !== null);
  const contentLines = body.filter(({ text }) => text.trim() !== '').length;
  const collapse =
    last > 0 &&
    description.length < MULTILINE_DESCRIPTION_LENGTH &&
    !description.includes('```') &&
    (tagList.length === 0 ||
      (tagList.length === 1 && description === '' && !MULTILINE_TAGS.has(tagList[0]) && contentLines === 1));

  if (collapse) {
    problems.push({ line: 0, message: 'This JSDoc fits on one line; write it as `/** … */`' });
  } else if (last > 0) {
    if (texts[0] !== '') problems.push({ line: 0, message: 'Move the text after `/**` onto a line of its own' });
    if (texts[last] !== '') problems.push({ line: last, message: 'Move the text before `*/` onto a line of its own' });
  }

  const kept = body.filter((_, i) => !removed.has(i)).map(({ text }) => text);
  let fixed: string;
  if (collapse || last === 0) {
    const single = kept
      .map((text) => text.trim())
      .filter((text) => text !== '')
      .join(' ');
    fixed = single === '' ? '/** */' : `/** ${single} */`;
  } else {
    const pad = ' '.repeat(comment.loc.start.column);
    fixed = ['/**', ...kept.map((text) => (text === '' ? `${pad} *` : `${pad} * ${text}`)), `${pad} */`].join('\n');
  }
  return { problems, fixed };
}

/**
 * The layout of every JSDoc block, as pixijs writes them: a block that fits on one line is a
 * one-line block, a multi-line block keeps its text off the `/**` and `*\/` lines, no blank line
 * follows the description or a tag, no line starts with a second `*`, and a `@param` description
 * follows a hyphen. One fix rewrites the block with every problem resolved.
 *
 * A multi-line block may stay multi-line when it has a tag from {@link MULTILINE_TAGS}, more than one
 * tag, a description and a tag, a description of at least {@link MULTILINE_DESCRIPTION_LENGTH}
 * characters, a tag spanning several lines, or a code fence in its description.
 */
export const jsdocFormat: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the layout of JSDoc blocks and the hyphen before @param descriptions' },
    fixable: 'code',
  },
  create(context) {
    return {
      Program(node) {
        for (const comment of node.comments ?? []) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
          const { problems, fixed } = formatBlock(comment);
          for (const problem of problems) {
            context.report({
              loc: { start: { line: comment.loc.start.line + problem.line, column: 0 } },
              message: problem.message,
              fix: (fixer) => fixer.replaceTextRange(comment.range, fixed),
            });
          }
        }
      },
    };
  },
};
