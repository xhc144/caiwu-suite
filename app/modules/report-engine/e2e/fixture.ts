import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../server';

/** 只打开本测试创建的独占目录；服务端无造数后门，不猜测全局E2E目录。 */
export const test = base.extend<{
  isolated: {
    baseURL: string;
    request: APIRequestContext;
    seed(bookId: string, specs: VoucherSpec[]): Promise<void>;
  };
}>({
  isolated: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-report-engine-e2e-'));
    const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      cwd: appRoot,
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.join(appRoot, 'apps/web/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const runtime = createRuntime({ dataDir, modules: [reportServer], devMode: true });
    let request: APIRequestContext | undefined;
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('独立报表E2E服务未能启动')), 20_000);
        child.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`独立服务启动结束：${code}`));
        });
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const ready = /CAIWU_READY (\{[^\n]+\})/.exec(output);
          if (ready) {
            clearTimeout(timer);
            resolve((JSON.parse(ready[1]!) as { port: number }).port);
          }
        });
        // 排空stderr，避免子进程缓冲区阻塞；启动失败由退出码报告。
        child.stderr.on('data', () => {});
      });
      const baseURL = `http://127.0.0.1:${port}`;
      request = await playwright.request.newContext({ baseURL });
      await use({
        baseURL,
        request,
        async seed(bookId, specs) {
          const opened = runtime.bookStore.open(bookId);
          const user = await loadServiceUser(opened.db, 1);
          if (!user) throw new Error('本测试账套缺少管理员');
          const svc = createCoreServices({
            db: opened.db,
            user,
            moduleId: null,
            now: runtime.now,
            modules: runtime.modules.lookup,
          });
          await seedVouchers(svc, specs);
        },
      });
    } finally {
      await request?.dispose();
      await runtime.bookStore.closeAll();
      if (child.exitCode == null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
