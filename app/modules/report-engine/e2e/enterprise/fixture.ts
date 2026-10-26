import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import type { ReportTemplate } from '../../shared';
import reportServer from '../../server';
import { balanceSlice, cashSlice, setupEnterpriseFixture } from '../../test/enterprise/fixture';

/** 独立进程、独立账套目录；造数只经本地testkit/core，不安装测试HTTP后门。 */
export const test = base.extend<{
  enterprise: {
    baseURL: string;
    request: APIRequestContext;
    seed(bookId: string): Promise<{ balance: ReportTemplate; cashflow: ReportTemplate }>;
  };
}>({
  enterprise: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-enterprise-e2e-'));
    const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const server = spawnLocalServer({
      cwd: appRoot,
      dataDir,
      shutdownProtocol: 'sigterm-bridge',
      env: {
        ...process.env,
        CAIWU_DATA_DIR: dataDir,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.join(appRoot, 'apps/web/dist'),
      },
    });
    let request: APIRequestContext | undefined;
    try {
      const baseURL = `http://127.0.0.1:${await server.ready()}`;
      request = await playwright.request.newContext({ baseURL });
      await use({
        baseURL,
        request,
        async seed(bookId) {
          const m = moduleKit(reportServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(async ({ ctx }) => {
                await setupEnterpriseFixture(ctx.svc);
                return { balance: balanceSlice(), cashflow: await cashSlice(ctx.svc) };
              }),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...reportServer, router }],
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
        await server.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  },
});
