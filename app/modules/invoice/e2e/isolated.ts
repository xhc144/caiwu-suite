import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { test as base, type APIRequestContext } from '@playwright/test';
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

export const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-invoice-e2e-'));
    const localServer = spawnLocalServer({
      cwd: process.cwd(),
      dataDir,
      shutdownProtocol: 'sigterm-bridge',
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: E2E_APP_TOKEN,
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
    });
    let request: APIRequestContext | undefined;
    try {
      const port = await localServer.ready();
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
        await localServer.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  },
});
export { expect } from '@playwright/test';
