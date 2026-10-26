import { test as base, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { E2E_APP_TOKEN } from '@caiwu/testkit/e2e';
import server from '../server';

export type Isolated = {
  origin: string;
  request: APIRequestContext;
  inBook<T>(bookId: string, fn: (svc: CoreServices) => Promise<T>): Promise<T>;
};
export const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ playwright: _playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-invoice-e2e-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: E2E_APP_TOKEN,
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let request: APIRequestContext | undefined;
    const runtime = createRuntime({ dataDir, modules: [server], devMode: true });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('独立发票服务启动超时')), 20000);
        child.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`独立发票服务退出 ${code}: ${output}`));
        });
        child.stdout.on('data', (b: Buffer) => {
          output += b.toString();
          const match = /CAIWU_READY (\{[^\n]+\})/.exec(output);
          if (match) {
            clearTimeout(timer);
            resolve((JSON.parse(match[1]!) as { port: number }).port);
          }
        });
        child.stderr.on('data', (b: Buffer) => {
          output += b.toString();
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      request = await requestFactory.newContext({ baseURL: origin });
      await use({
        origin,
        request,
        async inBook(bookId, fn) {
          const book = runtime.bookStore.open(bookId);
          const user = await loadServiceUser(book.db, 1);
          if (!user) throw new Error('测试管理员不存在');
          try {
            return await fn(
              createCoreServices({
                db: book.db,
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
      await runtime.bookStore.closeAll();
      await request?.dispose();
      if (child.exitCode == null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await exited;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
