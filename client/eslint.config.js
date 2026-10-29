import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import argus from './eslint-rules/index.js'

// argus/no-raw-style-scale ratchet (plan 005): `error` in the directories that
// have been migrated onto the locked scales, `warn` everywhere else so editors
// show the debt without failing `npm run verify`. Each migration PR adds its
// directory here; the last one drops the `warn` block and makes it global.
const STYLE_SCALE_ENFORCED = [
  'src/components/primitives/**/*.tsx',
]
// Files inside an enforced directory that are still mid-migration (warn only).
// Form, States and Toast were being changed by parallel work when the rule
// landed; migrate them and delete them from this list.
const STYLE_SCALE_PENDING = [
  'src/components/primitives/Form.tsx',
  'src/components/primitives/States.tsx',
  'src/components/primitives/Toast.tsx',
]

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
      'argus/no-raw-style-scale': 'warn',
    },
  },
  {
    files: STYLE_SCALE_ENFORCED,
    ignores: STYLE_SCALE_PENDING,
    rules: {
      'argus/no-raw-style-scale': 'error',
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
