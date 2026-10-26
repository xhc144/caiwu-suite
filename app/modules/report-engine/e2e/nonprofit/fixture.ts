import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import { seedCashflowBook, nonprofitTestServer, fixtureChart } from '../../test/nonprofit/fixture';
import { checkCashflow403Sources } from '../../templates/nonprofit/cashflow';
import { fixtureMapping } from '../../test/nonprofit/fixture';

export const test = base.extend<{
  nonprofit: { baseURL: string; request: APIRequestContext; createBook(): Promise<string> };
}>({
  nonprofit: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-nonprofit-e2e-'));
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
        async createBook() {
          // 本测试独占数据目录；临时runtime只负责core/testkit造数，不挂HTTP造数后门。
          const m = moduleKit(nonprofitTestServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(async ({ ctx }) => {
                await seedCashflowBook(ctx.svc);
                await checkCashflow403Sources(ctx.svc, 202602, fixtureMapping());
              }),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...nonprofitTestServer, router }],
            devMode: true,
          });
          try {
            const book = await runtime.bookStore.create({
              name: '民非403独立E2E',
              orgName: '虚构民非单位',
              product: 'minfei',
              templateId: fixtureChart.id,
              startYear: 2026,
              startMonth: 1,
              adminPassword: 'admin',
            });
            const bookId = book.id;
            const session = runtime.sessions.create(bookId, 1);
            try {
              await router.createCaller({ app: runtime, token: session.token }).seed();
            } finally {
              runtime.sessions.delete(session.token);
            }
            return bookId;
          } finally {
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
