import type { AstNode, Rule, RuleContext, Visitor } from '../ast.ts';

/** WGSL keywords and reserved words, from the WGSL spec's "Keyword Summary" and "Reserved Words" */
const WGSL_RESERVED = new Set(
  (
    'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if ' +
    'let loop override requires return struct switch true var while ' +
    'NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch ' +
    'class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast ' +
    'consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum ' +
    'explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto ' +
    'groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match ' +
    'mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation non_coherent ' +
    'noncoherent noperspective null nullptr of operator package packoffset partition pass patch pixelfragment ' +
    'precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require ' +
    'resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super ' +
    'target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm ' +
    'unsafe unsized use using varying virtual volatile wgsl where with writeonly yield'
  ).split(' '),
);

/**
 * GLSL ES 3.00 keywords and reserved words, as Chrome's shader front end (ANGLE's `glslang.l`)
 * enforces them for WebGL2
 */
const GLSL_RESERVED = new Set(
  (
    'invariant highp mediump lowp precision const uniform break continue do for while if else switch case ' +
    'default centroid flat smooth in out inout float int uint void bool true false discard return mat2 mat3 mat4 ' +
    'mat2x2 mat3x3 mat4x4 mat2x3 mat3x2 mat2x4 mat4x2 mat3x4 mat4x3 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 ' +
    'bvec4 uvec2 uvec3 uvec4 sampler2D samplerCube samplerExternalOES sampler3D sampler3DRect sampler2DRect ' +
    'sampler2DArray isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube ' +
    'usampler2DArray sampler2DShadow samplerCubeShadow sampler2DArrayShadow struct layout ' +
    'attribute varying noperspective patch sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray ' +
    'isampler2DMSArray usampler2DMSArray samplerBuffer isamplerBuffer usamplerBuffer image2D iimage2D uimage2D ' +
    'image2DArray iimage2DArray uimage2DArray image3D uimage3D iimage3D iimageCube uimageCube imageCube ' +
    'imageBuffer iimageBuffer uimageBuffer readonly writeonly coherent restrict atomic_uint sample volatile asm ' +
    'class union enum typedef template this goto inline noinline public static extern external interface long ' +
    'short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 ' +
    'sampler2DRectShadow sampler1D sampler1DShadow sizeof cast namespace using'
  ).split(' '),
);

type Language = 'wgsl' | 'glsl';

interface Position {
  line: number;
  column: number;
}

interface TemplateElement {
  value: { raw: string };
  loc: { start: Position };
}

interface TemplateLiteral extends AstNode {
  quasis: TemplateElement[];
}

interface Declared {
  name: string;
  index: number;
}

const TAG = /^\s*(wgsl|glsl)\s*$/;
const COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const WGSL_BINDING =
  /\b(?:let|const|override|alias|struct|fn)\s+([A-Za-z_]\w*)|\bvar\b\s*(?:<[^>]*>)?\s*([A-Za-z_]\w*)/g;
const WGSL_FN_PARAMS = /\bfn\s+[A-Za-z_]\w*\s*\(((?:[^()]|\([^()]*\))*)\)/g;
const WGSL_STRUCT_BODY = /\bstruct\s+[A-Za-z_]\w*\s*\{([^}]*)\}/g;
const WGSL_TYPED_NAME = /([A-Za-z_]\w*)\s*:(?!:)/g;

const GLSL_BUILTIN_TYPE = 'void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?|[iu]?sampler\\w+';
const GLSL_STRUCT = /\bstruct\s+([A-Za-z_]\w*)/g;

/**
 * The shader language of a template literal: its `/* wgsl *\/` or `/* glsl *\/` tag, or else the
 * `gpu` (WGSL) or `gl` (GLSL) property of a ShaderBit or program it sits under
 * @param context - The rule context
 * @param node - The template literal
 */
function shaderLanguage(context: RuleContext, node: AstNode): Language | null {
  const comments = context.sourceCode.getCommentsBefore(node);
  const tag = comments[comments.length - 1];
  if (tag?.type === 'Block' && tag.loc.end.line === node.loc.start.line) {
    const match = TAG.exec(tag.value);
    if (match) return match[1] as Language;
  }
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== 'Property' || current.computed) continue;
    const key = current.key?.name;
    if (key === 'gpu') return 'wgsl';
    if (key === 'gl') return 'glsl';
  }
  return null;
}

