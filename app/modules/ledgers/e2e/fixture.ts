import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import server from '../server';
import { seedLedgerBook } from '../test/seed';

export type LedgerEnvironment = {
  baseURL: string;
  request: APIRequestContext;
  seed: (bookId: string) => Promise<{ partnerId: number }>;
  close: () => Promise<void>;
};
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

/** 本夹具拥有目录、端口和服务；绝不推测或触碰全局 E2E/用户账套。 */
export async function startLedgerEnvironment(): Promise<LedgerEnvironment> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-ledgers-e2e-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
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
  let request: APIRequestContext | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let log = '';
      const timeout = setTimeout(() => reject(new Error(`独立账簿服务未就绪：${log}`)), 20000);
      const onData = (chunk: Buffer) => {
        log += chunk.toString();
        const ready = /CAIWU_READY (\{[^\n]+\})/.exec(log);
        if (ready) {
          clearTimeout(timeout);
          resolve((JSON.parse(ready[1]!) as { port: number }).port);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`独立账簿服务退出 ${code}：${log}`));
      });
    });
    const baseURL = `http://127.0.0.1:${port}`;
    request = await playwrightRequest.newContext({ baseURL });
    return {
      baseURL,
      request,
      async seed(bookId) {
        // 同一已知临时目录，服务创建账套后经 core 服务造数，随即关闭造数连接。
        const runtime = createRuntime({ dataDir, modules: [server], devMode: true });
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
          const seeded = await seedLedgerBook(svc);
          return { partnerId: seeded.partnerId };
        } finally {
          await runtime.bookStore.closeAll();
        }
      },
      async close() {
        try {
          await request?.dispose();
        } finally {
          try {
            await stop(child);
          } finally {
            rmSync(dataDir, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    await request?.dispose();
    await stop(child);
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}
