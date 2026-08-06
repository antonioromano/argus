import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // React picks its build off process.env.NODE_ENV at import time, and a shell
    // that exports NODE_ENV=production loads the production bundle — which drops
    // `act` and the dev-only warnings. Pin it so component tests behave the same
    // in CI and in whatever env the developer happens to have.
    env: { NODE_ENV: 'development' },
  },
});
