import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { createRuntime, moduleKit } from '@caiwu/server-kit';
import type { CoreServices } from '@caiwu/core/server';
import type { ReportTemplate } from '../../shared';
import reportServer from '../../server';
import { balanceSlice, cashSlice, setupEnterpriseFixture } from '../../test/enterprise/fixture';
import { balanceBindings, cashBindings } from '../../test/enterprise/fixture';
import { periodProfit, setupPeriodFixture } from '../../test/enterprise/period-fixture';
import { purchaseTemplate, seedPurchaseFixture } from '../../test/enterprise/purchase-fixture';
import { enterpriseCashflow } from '../../templates/enterprise';
import {
  buildBalanceSheetComparatives,
  buildCashflowComparatives,
} from '../../templates/enterprise/period-slice';

/** 独立进程、独立账套目录；造数只经本地testkit/core，不安装测试HTTP后门。 */
export const test = base.extend<{
  enterprise: {
    baseURL: string;
    request: APIRequestContext;
    withCore(bookId: string, operation: (svc: CoreServices) => Promise<void>): Promise<void>;
    seed(
      bookId: string,
      mode?: 'current' | 'comparative' | 'purchase',
    ): Promise<{ balance: ReportTemplate; cashflow: ReportTemplate; profit?: ReportTemplate }>;
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
        async withCore(bookId, operation) {
          const m = moduleKit(reportServer.manifest);
          const router = m.router({
            run: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(({ ctx }) => operation(ctx.svc)),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [{ ...reportServer, router }],
            devMode: true,
          });
          const session = runtime.sessions.create(bookId, 1);
          try {
            await router.createCaller({ app: runtime, token: session.token }).run();
          } finally {
            runtime.sessions.delete(session.token);
            await runtime.bookStore.closeAll();
          }
        },
        async seed(bookId, mode = 'current') {
          const m = moduleKit(reportServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(async ({ ctx }) => {
                if (mode === 'purchase') {
                  await seedPurchaseFixture(ctx.svc);
                  // 此模式只造采购201账套；203保留未配置表样，不声称已有取数。
                  return {
                    balance: await purchaseTemplate(ctx.svc),
                    cashflow: enterpriseCashflow(),
                  };
                }
                if (mode === 'comparative') {
                  await setupPeriodFixture(ctx.svc);
                  const accounts = await ctx.svc.accounts.list();
                  const flows = {
                    ...cashBindings,
                    items: { ...cashBindings.items, taxRefunds: 'CF07' },
                  };
                  return {
                    balance: buildBalanceSheetComparatives(
                      balanceBindings,
                      balanceBindings,
                      accounts,
                    ),
                    cashflow: buildCashflowComparatives(flows, flows, accounts),
                    profit: await periodProfit(ctx.svc),
                  };
                }
                await setupEnterpriseFixture(ctx.svc);
                return { balance: await balanceSlice(ctx.svc), cashflow: await cashSlice(ctx.svc) };
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
