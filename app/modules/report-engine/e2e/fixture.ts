import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../server';
import {
  statutoryTestTemplate,
  seedStatutoryBook,
  statutoryTestConfiguration,
} from '../test/statutory-fixture';

/** 只打开本测试创建的独占目录；服务端无造数后门，不猜测全局E2E目录。 */
export const test = base.extend<{
  isolated: {
    baseURL: string;
    request: APIRequestContext;
    seed(bookId: string, specs: VoucherSpec[]): Promise<void>;
    prepareStatutoryBook(): Promise<{
      bookId: string;
      configuration: Awaited<ReturnType<typeof statutoryTestConfiguration>>;
    }>;
  };
}>({
  isolated: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-report-engine-e2e-'));
    const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
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
      const port = await server.ready();
      const baseURL = `http://127.0.0.1:${port}`;
      request = await playwright.request.newContext({ baseURL });
      await use({
        baseURL,
        request,
        async prepareStatutoryBook() {
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...reportServer, templates: [statutoryTestTemplate] }],
            devMode: true,
          });
          try {
            const book = await runtime.bookStore.create({
              name: '公共报表界面合成账套',
              orgName: '公共报表界面合成单位',
              templateId: statutoryTestTemplate.id,
              product: 'chengben',
              startYear: 2023,
              startMonth: 1,
              adminPassword: 'admin',
            });
            const m = moduleKit(reportServer.manifest);
            const router = m.router({
              prepare: m.procedure
                .meta({ permission: 'report-engine.edit' })
                .mutation(async ({ ctx }) => {
                  await seedStatutoryBook(ctx.svc);
                  return statutoryTestConfiguration(ctx.svc);
                }),
            });
            const session = runtime.sessions.create(book.id, 1);
            try {
              const configuration = await router
                .createCaller({ app: runtime, token: session.token })
                .prepare();
              return { bookId: book.id, configuration };
            } finally {
              runtime.sessions.delete(session.token);
            }
          } finally {
            await runtime.bookStore.closeAll();
          }
        },
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
        await server.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  },
});
