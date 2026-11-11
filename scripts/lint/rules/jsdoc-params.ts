import type { AstNode, Rule } from '../ast.ts';
import { chainDocMatches, getDocComment, isExported, memberName } from '../ast.ts';
import type { ParamTag } from '../jsdoc.ts';
import { afterDelimiters, lineText, parseParam, tagNames } from '../jsdoc.ts';

const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'TSEmptyBodyFunctionExpression']);
const HIDDEN_TAG = /@(?:hidden|internal|ignore|private)\b/;
const NOT_API_FILE = /(?:^|[\\/])(?:__tests__|tests|examples|bench)[\\/]|\.test\.ts$/;

function paramName(param: AstNode): string | null {
  switch (param.type) {
    case 'Identifier':
      return param.name ?? null;
    case 'AssignmentPattern':
      return param.left ? paramName(param.left) : null;
    case 'RestElement':
      return param.argument ? paramName(param.argument) : null;
    case 'TSParameterProperty':
      return param.parameter ? paramName(param.parameter) : null;
    default:
      return null;
  }
}

interface LocatedParamTag extends ParamTag {
  /** Line offset from the comment's first line */
  line: number;
}

/**
 * The `@param` tags of a JSDoc block, in order.
 * @param value - The comment's `value`
 */
function paramTags(value: string): LocatedParamTag[] {
  const lines = afterDelimiters(value).map(lineText);
  const tags = tagNames(lines);
  const params: LocatedParamTag[] = [];
  for (let i = 0; i < lines.length; i++) {
    const param = tags[i] === 'param' ? parseParam(lines[i]) : null;
    if (param) params.push({ ...param, line: i });
  }
  return params;
}

/**
 * `@param` tags name the real parameters, in order and once each, so the docs can't drift from the
 * signature. Public functions and methods document every parameter, setters and interface members
 * aside; internal code, tests, examples and benchmarks may leave them out, so an internal block can
 * be one line. Dotted names (`options.color`) document a
 * parameter's properties and aren't matched. Destructured parameters have no name to match, so
 * their functions are skipped. On interface methods each `@param` also carries a `{type}`, as
 * pixijs writes them.
 */
export const jsdocParams: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require @param tags to match the parameters, and typed @param tags on interface methods' },
  },
  create(context) {
    const apiFile = !NOT_API_FILE.test(context.filename);

    function isPublicApi(node: AstNode): boolean {
      if (!apiFile || !isExported(node)) return false;
      if (node.accessibility === 'private' || node.accessibility === 'protected') return false;
      if (node.key?.type === 'PrivateIdentifier' || memberName(node)?.startsWith('_')) return false;
      return !chainDocMatches(context.sourceCode, node, HIDDEN_TAG);
    }

    function check(params: AstNode[] | undefined, docHolder: AstNode, requireTypes = false, implemented = false): void {
      const doc = getDocComment(context.sourceCode, docHolder);
      if (!doc) return;
      const tags = paramTags(doc.value);
      const requireAll = implemented && docHolder.kind !== 'set' && isPublicApi(docHolder);
      if (tags.length === 0 && !requireAll) return;
      const report = (tag: LocatedParamTag, message: string): void =>
        context.report({ loc: { start: { line: doc.loc.start.line + tag.line, column: 0 } }, message });

      if (requireTypes) {
        for (const tag of tags) {
          if (!tag.hasType) report(tag, `@param "${tag.name}" needs a {type}`);
        }
      }

      const names = (params ?? []).map(paramName);
      if (names.some((name) => name === null)) return;
      const documentsThis = tags.some((tag) => tag.name === 'this');
      const expected = (names as string[]).filter((name) => documentsThis || name !== 'this');
      const seen = new Set<string>();
      let index = 0;
      for (const tag of tags) {
        if (seen.has(tag.name)) {
          report(tag, `Duplicate @param "${tag.name}"`);
          return;
        }
        seen.add(tag.name);
        if (tag.name.includes('.')) continue;
        if (tag.name !== expected[index]) {
          report(
            tag,
            expected.includes(tag.name)
              ? `@param tags must name the parameters in order (expected: ${expected.join(', ')})`
              : `@param "${tag.name}" does not match any parameter (expected: ${expected.join(', ') || 'none'})`,
          );
          return;
        }
        index++;
      }
      if (requireAll && index < expected.length) {
        context.report({
          loc: { start: { line: doc.loc.start.line, column: 0 } },
          message: `Public API documents every parameter; missing @param for ${expected.slice(index).join(', ')}`,
        });
      }
    }

    function checkValue(node: AstNode): void {
      const value = node.value;
      if (value && typeof value === 'object' && FUNCTIONS.has(value.type)) check(value.params, node, false, true);
    }

    return {
      FunctionDeclaration: (node) => check(node.params, node, false, true),
      TSDeclareFunction: (node) => check(node.params, node, false, true),
      TSMethodSignature: (node) => check(node.params, node, true),
      TSPropertySignature(node) {
        const type = node.typeAnnotation?.typeAnnotation;
        if (type?.type === 'TSFunctionType') check(type.params, node);
      },
      MethodDefinition: checkValue,
      TSAbstractMethodDefinition: checkValue,
      PropertyDefinition: checkValue,
      Property: checkValue,
      VariableDeclaration(node) {
        const init = node.declarations?.[0]?.init;
        if (init && FUNCTIONS.has(init.type)) check(init.params, node, false, true);
      },
    };
  },
};
