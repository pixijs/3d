/** Line-level parsing of JSDoc blocks, shared by the PixiJS 3D JSDoc rules. */

/** The parts of a `@param` line that the rules check. */
export interface ParamTag {
  name: string;
  hasType: boolean;
  /** Where the description starts in the line, or -1 when the line ends after the name */
  descriptionStart: number;
}

/**
 * Each line of a JSDoc block's `value`, with the leading whitespace and `*` removed. The first entry
 * holds the text after `/**`, and in a multi-line block the last holds the text before `*\/`.
 * @param value - The comment's `value`, which starts with the second `*` of `/**`
 */
export function afterDelimiters(value: string): string[] {
  return value
    .slice(1)
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.replace(/^\s*\*?/, '')));
}

/**
 * A line's text as JSDoc tools read it: without the space that follows the delimiter or any trailing
 * whitespace. Indentation beyond that one space, as in code examples, stays.
 * @param line - One entry from {@link afterDelimiters}
 */
export function lineText(line: string): string {
  return line.replace(/^ /, '').trimEnd();
}

/**
 * The tag each line starts, or null for a line that continues a description. A line inside a code
 * fence never starts a tag, as in `comment-parser`.
 * @param lines - The block's lines from {@link lineText}
 */
export function tagNames(lines: readonly string[]): (string | null)[] {
  let fenced = false;
  return lines.map((line) => {
    const tag = fenced ? null : (/^@([\w-]+)/.exec(line.trimStart())?.[1] ?? null);
    if (line.split('```').length % 2 === 0) fenced = !fenced;
    return tag;
  });
}

/**
 * The end of the bracketed span that opens at `start`, counting nested brackets.
 * @param line - The text to scan
 * @param start - Index of the opening bracket
 * @param open - The opening bracket character
 * @param close - The closing bracket character
 */
function closingIndex(line: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < line.length; i++) {
    if (line[i] === open) depth++;
    else if (line[i] === close && --depth === 0) return i + 1;
  }
  return line.length;
}

/**
 * Splits a `@param {Type} name description` line. The type and the description are optional, and a
 * name in brackets (`[name=default]`) is optional.
 * @param line - A line that starts a `@param` tag
 */
export function parseParam(line: string): ParamTag | null {
  const head = /^\s*@param\s*/.exec(line);
  if (!head) return null;
  let at = head[0].length;
  const hasType = line[at] === '{';
  if (hasType) at = closingIndex(line, at, '{', '}');
  while (line[at] === ' ' || line[at] === '\t') at++;
  if (at >= line.length) return null;

  let name: string;
  if (line[at] === '[') {
    const end = closingIndex(line, at, '[', ']');
    name = line
      .slice(at + 1, end - 1)
      .split('=')[0]
      .trim();
    at = end;
  } else {
    name = /^\S+/.exec(line.slice(at))?.[0] ?? '';
    at += name.length;
  }

  const rest = line.slice(at);
  const descriptionStart = rest.trim() === '' ? -1 : at + rest.length - rest.trimStart().length;
  return { name, hasType, descriptionStart };
}
