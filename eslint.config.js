import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.mjs'],
        },
        alias: {
          map: [['@', './src']],
          extensions: ['.js', '.jsx', '.mjs'],
        },
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'import/no-cycle': ['error', { maxDepth: Infinity }],
      'import/no-unresolved': 'error',
      'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name='name']",
          message: 'Do not assign to .name; use asError() or define a custom error class instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              importNames: ['createClient'],
              message:
                "Do not import createClient directly. Call initializeAuthClient()/getAuthClient() from 'src/lib/supabase-manager.js'.",
            },
          ],
          patterns: [
            {
              group: ['**/supabase-tenant.js'],
              message: 'supabase-tenant.js is deprecated. Use resolveTenantClient from org-bff.js instead.',
            },
            {
              group: ['**/_shared/storage-drivers*'],
              message: 'Wrong storage drivers path. Use ../cross-platform/storage-drivers/index.js instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['api/**/*.{js,jsx,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Disable import validation for packages not in api/package.json
      // These are resolved at runtime in Azure Functions
      'import/no-unresolved': ['error', {
        ignore: [
          '@aws-sdk/',
          '@azure/',
          '@sparticuz/chromium',
        ],
      }],
      'import/named': 'off', // Azure/AWS SDKs cause false positives
      'import/namespace': 'off', // @sparticuz/chromium binary package
      'import/default': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/supabase-tenant.js'],
              message: 'supabase-tenant.js is deprecated. Use resolveTenantClient from org-bff.js instead.',
            },
            {
              group: ['**/_shared/storage-drivers*'],
              message: 'Wrong storage drivers path. Use ../cross-platform/storage-drivers/index.js instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/lib/supabase-manager.js'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
