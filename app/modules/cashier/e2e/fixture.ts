import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  test as base,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import cashierServer from '../server';

export type CashierFixture = {
  page: Page;
  request: APIRequestContext;
  baseURL: string;
  withServices: <T>(bookId: string, action: (svc: CoreServices) => Promise<T>) => Promise<T>;
};
export const test = base.extend<{ cashier: CashierFixture }>({
  cashier: async ({ browser }, use) => {
    // 夹具独占目录和由操作系统分配的端口；绝不读取全局 E2E 数据目录。
    const dataDir = await mkdtemp(path.join(tmpdir(), 'cashier-e2e-'));
    const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stderr.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`出纳独立测试服务启动超时：${output}`)),
          20000,
        );
        server.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        server.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`测试服务退出 ${code}：${output}`));
        });
        let stdout = '';
        server.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          const ready = /CAIWU_READY (\{[^\n]+\})/.exec(stdout);
          if (ready) {
            clearTimeout(timeout);
            resolve((JSON.parse(ready[1]!) as { port: number }).port);
          }
        });
      });
      const baseURL = `http://127.0.0.1:${port}`;
      const context = await browser.newContext({ baseURL, locale: 'zh-CN' });
      const request = await playwrightRequest.newContext({ baseURL });
      try {
        await use({
          page: await context.newPage(),
          request,
          baseURL,
          async withServices(bookId, action) {
            // 仅测试进程通过已知独占目录打开此测试账套；生产接口没有造数后门。
            const runtime = createRuntime({ dataDir, modules: [cashierServer], devMode: true });
            try {
              const opened = runtime.bookStore.open(bookId);
              const user = (await loadServiceUser(opened.db, 1))!;
              return await action(
                createCoreServices({
                  db: opened.db,
                  user,
                  moduleId: null,
                  now: runtime.now,
                  modules: runtime.modules.lookup,
                }),
              );
            } finally {
              await runtime.bookStore.closeAll();
            }
          },
        });
      } finally {
        await request.dispose();
        await context.close();
      }
    } finally {
      if (server.exitCode == null) {
        server.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            server.kill('SIGKILL');
            resolve();
          }, 5000);
          server.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