/**
 * Every identifier a WGSL fragment declares: `let`, `var`, `const`, `override`, `alias`, `struct`
 * and `fn` names, function parameters and struct members
 * @param source - The fragment, with comments blanked out
 */
function wgslDeclarations(source: string): Declared[] {
  const found: Declared[] = [];
  for (const match of source.matchAll(WGSL_BINDING)) {
    const name = match[1] ?? match[2];
    found.push({ name, index: match.index + match[0].lastIndexOf(name) });
  }
  for (const pattern of [WGSL_FN_PARAMS, WGSL_STRUCT_BODY]) {
    for (const match of source.matchAll(pattern)) {
      const bodyStart = match.index + match[0].indexOf(match[1]);
      for (const inner of match[1].matchAll(WGSL_TYPED_NAME)) {
        found.push({ name: inner[1], index: bodyStart + inner.index });
      }
    }
  }
  return found;
}

/**
 * Every identifier a GLSL fragment declares with a built-in type or a struct the fragment defines:
 * variables, parameters, struct members and functions
 * @param source - The fragment, with comments blanked out
 */
function glslDeclarations(source: string): Declared[] {
  const structs = [...source.matchAll(GLSL_STRUCT)].map((match) => match[1]);
  const types = [GLSL_BUILTIN_TYPE, ...structs].join('|');
  const declaration = new RegExp(`\\b(?:${types})\\s+([A-Za-z_]\\w*)`, 'g');
  const found: Declared[] = structs.map((name) => ({ name, index: source.indexOf(name) }));
  for (const match of source.matchAll(declaration)) {
    found.push({ name: match[1], index: match.index + match[0].lastIndexOf(match[1]) });
  }
  return found;
}

/**
 * Why a declared name breaks the shader, or null when it's a legal identifier
 * @param language - The shader language
 * @param name - The declared identifier
 */
function reservedReason(language: Language, name: string): string | null {
  if (language === 'wgsl') {
    if (WGSL_RESERVED.has(name)) return `'${name}' is a WGSL keyword or reserved word`;
    if (name === '_' || name.startsWith('__')) return `WGSL identifiers can't be '_' or start with '__'`;
    return null;
  }
  if (GLSL_RESERVED.has(name)) return `'${name}' is a GLSL ES 3.00 keyword or reserved word`;
  if (name.startsWith('gl_')) return `GLSL reserves names that start with 'gl_'`;
  return null;
}

/**
 * The line and column of an offset inside a template element's raw text
 * @param element - The template element
 * @param raw - Its raw text
 * @param index - Offset into `raw`
 */
function positionOf(element: TemplateElement, raw: string, index: number): Position {
  const before = raw.slice(0, index);
  const newlines = before.split('\n').length - 1;
  if (newlines === 0) return { line: element.loc.start.line, column: element.loc.start.column + index };
  return { line: element.loc.start.line + newlines, column: index - before.lastIndexOf('\n') - 1 };
}

/**
 * A WGSL or GLSL identifier that's a reserved word fails shader compilation, and a WebGPU pipeline
 * that fails can take the whole tab down with it. Shader source is a string, so TypeScript never
 * sees it: this rule reads the declarations in every shader template literal, found by its
 * `wgsl`/`glsl` tag or by the `gpu`/`gl` property it sits under, and reports a reserved name.
 */
export const shaderReservedWords: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow WGSL and GLSL reserved words as names declared in shader source' },
  },
  create(context): Visitor {
    return {
      TemplateLiteral(node) {
        const language = shaderLanguage(context, node);
        if (!language) return;

        for (const element of (node as TemplateLiteral).quasis) {
          const raw = element.value.raw;
          const source = raw.replace(COMMENTS, (comment) => comment.replace(/[^\n]/g, ' '));
          const declared = language === 'wgsl' ? wgslDeclarations(source) : glslDeclarations(source);

          for (const { name, index } of declared) {
            const reason = reservedReason(language, name);
            if (!reason) continue;
            context.report({
              loc: { start: positionOf(element, raw, index) },
              message: `${reason}, so the shader fails to compile; rename it`,
            });
          }
        }
      },
    };
  },
};
