import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared'), '@': path.resolve(import.meta.dirname, 'client/src') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 1, fileParallelism: false, testTimeout: 15000, hookTimeout: 30000 },
});
