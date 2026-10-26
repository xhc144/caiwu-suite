import { afterEach, beforeEach, expect, it } from 'vitest';
import type { KyselyPlugin } from 'kysely';
import { openDatabase } from '@caiwu/db';
import { createCoreServices, type CoreDB } from '@caiwu/core/server';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import balancesServer from '../server';
import type { Report } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());

/** 只门控实际查询结果返回，不改 SQL 或任何余额值。 */
function afterCurrentSum(from: number, to: number) {
  const paused = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const targets = new Set<object>();
  let hits = 0;
  const plugin: KyselyPlugin = {
    transformQuery({ node, queryId }) {
      const text = JSON.stringify(node);
      const periods: number[] = [];
      const visit = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') {
          const n = value as Record<string, unknown>;
          if (
            n.kind === 'ValueNode' &&
            typeof n.value === 'number' &&
            n.value >= 202601 &&
            n.value <= 202712
          )
            periods.push(n.value);
          Object.values(n).forEach(visit);
        }
      };
      visit(node);
      if (
        text.includes('"name":"voucher_line"') &&
        text.includes('"name":"fc_debit"') &&
        periods[0] === from &&
        periods[1] === to
      )
        targets.add(queryId);
      return node;
    },
    async transformResult({ queryId, result }) {
      if (targets.has(queryId) && hits === 0) {
        hits++;
        paused.resolve();
        await resume.promise;
      }
      return result;
    },
  };
  return { plugin, paused: paused.promise, resume: () => resume.resolve(), hits: () => hits };
}

function values(report: Report) {
  return report.groups
    .flatMap((g) =>
      g.rows
        .filter((r) => r.isLeaf)
        .map((r) => ({
          currency: g.currency,
          code: r.accountCode,
          opening: r.opening,
          debit: r.debit,
          credit: r.credit,
          closing: r.closing,
          ytdDebit: r.ytdDebit,
          ytdCredit: r.ytdCredit,
          fcOpening: r.fcOpening,
          fcDebit: r.fcDebit,
          fcCredit: r.fcCredit,
          fcClosing: r.fcClosing,
        })),
    )
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.code.localeCompare(b.code));
}

for (const endpoint of ['query', 'export'] as const) {
  for (const scenario of ['summary', 'foreign', 'prior-period', 'cross-year'] as const) {
    it(`w_zw_ye/w_zw_wbye ${endpoint} ${scenario}：当前 sum 后另一连接真实过账100分，期间/YTD/多币种仍同一快照`, async () => {
      await app.svc.periods.ensureYear(2027);
      await app.svc.db
        .insertInto('currency')
        .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
        .execute();
      await app.svc.accounts.create(
        { code: '100203', name: '合成欧元', currency: 'EUR' },
        [4, 2, 2],
      );
      const specs = [
        { account: '1001', currency: undefined, opening: 1000 },
        { account: '100202', currency: 'USD', opening: 2000 },
        { account: '100203', currency: 'EUR', opening: 3000 },
      ];
      for (const spec of specs)
        await app.svc.opening.upsert({
          year: 2026,
          accountId: (await app.svc.accounts.require(spec.account)).id,
          currency: spec.currency,
          balance: spec.opening,
          fcBalance: spec.currency ? spec.opening : 0,
        });
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require('4001')).id,
        balance: -6000,
      });
      const line = (spec: (typeof specs)[number], amount: number) => ({
        account: spec.account,
        debit: amount,
        ...(spec.currency ? { currency: spec.currency, rate: '1', fcAmount: amount } : {}),
      });
      for (const date of ['2026-01-05', '2027-01-05'])
        await seedVouchers(
          app.svc,
          specs.map((spec) => ({
            date,
            status: 'posted',
            lines: [line(spec, 200), { account: '4001', credit: 200 }],
          })),
        );
      const cross = scenario === 'cross-year';
      const from = cross ? 202612 : 202602;
      const to = cross ? 202701 : 202602;
      const prior = scenario === 'prior-period';
      const pending = await seedVouchers(
        app.svc,
        specs.map((spec) => ({
          date: cross ? '2027-01-10' : prior ? '2026-01-10' : '2026-02-10',
          status: 'audited',
          lines: [line(spec, 100), { account: '4001', credit: 100 }],
        })),
      );
      const opened = app.runtime.bookStore.open(app.book.id);
      const writer = openDatabase<CoreDB>(opened.file);
      const writerSvc = createCoreServices({ ...app.svc.ctx, db: writer.db });
      const originalDb = opened.db;
      const gate = afterCurrentSum(from, to);
      opened.db = originalDb.withPlugin(gate.plugin);
      const input = {
        periodFrom: from,
        periodTo: to,
        mode: scenario === 'summary' ? ('summary' as const) : ('foreign' as const),
        codeFrom: scenario === 'summary' ? '1001' : '1002',
        codeTo: scenario === 'summary' ? '1001' : '1002',
      };
      const api = app.call(balancesServer);
      const reading = api[endpoint](input);
      try {
        await Promise.race([
          gate.paused,
          reading.then(() => {
            throw new Error('当前发生额门控未命中');
          }),
        ]);
        const readTransactionActive = opened.raw.inTransaction;
        await writerSvc.vouchers.changeStatus({ ids: pending.map((v) => v.id), to: 'posted' });
        expect(writer.raw.inTransaction).toBe(false);
        const committed = await writerSvc.ledger.balances({
          periodFrom: from,
          periodTo: to,
          rollup: false,
        });
        expect(committed.find((r) => r.accountCode === '1001')!.debit).toBe(
          (cross ? 200 : 0) + (prior ? 0 : 100),
        );
        expect(committed.find((r) => r.accountCode === '1001')!.opening).toBe(
          1200 + (prior ? 100 : 0),
        );
        gate.resume();
        const current = cross ? 200 : 0;
        const before = specs
          .filter((s) => (scenario === 'summary' ? !s.currency : !!s.currency))
          .map((s) => ({
            currency: scenario === 'summary' ? '' : s.currency!,
            code: s.account,
            opening: s.opening + 200,
            debit: current,
            credit: 0,
            closing: s.opening + 200 + current,
            ytdDebit: 200,
            ytdCredit: 0,
            fcOpening: s.currency ? s.opening + 200 : 0,
            fcDebit: s.currency ? current : 0,
            fcCredit: 0,
            fcClosing: s.currency ? s.opening + 200 + current : 0,
          }))
          .sort((a, b) => a.currency.localeCompare(b.currency));
        expect(values(await reading)).toEqual(before);
        expect(gate.hits()).toBe(1);
        expect(readTransactionActive).toBe(true);
        const after = before.map((r) => ({
          ...r,
          opening: r.opening + (prior ? 100 : 0),
          debit: r.debit + (prior ? 0 : 100),
          closing: r.closing + 100,
          ytdDebit: r.ytdDebit + 100,
          fcOpening: r.currency ? r.fcOpening + (prior ? 100 : 0) : 0,
          fcDebit: r.currency ? r.fcDebit + (prior ? 0 : 100) : 0,
          fcClosing: r.currency ? r.fcClosing + 100 : 0,
        }));
        expect(values(await api[endpoint](input))).toEqual(after);
      } finally {
        gate.resume();
        await reading.catch(() => undefined);
        opened.db = originalDb;
        await writer.close();
      }
    });
  }
}
