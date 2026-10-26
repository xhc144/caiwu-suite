import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import type { CoreServices } from '@caiwu/core/server';
import balancesServer from '../server';

type LocalServer = {
  url: string;
  request: APIRequestContext;
  seed: (bookId: string, fn: (svc: CoreServices) => Promise<void>) => Promise<void>;
};

/** 独占目录、随机端口与真实生产网页。绝不读取 Playwright 公用服务的账套目录。 */
export const test = base.extend<{ localServer: LocalServer }>({
  localServer: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-balances-e2e-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve('apps/server/src/main.ts')],
      {
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
      },
    );
    let output = '';
    child.stderr.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-12_000);
    });
    let request: APIRequestContext | undefined;
    const runtime = createRuntime({ dataDir, modules: [balancesServer], devMode: true });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`余额表独立服务启动超时：${output}`)),
          20_000,
        );
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`余额表独立服务退出 ${code}：${output}`));
        });
        child.stdout.on('data', (data: Buffer) => {
          output = (output + data.toString()).slice(-12_000);
          const match = /CAIWU_READY (\{[^\n]+\})/.exec(output);
          if (match) {
            clearTimeout(timer);
            resolve((JSON.parse(match[1]!) as { port: number }).port);
          }
        });
      });
      const url = `http://127.0.0.1:${port}`;
      request = await playwright.request.newContext({ baseURL: url });
      await use({
        url,
        request,
        async seed(bookId, fn) {
          const opened = runtime.bookStore.open(bookId);
          const user = await loadServiceUser(opened.db, 1);
          if (!user) throw new Error('独立测试账套缺少管理员');
          await fn(
            createCoreServices({
              db: opened.db,
              user,
              moduleId: null,
              modules: runtime.modules.lookup,
              now: runtime.now,
            }),
          );
          await runtime.bookStore.closeAll();
        },
      });
    } finally {
      await runtime.bookStore.closeAll();
      await request?.dispose();
      if (child.exitCode == null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await exited;
        clearTimeout(force);
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
