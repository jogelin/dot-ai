import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E tests hit the real filesystem and boot real extensions — give them room
    testTimeout: 30_000,
    hookTimeout: 15_000,
    // Global setup registers custom matchers before every test file
    setupFiles: ['./src/setup.ts'],
    // Human-readable output
    reporter: 'verbose',
  },
});
