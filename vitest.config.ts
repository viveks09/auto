// vitest.config.ts
// Place in Angular project root alongside angular.json
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [
    angular({
      tsconfig: 'tsconfig.spec.json',
    }),
  ],

  test: {
    // Use globals (describe, it, expect) without importing them
    globals: true,

    // jsdom simulates a browser DOM — required for Angular component tests
    environment: 'jsdom',

    // Runs once before all test files
    setupFiles: ['src/test-setup.ts'],

    // Only pick up .spec.ts files inside src/ — never e2e/
    include:  ['src/**/*.spec.ts'],
    exclude:  ['e2e/**', 'node_modules/**', 'dist/**'],

    // Run tests in parallel using worker threads
    pool: 'threads',

    // Reporter: verbose in local dev, dot in CI
    reporter: process.env.CI ? ['dot', 'junit'] : ['verbose'],
    outputFile: {
      junit: 'test-results/vitest-junit.xml',
    },

    coverage: {
      // Use V8 (fast, no Babel transform needed)
      provider: 'v8',

      // What to report
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',

      // What to measure — source files only, not test files or generated code
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.routes.ts',
        'src/**/index.ts',
        'src/**/*.config.ts',
        'src/environments/**',
        'src/test-setup.ts',
      ],

      // CI fails if these thresholds are not met
      thresholds: {
        lines:     80,
        branches:  75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
