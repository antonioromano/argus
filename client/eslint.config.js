import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import argus from './eslint-rules/index.js'

// argus/no-raw-style-scale (plan 005): every directory is on the locked
// scales, so the rule is an error everywhere. A value that must stay exact
// (e.g. an inset that feeds terminal fit) takes an eslint-disable with a reason.

export default defineConfig([
  globalIgnores(['dist']),
  {
    linterOptions: {
      // A disable comment that no longer suppresses anything is itself an error,
      // so the escape hatch cannot outlive the code it excused.
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { argus },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // bannedTokens: legacy sizes outside the role scale, and the removed
      // easing aliases — components use the --t-* roles and var(--ease).
      'argus/no-raw-style-scale': ['error', {
        bannedTokens: ['--t-base', '--t-lg', '--t-2xl', '--t-3xl', '--ease-std', '--ease-out', '--ease-in'],
      }],
    },
  },
  {
    // The rule's own tests are full of the literals it rejects.
    files: ['src/lint/**'],
    rules: {
      'argus/no-raw-style-scale': 'off',
    },
  },
])
