import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Files that need a DOM opt in with a `@vitest-environment happy-dom` docblock.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/data/world.generated.ts'],
    },
  },
});
