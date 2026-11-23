import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import progress from 'eslint-plugin-file-progress'
import { defineConfig, globalIgnores } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'

// Dates and time zones: every local-date decision goes through api/_shared/local-time.js
// (re-exported as src/lib/local-time.js). See agents-docs/00-core-rules.md "Dates and time zones".
const LOCAL_TIME_MODULE_FILES = ['api/_shared/local-time.js', 'api/_shared/local-time.test.js']
const NO_NAME_ASSIGNMENT = {
  selector:
    "AssignmentExpression[left.type='MemberExpression'][left.property.name='name']",
  message: 'Do not assign to .name; use asError() or define a custom error class instead.',
}
const DATE_CUT_MESSAGE =
  'Do not cut a date out of an ISO string: that is the UTC date. Use localDateKey / todayKey (org zone), normalizeDateKey (a date-only value) or utcDateKey / utcFileStamp (technical stamps) from local-time.js.'
const DATE_AND_TIME_ZONE_RESTRICTIONS = [
  {
    selector: "CallExpression[callee.property.name=/^(slice|substring|substr)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
    message: DATE_CUT_MESSAGE,
  },
  {
    selector: "MemberExpression[computed=true][property.value=0][object.type='CallExpression'][object.callee.property.name='split'][object.arguments.0.value='T']",
    message: DATE_CUT_MESSAGE,
  },
  {
    selector: "CallExpression[callee.property.name='substring'][arguments.length=2][arguments.0.value=0][arguments.1.value=10]",
    message: DATE_CUT_MESSAGE,
  },
  {
    selector: "Literal[value='Asia/Jerusalem'], TemplateElement[value.raw='Asia/Jerusalem']",
    message: 'Do not hard-code the time zone. Use resolveOrgTimeZone() / the helpers in local-time.js.',
  },
]

// Money: stored in agorot, converted only through the currency helpers.
// api/_shared/round.js is the non-money rounding helper (roundTo2), which also needs * 100.
const CURRENCY_HELPER_FILES = ['src/lib/currency.js', 'api/_shared/currency.js', 'api/_shared/round.js']
const MONEY_CONVERSION_RESTRICTION = {
  selector:
    "BinaryExpression:matches([operator='*'], [operator='/']):matches([left.type='Literal'][left.value=100], [right.type='Literal'][right.value=100])",
  message:
    'Money is converted only with toAgorot()/toShekel() (src/lib/currency.js) or the api/_shared/currency.js helpers. If this * or / 100 is not money (a percentage, a day count), add `// eslint-disable-next-line no-restricted-syntax -- not money: <why>`.',
}

export default defineConfig([
  progress.configs.recommended,
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
      'no-restricted-syntax': ['error', NO_NAME_ASSIGNMENT, ...DATE_AND_TIME_ZONE_RESTRICTIONS],
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
          'archiver',
          'parse-multipart-data',
          'puppeteer-core',
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
    files: ['tests/**/*.{js,jsx,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'import/no-unresolved': 'off',
      'import/named': 'off',
      'import/default': 'off',
      'import/namespace': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx}', 'api/**/*.{js,jsx,mjs}'],
    rules: {
      'no-restricted-syntax': ['error', NO_NAME_ASSIGNMENT, ...DATE_AND_TIME_ZONE_RESTRICTIONS, MONEY_CONVERSION_RESTRICTION],
    },
  },
  {
    // The one module allowed to name the zone and to read UTC dates.
    files: LOCAL_TIME_MODULE_FILES,
    rules: {
      'no-restricted-syntax': ['error', NO_NAME_ASSIGNMENT],
    },
  },
  {
    // The currency helpers themselves do the * / 100 conversion.
    files: CURRENCY_HELPER_FILES,
    rules: {
      'no-restricted-syntax': ['error', NO_NAME_ASSIGNMENT, ...DATE_AND_TIME_ZONE_RESTRICTIONS],
    },
  },
  {
    files: ['src/lib/supabase-manager.js'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
