import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs',
      'vite.config.ts',
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Browser environment for src files
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
  },

  // Node environment for electron files
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
  },

  // Security plugin rules
  {
    plugins: {
      security,
    },
    rules: {
      // Security rules - focused on actual security issues
      // Note: detect-object-injection disabled - too many false positives
      // with array index access (arr[i]) which is safe in our audio processing code
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'warn',
      'security/detect-unsafe-regex': 'error',
    },
  },

  // TypeScript-specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // Svelte files configuration
  {
    files: ['**/*.svelte'],
    plugins: {
      svelte,
    },
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...svelte.configs.recommended.rules,
      // Svelte-specific overrides
      'svelte/no-at-html-tags': 'error', // Prevent XSS via {@html}
      'svelte/no-target-blank': 'error', // Require rel="noopener" on target="_blank"
      'svelte/valid-compile': 'warn',
      // Disable rules that conflict with Svelte patterns
      'no-undef': 'off', // Svelte handles this
      '@typescript-eslint/no-unused-vars': 'off', // Svelte reactive statements
    },
  },

  // Electron main process specific rules
  {
    files: ['electron/**/*.ts'],
    rules: {
      'security/detect-child-process': 'off', // Main process needs child_process
      'security/detect-non-literal-fs-filename': 'off', // Main process needs dynamic paths
      '@typescript-eslint/no-require-imports': 'off', // Electron uses require
    },
  },

  // General code quality rules
  {
    rules: {
      'no-console': 'off', // Allow console for this app
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
    },
  }
);
