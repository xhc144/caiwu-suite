import { spawnLocalServer } from '@caiwu/testkit/local-server';
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

/** 独占目录、随机端口与真实生产网页。绝不读取 Playwright 公用服务的账套目录。 */
export const test = base.extend<{ localServer: LocalServer }>({
  localServer: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-balances-e2e-'));
    const server = spawnLocalServer({
      cwd: process.cwd(),
      dataDir,
      shutdownProtocol: 'sigterm-bridge',
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
    });
    let request: APIRequestContext | undefined;
    try {
      const port = await server.ready();
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
        await server.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  },
});
