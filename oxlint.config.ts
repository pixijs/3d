import { defineConfig } from 'oxlint';

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
    reportUnusedDisableDirectives: 'error',
  },
  plugins: ['eslint', 'typescript', 'import', 'jsdoc', 'unicorn', 'vitest'],
  jsPlugins: [
    './scripts/lint/pixi3d-plugin.ts',
    // oxlint's native `jsdoc` plugin lacks these rules, so the real one loads under an alias.
    { name: 'jsdoc-js', specifier: 'eslint-plugin-jsdoc' },
  ],
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
    'jsdoc/require-param': 'warn',
    'jsdoc/require-param-description': 'off',
    'jsdoc/require-param-name': 'warn',
    'jsdoc/require-property': 'warn',
    'jsdoc/require-property-description': 'warn',
    'jsdoc/require-property-name': 'warn',
    'jsdoc/require-property-type': 'warn',
    'jsdoc/require-returns-description': 'warn',
    'jsdoc-js/multiline-blocks': [
      'warn',
      {
        noMultilineBlocks: true,
        minimumLengthForMultiline: 115,
        multilineTags: ['param', 'returns', 'see', 'deprecated', 'typeParam'],
      },
    ],
    'jsdoc-js/check-alignment': 'warn',
    'jsdoc-js/check-param-names': 'warn',
    'jsdoc-js/check-types': 'warn',
    'jsdoc-js/check-values': 'warn',
    'jsdoc-js/tag-lines': 'warn',
    'jsdoc-js/no-multi-asterisks': ['warn', { allowWhitespace: true }],
    // The native rule has no `contexts` option.
    'jsdoc-js/require-param-type': ['warn', { contexts: ['TSMethodSignature'] }],
    'jsdoc-js/require-hyphen-before-param-description': 'warn',
    'jsdoc-js/valid-types': 'warn',
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
        'pixi3d/private-member-naming': 'error',
        'typescript/no-unsafe-declaration-merging': 'off',
        'typescript/no-duplicate-enum-values': 'off',
      },
    },
    {
      files: ['src/**/*.ts'],
      rules: {
        'pixi3d/no-comments': 'error',
      },
    },
    {
      files: ['examples/**/*', 'scripts/**/*'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      rules: {
        'pixi3d/require-export-jsdoc': 'error',
        'pixi3d/require-member-api-doc': 'error',
        'pixi3d/require-standard-example': 'error',
        'pixi3d/jsdoc-style': 'error',
        'pixi3d/number-field-initializer': 'error',
      },
    },
    {
      files: ['src/**/*.ts'],
      excludeFiles: ['**/*.test.ts'],
      rules: {
        'no-restricted-globals': [
          'warn',
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
        ],
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
        'pixi3d/require-tilde-imports': 'error',
      },
    },
    {
      files: ['**/*.test.ts', '**/__tests__/**', 'tests/**', 'examples/**', 'bench/**'],
      rules: {
        'jsdoc/require-param': 'off',
      },
    },
  ],
});
