// ESLint 9 flat config for the whole workspace. Composition order matters: the recommended rule
// sets first, then the React rules scoped to the frontend package only, then eslint-config-prettier
// last so it can switch off every stylistic rule that would fight Prettier.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.wrangler/**',
      '**/coverage/**',
      'screenshots/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Root-level tooling config files run in Node, not in a browser or a Worker.
  {
    files: ['*.js', '*.config.js', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // React rules apply only to the PWA package. Worker code is plain TypeScript and must never be
  // judged against hook or fast-refresh rules.
  {
    files: ['packages/frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // The Worker runtime is neither Node nor a browser; it exposes the service worker global scope.
  {
    files: ['packages/worker/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },

  prettier,
);
