import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import type { CoreServices } from '@caiwu/core/server';
import balancesServer from '../server';

type LocalServer = {
  url: string;
  request: APIRequestContext;
  seed: (bookId: string, fn: (svc: CoreServices) => Promise<void>) => Promise<void>;
};

type ServerExit = { code: number | null; signal: string | null; error?: Error };

async function closeLocalServer(child: ChildProcess, exited: Promise<ServerExit>, dataDir: string) {
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`余额表服务未正常退出，保留临时目录：${dataDir}`)),
          5_000,
        );
      }),
    ]);
    if (result.error || result.code !== 0)
      throw new Error(
        `余额表服务异常退出（${result.code ?? result.signal ?? result.error?.message}），保留临时目录：${dataDir}`,
      );
    await rm(dataDir, { recursive: true, force: true });
  } finally {
    clearTimeout(timer);
  }
}

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
    const exited = new Promise<ServerExit>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', (error) => resolve({ code: null, signal: null, error }));
    });
    let output = '';
    child.stderr.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-12_000);
    });
    let request: APIRequestContext | undefined;
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
          // 已确认 server READY 后才加入目录。通过真实过程取得请求/账套租约；
          // 过程只供本进程种子调用，不挂载到 HTTP，也不依赖新版独有 API。
          const m = moduleKit(balancesServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'balances.settings.edit' })
              .mutation(async ({ ctx }) => fn(ctx.svc)),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...balancesServer, router }],
            devMode: true,
          });
          const session = runtime.sessions.create(bookId, 1);
          try {
            await router.createCaller({ app: runtime, token: session.token }).seed();
          } finally {
            runtime.sessions.delete(session.token);
            // closeAll 是新旧共享层均支持的辅助 runtime 正常关闭入口。
            await runtime.bookStore.closeAll();
          }
        },
      });
    } finally {
      try {
        await request?.dispose();
      } finally {
        await closeLocalServer(child, exited, dataDir);
      }
    }
  },
});
