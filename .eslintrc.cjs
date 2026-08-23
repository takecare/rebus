/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  env: { browser: true, es2022: true, node: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  rules: {
    // SPEC §7.2: shared/ is the only place the rules live, and it must stay
    // runnable in Node, in the Workers runtime and in the browser. Importing
    // an app layer, or a runtime-specific API, breaks that.
    'no-restricted-imports': ['error', { patterns: ['**/client/*', '**/server/*', 'node:*', 'react*'] }],
    'no-unused-vars': 'off',
    'no-undef': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      files: ['server/**/*.ts', 'client/**/*.ts', 'client/**/*.tsx', 'test/**/*.ts', '*.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '.wrangler', '*.config.js', '*.cjs'],
};
