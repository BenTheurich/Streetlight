/* Shared ESLint config for the monorepo */
// Root-level config with overrides for web (Next.js) and api (NestJS)
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  ignorePatterns: ['node_modules/', 'dist/', '.next/'],
  overrides: [
    {
      files: ['web/**/*.{ts,tsx}'],
      extends: ['next/core-web-vitals', 'plugin:@typescript-eslint/recommended'],
    },
    {
      files: ['api/**/*.ts'],
      env: { node: true, jest: true }
    }
  ]
};
