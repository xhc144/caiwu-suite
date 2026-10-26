import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import analysis from '../server';

type Isolated = {
  origin: string;
  request: APIRequestContext;
  seed: (bookId: string, fn: (svc: CoreServices) => Promise<void>) => Promise<void>;
};
const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
async function ready(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`独立测试服务未就绪：${errors}`)), 15000);
    child.stderr?.on('data', (s: Buffer) => {
      errors = (errors + s.toString()).slice(-4000);
    });
    child.stdout?.on('data', (s: Buffer) => {
      output += s.toString();
      const match = /CAIWU_READY (\{[^\n]+\})/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve((JSON.parse(match[1]!) as { port: number }).port);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`独立测试服务退出 ${code}：${errors}`));
    });
  });
}
export const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-analysis-e2e-'));
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
    let request: APIRequestContext | undefined;
    try {
      const origin = `http://127.0.0.1:${await ready(child)}`;
      request = await playwright.request.newContext({ baseURL: origin });
      await use({
        origin,
        request,
        seed: async (bookId, fn) => {
          // 只打开本夹具独占目录中、刚通过 HTTP 创建且已知 ID 的临时账套。
          const runtime = createRuntime({ dataDir, modules: [analysis], devMode: true });
          try {
            const book = runtime.bookStore.open(bookId);
            const user = (await loadServiceUser(book.db, 1))!;
            const svc = createCoreServices({
              db: book.db,
              user,
              moduleId: null,
              now: runtime.now,
              modules: runtime.modules.lookup,
            });
            await fn(svc);
          } finally {
            await runtime.bookStore.closeAll();
          }
        },
      });
    } finally {
      await request?.dispose();
      if (child.exitCode == null) {
        const stopped = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await stopped;
        clearTimeout(timer);
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
