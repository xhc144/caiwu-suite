import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// E2E 跑的是生产构建的网页（apps/web/dist）+ 真实本地服务，数据放在临时目录。
// 先 `pnpm build:web`，或者直接用 `pnpm e2e`。
const port = Number(process.env.CAIWU_E2E_PORT ?? 4317);
const dataDir = path.join(os.tmpdir(), `caiwu-e2e-${process.pid}-${Date.now()}`);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: ['apps/*/e2e/**/*.spec.ts', 'modules/*/e2e/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'node --import tsx apps/server/src/main.ts',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      CAIWU_PORT: String(port),
      CAIWU_TOKEN: 'e2e-token',
      CAIWU_DEV: '1',
      CAIWU_DATA_DIR: dataDir,
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
  },
});
