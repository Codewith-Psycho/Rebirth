import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest, for the parts of the app that are pure functions.
 *
 * The only thing configuration is genuinely needed for is the `@/` alias —
 * without it every test would have to import its subject by relative path,
 * which is not how the rest of the codebase reads.
 *
 * The environment is `node` on purpose: this suite covers domain logic that
 * takes its clock as an argument, so it needs no DOM and no Supabase
 * credentials. Component tests would need `jsdom` and `@vitejs/plugin-react`,
 * both of which are already installed for that day.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
