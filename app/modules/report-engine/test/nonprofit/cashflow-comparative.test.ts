import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  comparativeCashflow403Template,
  validateComparativeCashflow403Generation,
} from '../../templates/nonprofit/cashflow-comparative';
import {
  fixtureChart,
  fixtureMapping,
  nonprofitTestServer,
  seedCashflowBook,
  cashflowGolden,
} from './fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [nonprofitTestServer],
    product: 'minfei',
    templateId: fixtureChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});
const mapping = () => ({
  current: {
    ...fixtureMapping(),
    year: 2027,
    policyBasis: '虚构2027年度独立复核政策：现金及随时支付银行款，无等价物',
  },
  previous: fixtureMapping(),
});

describe('403本年/比较期统一取数接线', () => {
  it('真实router比较2027年累计30000分与2026年同期121700分；两栏独立取数和勾稽', async () => {
    await seedCashflowBook(app.svc);
    await app.svc.periods.ensureYear(2027);
    await seedVouchers(app.svc, [
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
          { account: '100201', credit: 3_000, dims: { cashflow: 'NF_goodsServicesPaid' } },
        ],
      },
    ]);
    await app.svc.tx((s) =>
      validateComparativeCashflow403Generation(
        s,
        { period: 202702, includeUnposted: false },
        mapping(),
      ),
    );
    const api = app.call(nonprofitTestServer);
    const r = await api.importTemplate(comparativeCashflow403Template(mapping()));
    const result = await api.generate({
      id: r.id,
      expectedRevision: 1,
      period: 202702,
      confirmUnposted: true,
      requestId: randomUUID(),
    });
    if (result.kind !== 'generated') throw new Error('未生成');
    const values = Object.fromEntries(
      result.snapshot.cells.filter((c) => c.unit === 'cents').map((c) => [c.address, c.value]),
    );
    const previous = Object.fromEntries(
      Object.entries(cashflowGolden).map(([a, v]) => [a.replace(/^B/, 'C'), v]),
    );
    expect(Object.fromEntries(Object.entries(values).filter(([a]) => a.startsWith('C')))).toEqual(
      previous,
    );
    expect(values).toMatchObject({
      B6: '33000',
      B15: '3000',
      B19: '30000',
      B30: '0',
      B39: '0',
      B40: '0',
      B41: '30000',
      C41: '121700',
    });
    expect(result.snapshot.checks.map((c) => c.status)).toEqual(['pass', 'pass']);
    expect(await api.exportResult({ id: r.id, period: 202702 })).not.toBeNull();
  });

  it('未建立比较期间和来源年份不匹配必须报错，不用首次2026例外豁免2027比较数', async () => {
    await seedCashflowBook(app.svc);
    const api = app.call(nonprofitTestServer);
    const r = await api.importTemplate(comparativeCashflow403Template(mapping()));
    await expect(
      api.generate({
        id: r.id,
        expectedRevision: 1,
        period: 202702,
        confirmUnposted: true,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('2027年02月还没有建立');
    expect(await api.snapshot({ id: r.id, period: 202702 })).toBeNull();
    expect(() =>
      comparativeCashflow403Template({
        ...mapping(),
        previous: { ...fixtureMapping(), year: 2027 },
      }),
    ).toThrow(/上年度/);
    await expect(
      validateComparativeCashflow403Generation(
        app.svc,
        { period: 202702, includeUnposted: true },
        mapping(),
      ),
    ).rejects.toThrow(/已过账/);
  });
});
