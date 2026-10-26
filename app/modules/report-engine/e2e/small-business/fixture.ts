import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import reportServer from '../../server';
import { opening, prepareCashflow } from '../../test/small-business/fixture';

const specs: VoucherSpec[] = [
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '1001', debit: 120001, dims: { cashflow: 'SB01' } },
      { account: '6001', credit: 120001 },
    ],
  },
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '1405', debit: 30001, quantity: '3' },
      { account: '1001', credit: 30001, dims: { cashflow: 'SB03' } },
    ],
  },
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '100201', debit: 50001, dims: { cashflow: 'SB_INTERNAL' } },
      { account: '1001', credit: 50001, dims: { cashflow: 'SB_INTERNAL' } },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '1001', debit: 22002, dims: { cashflow: 'SB01' } },
      { account: '6001', credit: 22002 },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '6001', debit: 2002 },
      { account: '1001', credit: 2002, dims: { cashflow: 'SB01' } },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '1601', debit: 301 },
      { account: '1001', credit: 301, dims: { cashflow: 'SB10' } },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '1405', debit: 5001, quantity: '5' },
      { account: '1001', credit: 5001, dims: { cashflow: 'SB03' } },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '1001', debit: 1001, dims: { cashflow: 'SB03' } },
      { account: '1405', credit: 1001, quantity: '1' },
    ],
  },
];

export const test = base.extend<{
  isolatedSmall: {
    baseURL: string;
    request: APIRequestContext;
    seed(bookId: string): Promise<void>;
  };
}>({
  isolatedSmall: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-small-business-e2e-'));
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
                // 此调用只存在于测试进程，不挂载HTTP后门；不经凭证/审核/结账页面。
                await ctx.svc.tx(async (svc) => {
                  await svc.accounts.create(
                    { code: '1012', name: '其他货币资金', categoryId: 'asset' },
                    [4, 2, 2],
                  );
                  await prepareCashflow(svc);
                  await opening(svc, '1001', 100000);
                  await opening(svc, '4001', -100000);
                  await seedVouchers(svc, specs);
                });
              }),
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
