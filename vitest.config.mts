import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/post.ts', 'src/mcp/index.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
