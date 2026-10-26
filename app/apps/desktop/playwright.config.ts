import { defineConfig } from '@playwright/test';

// 独立 Electron 测试入口；不把无桌面的网页 E2E 冒充桌面或安装验证。
export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: 'list',
  outputDir: '../../test-results/desktop',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
