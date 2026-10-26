import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../server';

type ServerExit = { code: number | null; signal: string | null; error?: Error };

async function closeServer(child: ChildProcess, exited: Promise<ServerExit>, dataDir: string) {
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`报表服务未正常退出，保留临时目录：${dataDir}`)),
          5000,
        );
      }),
    ]);
    if (result.error || result.code !== 0)
      throw new Error(
        `报表服务异常退出（${result.code ?? result.signal ?? result.error?.message}），保留临时目录：${dataDir}`,
      );
    await rm(dataDir, { recursive: true, force: true });
  } finally {
    clearTimeout(timer);
  }
}

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
    const exited = new Promise<ServerExit>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', (error) => resolve({ code: null, signal: null, error }));
    });
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
          // READY 后才加入目录；本地测试过程经真实请求/账套租约造数，不挂载到 HTTP。
          const m = moduleKit(reportServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(async ({ ctx }) => seedVouchers(ctx.svc, specs)),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...reportServer, router }],
            devMode: true,
          });
          try {
            const session = runtime.sessions.create(bookId, 1);
            try {
              await router.createCaller({ app: runtime, token: session.token }).seed();
            } finally {
              runtime.sessions.delete(session.token);
            }
          } finally {
            // 新旧共享层的正常关闭入口；释放辅助 runtime 的完整目录租约。
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
