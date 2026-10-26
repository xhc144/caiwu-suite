import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 约定：*.test.ts 跑在 Node 环境（领域逻辑、服务、接口）；*.test.tsx 跑在 jsdom（组件）。
// *.spec.ts 是 Playwright E2E，不归 Vitest 管。
const roots = ['apps', 'packages', 'modules', 'scripts'];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: roots.map((r) => `${r}/**/*.test.ts`),
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: roots.map((r) => `${r}/**/*.test.tsx`),
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: ['./packages/testkit/src/dom-setup.ts'],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
