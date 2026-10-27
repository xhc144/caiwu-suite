import { defineConfig } from '@playwright/test';

// 成功更新交接独立执行；安全提示需要人工时明确失败暂停，不影响既有机械回归结论。
export default defineConfig({
  testDir: '.',
  testMatch: 'update-handoff.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: '../../../test-results/update-handoff',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
