import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The Workers test pool types `env` as `Cloudflare.Env`, so declaring the
    // Worker's bindings means declaring into that namespace. It is the
    // library's contract rather than a style choice, and the alternative is a
    // cast in every test that touches D1 or R2.
    files: ['packages/api/test/**/*.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
)
