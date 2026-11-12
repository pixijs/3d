import { defineConfig } from 'oxlint';

/**
 * A regex for a relative import that climbs to a folder and enters it, such as `./gl/x`, `../gpu/x` or
 * `../../core/gl/x`
 * @param segment - Regex source for the folder path the import enters
 */
const relativeImportOf = (segment: string): string => `^\\.{1,2}/(\\.\\./)*${segment}(/|$)`;

/**
 * Runtime imports of a backend stay inside its folder, so each backend loads only when its renderer does
 * (`npm run test:bundle` checks the built chunks). Shared code programs against `View3DPipe` and types.
 */
const BACKEND_IMPORTS = {
  regex: relativeImportOf('(core/)?(gl|gpu)'),
  allowTypeImports: true,
  message:
    'Shared code imports core/gl and core/gpu with `import type` only; runtime backend code stays in those folders.',
};

/** `extras` is its own package entry, so nothing outside `src/extras` imports it. */
const EXTRAS_IMPORTS = {
  regex: relativeImportOf('extras'),
  message: 'Only src/extras imports extras; it ships as the separate @pixi/3d/extras entry.',
};

/** Guides and their example snippets are user code, linted like `examples/` rather than as engine source */
const DOCS = 'src/**/__docs__/**';

/** Code pixijs.com publishes, which wraps its body in an async IIFE as pixi.js's examples do */
const SITE_CODE = [DOCS, 'examples/tutorials/**'];

/**
 * The WebGL and WebGPU backends never import each other.
 * @param other - The backend folder the importing backend must not reach
 */
const crossBackendImports = (other: 'gl' | 'gpu'): { regex: string; message: string } => ({
  regex: relativeImportOf(other),
  message: 'core/gl and core/gpu never import each other; shared code for both lives outside them.',
});

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
    reportUnusedDisableDirectives: 'error',
  },
  plugins: ['eslint', 'typescript', 'import', 'jsdoc', 'unicorn', 'vitest'],
  jsPlugins: ['./scripts/lint/pixijs-3d-plugin.ts'],
  settings: {
    jsdoc: {
      tagNamePreference: {
        method: 'method',
        function: 'function',
        extends: 'extends',
        typeParam: 'typeParam',
        api: 'api',
      },
    },
  },
  rules: {
    'import/no-empty-named-blocks': 'error',
    'import/no-duplicates': 'error',
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'typescript/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
    'vitest/expect-expect': ['warn', { assertFunctionNames: ['expect', 'expect*'] }],
    // vitest supports expect(value, message) — the message names the failing iteration in looped asserts.
    'vitest/valid-expect': ['warn', { maxArgs: 2 }],
    'no-console': 'error',

    'jsdoc/check-access': 'warn',
    'jsdoc/check-property-names': 'warn',
    'jsdoc/check-tag-names': 'off',
    'jsdoc/empty-tags': 'warn',
    'jsdoc/implements-on-classes': 'warn',
    'jsdoc/require-param-description': 'off',
    'jsdoc/require-param-name': 'warn',
    'jsdoc/require-property': 'warn',
    'jsdoc/require-property-description': 'warn',
    'jsdoc/require-property-name': 'warn',
    'jsdoc/require-property-type': 'warn',
    'jsdoc/require-returns-description': 'warn',
    'pixijs-3d/jsdoc-format': 'error',
    'pixijs-3d/jsdoc-params': 'error',
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      rules: {
        'typescript/triple-slash-reference': ['warn', { path: 'always' }],
        'typescript/prefer-readonly': 'error',
        'typescript/explicit-member-accessibility': [
          'error',
          {
            accessibility: 'explicit',
            overrides: {
              accessors: 'off',
              constructors: 'no-public',
              methods: 'explicit',
              properties: 'explicit',
              parameterProperties: 'explicit',
            },
          },
        ],
        'pixijs-3d/private-member-naming': 'error',
        'typescript/no-unsafe-declaration-merging': 'off',
        'typescript/no-duplicate-enum-values': 'off',
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: [DOCS, 'src/index.docs.ts'],
      rules: {
        'pixijs-3d/no-comments': 'error',
        'pixijs-3d/shader-reserved-words': 'error',
      },
    },
    {
      files: ['tests/**/*.scene.ts', 'tests/**/*.test.ts'],
      rules: {
        'pixijs-3d/no-comments': 'error',
      },
    },
    {
      files: ['examples/**/*', 'scripts/**/*', DOCS],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: ['src/**/*.test.ts', 'src/**/__tests__/**', DOCS],
      rules: {
        'pixijs-3d/require-export-jsdoc': 'error',
        'pixijs-3d/require-member-api-doc': 'error',
        'pixijs-3d/require-standard-example': 'error',
        'pixijs-3d/jsdoc-style': 'error',
        'pixijs-3d/number-field-initializer': 'error',
        'pixijs-3d/destroy-release': 'error',
        'eslint/max-classes-per-file': ['error', { ignoreExpressions: true }],
        'typescript/no-deprecated': 'error',
        'typescript/no-explicit-any': 'error',
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: ['**/*.test.ts', DOCS],
      rules: {
        'no-console': 'off',
        'no-restricted-globals': [
          'error',
          {
            name: 'console',
            message:
              "Warn through `warn` from 'pixi.js', or `warnOnce` (src/utils/warnOnce.ts) for a warning that repeats " +
              'every frame. console is for examples/ and scripts/.',
          },
          { name: 'document', message: 'Do not use document. Use DOMAdapter instead.' },
          { name: 'Image', message: 'Do not use Image. Use DOMAdapter instead.' },
        ],
        'no-restricted-properties': [
          'warn',
          {
            object: 'URL',
            property: 'createObjectURL',
            message: 'Avoid using URL.createObjectURL. See https://github.com/pixijs/pixijs/pull/11599.',
          },
          {
            object: 'Math',
            property: 'random',
            message:
              'Draw from a seeded stream (`seededRandom`, or the `createRandom` option) so runs can repeat. ' +
              'Called through a field, Math.random allocates a boxed number per draw (#445, #519).',
          },
        ],
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: ['src/core/gl/**', 'src/core/gpu/**', 'src/index.docs.ts', '**/*.test.ts', '**/__tests__/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [BACKEND_IMPORTS, EXTRAS_IMPORTS] }],
      },
    },
    {
      files: ['src/init.ts'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [EXTRAS_IMPORTS] }],
      },
    },
    {
      files: ['src/core/gl/**/*.ts'],
      excludeFiles: ['**/*.test.ts', '**/__tests__/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [crossBackendImports('gpu'), EXTRAS_IMPORTS] }],
      },
    },
    {
      files: ['src/core/gpu/**/*.ts'],
      excludeFiles: ['**/*.test.ts', '**/__tests__/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [crossBackendImports('gl'), EXTRAS_IMPORTS] }],
      },
    },
    {
      files: ['**/*.test.ts'],
      rules: {
        'typescript/explicit-member-accessibility': 'off',
        'no-unused-expressions': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.scene.ts'],
      rules: {
        'pixijs-3d/require-tilde-imports': 'error',
      },
    },
    {
      files: ['src/**/*.ts', 'tests/**/*.ts'],
      rules: {
        'typescript/no-unnecessary-type-assertion': 'error',
      },
    },
    {
      files: SITE_CODE,
      rules: {
        'typescript/no-floating-promises': 'off',
      },
    },
    {
      // A tutorial step's starting code leaves gaps for the reader to fill, so its names can go unused
      files: ['examples/tutorials/**'],
      rules: {
        'no-unused-vars': 'off',
      },
    },
  ],
});
