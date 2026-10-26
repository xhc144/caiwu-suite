import { expect, it } from 'vitest';
import fc from 'fast-check';
import Decimal from 'decimal.js';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import server from '../server';
import type { Transfer } from '../shared';
import type { VoucherBookTables } from '../server/migrations';

it('w_pzedit_fc fast-check：合法凭证与红字同科目/辅助项/币种金额数量净额为零', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.integer({ min: -1_000_000, max: 1_000_000 }).filter((v) => v !== 0),
      async (cents, quantityE6) => {
        const t = await createTestApp({ modules: [server] });
        try {
          await t.svc.accounts.create(
            {
              code: '100203',
              name: '外币数量性质',
              currency: 'USD',
              quantityUnit: '件',
              dimensions: [{ type: 'project', required: true }],
            },
            [4, 2, 2],
          );
          const [v] = await seedVouchers(t.svc, [
            {
              date: '2026-01-01',
              lines: [
                {
                  account: '100203',
                  debit: cents,
                  currency: 'USD',
                  rate: '7.1',
                  fcAmount: cents,
                  quantity: new Decimal(quantityE6).div(1_000_000).toFixed(),
                  unitPrice: '7.1',
                  dims: { project: 'XM01' },
                },
                { account: '6603', credit: cents },
              ],
            },
          ]);
          const api = t.call(server);
          const p = await api.preview.reverse({
            action: 'reverse',
            selection: { ids: [v!.id] },
            date: '2026-02-01',
            voucherTypeId: v!.voucherTypeId,
          });
          const r = await api.commit({ token: p.token, confirmed: true });
          const reverse = (await t.svc.vouchers.get(r.createdIds[0]!))!;
          const totals = new Map<
            string,
            { debit: number; credit: number; fc: number; quantity: Decimal }
          >();
          for (const l of [...v!.lines, ...reverse.lines]) {
            const key = `${l.accountId}:${JSON.stringify(l.dimensions)}:${l.currency}`;
            const sum = totals.get(key) ?? { debit: 0, credit: 0, fc: 0, quantity: new Decimal(0) };
            sum.debit += l.debit;
            sum.credit += l.credit;
            sum.fc += l.fcAmount ?? 0;
            sum.quantity = sum.quantity.add(l.quantity ?? '0');
            totals.set(key, sum);
          }
          for (const sum of totals.values())
            expect([sum.debit, sum.credit, sum.fc, sum.quantity.toFixed()]).toEqual([0, 0, 0, '0']);
          expect(await t.svc.vouchers.get(v!.id)).toEqual(v);
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 15 },
  );
});

it('w_pz_bhzl fast-check：断号整理唯一连续，稳定日期顺序，分录与金额不变', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 12 }),
      fc.boolean(),
      async (numbers, byDate) => {
        const t = await createTestApp({ modules: [server] });
        try {
          const vs = await seedVouchers(
            t.svc,
            numbers.map((_, i) => ({
              date: `2026-01-${String((i % 3) + 1).padStart(2, '0')}`,
              lines: [
                { account: '6603', debit: i + 1 },
                { account: '1001', credit: i + 1 },
              ],
            })),
          );
          await t.svc.vouchers.setNumbers(vs.map((v, i) => ({ id: v.id, number: numbers[i]! })));
          await t.svc.vouchers.setVoided(vs[0]!.id, true);
          const lines = await t.svc.db
            .selectFrom('voucher_line')
            .selectAll()
            .orderBy('id')
            .execute();
          const before = await t.svc.db
            .selectFrom('voucher')
            .select(['id', 'date', 'number', 'debit_total', 'credit_total'])
            .orderBy('id')
            .execute();
          const expected = [...before]
            .sort(
              (a, b) =>
                (byDate ? a.date.localeCompare(b.date) : 0) || a.number! - b.number! || a.id - b.id,
            )
            .map((v) => v.id);
          const api = t.call(server);
          const p = await api.preview.renumber({
            action: 'renumber',
            selection: { ids: [] },
            period: 202601,
            voucherTypeId: vs[0]!.voucherTypeId,
            byDate,
          });
          await api.commit({ token: p.token, confirmed: true, numberingConfirmed: true });
          const after = await t.svc.db
            .selectFrom('voucher')
            .select(['id', 'number', 'debit_total', 'credit_total'])
            .orderBy('number')
            .execute();
          expect(after.map((v) => v.number)).toEqual(numbers.map((_, i) => i + 1));
          expect(new Set(after.map((v) => v.number)).size).toBe(numbers.length);
          expect(after.map((v) => v.id)).toEqual(expected);
          expect(after.reduce((s, v) => s + v.debit_total + v.credit_total, 0)).toBe(
            before.reduce((s, v) => s + v.debit_total + v.credit_total, 0),
          );
          expect(
            await t.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
          ).toEqual(lines);
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 15 },
  );
});

