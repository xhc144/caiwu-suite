import { test as base, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import type { CoreServices } from '@caiwu/core/server';
import { E2E_APP_TOKEN } from '@caiwu/testkit/e2e';
import server from '../server';

export type Isolated = {
  origin: string;
  request: APIRequestContext;
  inBook<T>(bookId: string, fn: (svc: CoreServices) => Promise<T>): Promise<T>;
};
type ServerExit = { code: number | null; signal: string | null; error?: Error };

async function closeServer(child: ChildProcess, exited: Promise<ServerExit>, dataDir: string) {
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`发票服务未正常退出，保留临时目录：${dataDir}`)),
          5_000,
        );
      }),
    ]);
    if (result.error || result.code !== 0)
      throw new Error(
        `发票服务异常退出（${result.code ?? result.signal ?? result.error?.message}），保留临时目录：${dataDir}`,
      );
    await rm(dataDir, { recursive: true, force: true });
  } finally {
    clearTimeout(timer);
  }
}

export const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ playwright }, use) => {
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
    const exited = new Promise<ServerExit>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', (error) => resolve({ code: null, signal: null, error }));
    });
    let request: APIRequestContext | undefined;
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
      request = await playwright.request.newContext({ baseURL: origin });
      await use({
        origin,
        request,
        async inBook(bookId, fn) {
          // 子服务 READY 后才加入数据目录。真实过程取得请求及账套租约，
          // 此种子过程只在本进程调用，不挂载 HTTP；兼容新旧共享层。
          const m = moduleKit(server.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'invoice.voucher' })
              .mutation(({ ctx }) => fn(ctx.svc)),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...server, router }],
            devMode: true,
          });
          const session = runtime.sessions.create(bookId, 1);
          try {
            return await router.createCaller({ app: runtime, token: session.token }).seed();
          } finally {
            runtime.sessions.delete(session.token);
            await runtime.bookStore.closeAll();
          }
        },
      });
    } finally {
      try {
        await request?.dispose();
      } finally {
        await closeServer(child, exited, dataDir);
      }
    }
  },
});
export { expect } from '@playwright/test';
