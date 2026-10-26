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
import { balanceFixtureChart, seedBalance401Book } from '../../test/nonprofit/balance-fixture';
import { balanceFixtureMapping } from '../../test/nonprofit/balance-fixture';
import { checkBalance401Sources } from '../../templates/nonprofit/balance-sheet';
import {
  activityFixtureChart,
  activityFixtureMapping,
  seedActivity402Book,
  closeActivity402Pnl,
} from '../../test/nonprofit/activity-fixture';
import { checkActivityTotalsSources } from '../../templates/nonprofit/activity-totals';
import { seedVouchers } from '@caiwu/testkit';
import { validateComparativeCashflow403Generation } from '../../templates/nonprofit/cashflow-comparative';
import {
  classifiedChart,
  classifiedMapping,
  seedClassifiedBook,
  closeClassifiedPnl,
} from '../../test/nonprofit/activity-classified-fixture';
import { checkActivityClassifiedSources } from '../../templates/nonprofit/activity-classified';

type BookKind =
  'cashflow' | 'balance' | 'activity' | 'comparative' | 'classified' | 'classified-closed';

export const test = base.extend<{
  nonprofit: {
    baseURL: string;
    request: APIRequestContext;
    createBook(kind?: BookKind): Promise<string>;
  };
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
        async createBook(kind = 'cashflow') {
          // 本测试独占数据目录；临时runtime只负责core/testkit造数，不挂HTTP造数后门。
          const m = moduleKit(nonprofitTestServer.manifest);
          const router = m.router({
            seed: m.procedure
              .meta({ permission: 'report-engine.generate' })
              .mutation(async ({ ctx }) => {
                if (kind === 'classified' || kind === 'classified-closed') {
                  await seedClassifiedBook(ctx.svc);
                  if (kind === 'classified-closed') await closeClassifiedPnl(ctx.svc);
                  // 仅测试夹具的来源核验，不宣称公共generate已注册此预检。
                  await checkActivityClassifiedSources(ctx.svc, 202602, classifiedMapping());
                } else if (kind === 'activity') {
                  await seedActivity402Book(ctx.svc);
                  await closeActivity402Pnl(ctx.svc);
                  await checkActivityTotalsSources(ctx.svc, 202602, activityFixtureMapping());
                } else if (kind === 'balance') {
                  await seedBalance401Book(ctx.svc);
                  await checkBalance401Sources(ctx.svc, 202602, balanceFixtureMapping());
                } else {
                  await seedCashflowBook(ctx.svc);
                  if (kind === 'comparative') {
                    await ctx.svc.periods.ensureYear(2027);
                    await seedVouchers(ctx.svc, [
                      {
                        date: '2027-01-06',
                        status: 'posted',
                        lines: [
                          { account: '100201', debit: 33_000, dims: { cashflow: 'NF_donations' } },
                          { account: '410101', credit: 33_000 },
                        ],
                      },
                      {
                        date: '2027-02-06',
                        status: 'posted',
                        lines: [
                          { account: '510101', debit: 3_000 },
                          {
                            account: '100201',
                            credit: 3_000,
                            dims: { cashflow: 'NF_goodsServicesPaid' },
                          },
                        ],
                      },
                    ]);
                    await validateComparativeCashflow403Generation(
                      ctx.svc,
                      { period: 202702, includeUnposted: false },
                      { current: { ...fixtureMapping(), year: 2027 }, previous: fixtureMapping() },
                    );
                  } else await checkCashflow403Sources(ctx.svc, 202602, fixtureMapping());
                }
              }),
          });
          const runtime = createRuntime({
            dataDir,
            modules: [
              {
                ...nonprofitTestServer,
                router,
                templates:
                  kind === 'classified' || kind === 'classified-closed'
                    ? [classifiedChart]
                    : kind === 'balance'
                      ? [balanceFixtureChart]
                      : kind === 'activity'
                        ? [activityFixtureChart]
                        : [fixtureChart],
              },
            ],
            devMode: true,
          });
          try {
            const book = await runtime.bookStore.create({
              name: `民非${kind === 'balance' ? '401' : '403'}独立E2E`,
              orgName: '虚构民非单位',
              product: 'minfei',
              templateId:
                kind === 'classified' || kind === 'classified-closed'
                  ? classifiedChart.id
                  : fixtureChart.id,
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