it('w_pz_tjsh/w_pz_bhzl/w_pz_get fast-check：任意步骤故障，状态、编号、导入确认记录与起点一致', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 6 }),
      fc.constantFrom('audit', 'renumber', 'import'),
      async (failureIndex, action) => {
        const t = await createTestApp({ modules: [server] });
        try {
          const vs = await seedVouchers(
            t.svc,
            Array.from({ length: 6 }, (_, i) => ({
              date: '2026-01-01',
              lines: [
                { account: '6603', debit: i + 1 },
                { account: '1001', credit: i + 1 },
              ],
            })),
          );
          await t.svc.vouchers.setNumbers(vs.map((v, i) => ({ id: v.id, number: i + 11 })));
          const api = t.call(server);
          const b = t.call(
            server,
            await t.addUser('B', { permissions: ['voucher-book.view', 'voucher-book.audit'] }),
          );
          let token: string;
          if (action === 'audit')
            token = (
              await b.preview.audit({ action: 'audit', selection: { ids: vs.map((v) => v.id) } })
            ).token;
          else if (action === 'renumber')
            token = (
              await api.preview.renumber({
                action: 'renumber',
                selection: { ids: [] },
                period: 202601,
                voucherTypeId: vs[0]!.voucherTypeId,
              })
            ).token;
          else {
            const data = JSON.parse(
              (await api.export({ filter: {}, format: 'json' })).file,
            ) as Transfer;
            token = (
              await api.importPreview({
                file: JSON.stringify(data),
                format: 'json',
                targetDate: '2026-02-01',
              })
            ).token;
          }
          const trigger =
            action === 'audit'
              ? sql`CREATE TRIGGER voucher_book_property_failure BEFORE UPDATE OF status ON voucher WHEN NEW.id = ${sql.lit(vs[failureIndex - 1]!.id)} BEGIN SELECT RAISE(ABORT, '性质故障'); END`
              : action === 'renumber'
                ? sql`CREATE TRIGGER voucher_book_property_failure BEFORE UPDATE OF number ON voucher WHEN NEW.id = ${sql.lit(vs[failureIndex - 1]!.id)} AND NEW.number > 0 BEGIN SELECT RAISE(ABORT, '性质故障'); END`
                : sql`CREATE TRIGGER voucher_book_property_failure BEFORE INSERT ON voucher WHEN NEW.period = 202602 AND (SELECT count(*) FROM voucher WHERE period = 202602) = ${sql.lit(failureIndex - 1)} BEGIN SELECT RAISE(ABORT, '性质故障'); END`;
          await trigger.execute(t.svc.db);
          const snapshot = async () => ({
            vouchers: await t.svc.db.selectFrom('voucher').selectAll().orderBy('id').execute(),
            lines: await t.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
            plans: await t.svc.db
              .withTables<VoucherBookTables>()
              .selectFrom('voucher_book_plan')
              .selectAll()
              .orderBy('token')
              .execute(),
            logs: await t.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
          });
          const before = await snapshot();
          const commit =
            action === 'import'
              ? api.importCommit({ token, confirmed: true })
              : (action === 'audit' ? b : api).commit({
                  token,
                  confirmed: true,
                  cashflowConfirmed: true,
                  numberingConfirmed: true,
                });
          await expect(commit).rejects.toThrow();
          expect(await snapshot()).toEqual(before);
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 15 },
  );
});
