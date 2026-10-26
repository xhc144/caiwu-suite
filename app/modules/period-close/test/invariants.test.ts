import { expect, it } from 'vitest';
import fc from 'fast-check';
import { Decimal, dimensionsKey, qtyFromE6, qtyToE6, sumCents } from '@caiwu/core';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { audited, call, generateAll, rule, zeroOpening } from './helpers';

it('fast-check w_zw_jz/fgz、w_zw_fz/qxfz：往返恢复余额、业务状态、手工期初', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: -1000000, max: 1000000 }).filter((n) => n !== 0),
      async (amount) => {
        const app = await createTestApp({ modules: [periodCloseServer] });
        try {
          const api = call(app);
          await zeroOpening(app);
          const { voucher } = await audited(app, 202601, amount);
          const original = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
          const opening = await app.svc.opening.list(2026);
          await api.post({ from: 202601, to: 202601 });
          await api.unpost({ from: 202601, to: 202601, confirmed: true });
          expect((await app.svc.vouchers.get(voucher.id))!.status).toBe('audited');
          expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).toEqual(
            original,
          );
          await api.post({ from: 202601, to: 202601 });
          const posted = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
          await api.close({ period: 202601, confirmed: true, allowUntransferredPnl: true });
          await api.reopen({ from: 202601, to: 202601, confirmed: true });
          expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).toEqual(
            posted,
          );
          expect(await app.svc.opening.list(2026)).toEqual(opening);
          expect((await app.svc.periods.require(202601)).status).toBe('open');
        } finally {
          await app.close();
        }
      },
    ),
    { numRuns: 8 },
  );
}, 30000);
it('fast-check w_zw_ydjz：正负/红字结转借贷相等，重复请求不增凭证', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.integer({ min: -1000000, max: 1000000 }).filter((n) => n !== 0),
        { minLength: 1, maxLength: 8 },
      ),
      async (amounts) => {
        const app = await createTestApp({ modules: [periodCloseServer] });
        try {
          const api = call(app);
          await zeroOpening(app);
          await api.saveRule({ data: await rule(app) });
          await seedVouchers(
            app.svc,
            amounts.map((amount) => ({
              date: '2026-01-05',
              status: 'posted' as const,
              lines: [
                { account: '1001', debit: amount },
                { account: '6001', credit: amount },
              ],
            })),
          );
          const { result, input } = await generateAll(app);
          for (const g of result.generated) {
            const v = (await app.svc.vouchers.get(g.id))!;
            expect(v.debitTotal).toBe(v.creditTotal);
          }
          await api.generate(input);
          expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(
            result.generated.length,
          );
        } finally {
          await app.close();
        }
      },
    ),
    { numRuns: 8 },
  );
}, 30000);
it('fast-check 年结：随机四维、多币、数量逐桶连续且累计归零，不写父级或合并币种', async () => {
  const arb = fc.array(
    fc.record({
      currency: fc.constantFrom('USD', 'EUR'),
      department: fc.constantFrom('01', '02'),
      amount: fc.integer({ min: -100000, max: 100000 }),
      qty: fc.integer({ min: -10000000, max: 10000000 }),
      foreign: fc.integer({ min: -10000, max: 10000 }),
    }),
    { minLength: 1, maxLength: 8 },
  );
  await fc.assert(
    fc.asyncProperty(arb, async (data) => {
      const app = await createTestApp({ modules: [periodCloseServer] });
      try {
        const api = call(app);
        await zeroOpening(app);
        await app.svc.db
          .insertInto('currency')
          .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
          .execute();
        const dims = [
          { type: 'project' as const },
          { type: 'partner' as const },
          { type: 'department' as const },
          { type: 'person' as const },
        ];
        const usd = await app.svc.accounts.create(
          {
            code: '1701',
            name: '多维美元',
            categoryId: 'asset',
            currency: 'USD',
            quantityUnit: '件',
            dimensions: dims,
          },
          app.book.codeScheme,
        );
        const eur = await app.svc.accounts.create(
          {
            code: '1702',
            name: '多维欧元',
            categoryId: 'asset',
            currency: 'EUR',
            quantityUnit: '件',
            dimensions: dims,
          },
          app.book.codeScheme,
        );
        const buckets = new Map<
          string,
          {
            accountId: number;
            currency: string;
            dimensions: Record<'project' | 'partner' | 'department' | 'person', number>;
            balance: number;
            fcBalance: number;
            quantity: string;
          }
        >();
        for (const r of data) {
          const dimensions = {
            project: (await app.svc.dimensions.getByCode('project', 'XM01'))!.id,
            partner: (await app.svc.dimensions.getByCode('partner', 'C001'))!.id,
            department: (await app.svc.dimensions.getByCode('department', r.department))!.id,
            person: (await app.svc.dimensions.getByCode('person', 'P01'))!.id,
          };
          const accountId = r.currency === 'USD' ? usd.id : eur.id;
          const key = `${accountId}|${dimensionsKey(dimensions)}|${r.currency}`;
          const old = buckets.get(key);
          buckets.set(key, {
            accountId,
            currency: r.currency,
            dimensions,
            balance: sumCents([old?.balance, r.amount]),
            fcBalance: sumCents([old?.fcBalance, r.foreign]),
            quantity: qtyFromE6(qtyToE6(old?.quantity ?? '0') + r.qty),
          });
        }
        for (const b of buckets.values())
          await app.svc.opening.upsert({ year: 2026, ...b, ytdDebit: 123 });
        await app.svc.opening.upsert({
          year: 2026,
          accountId: (await app.svc.accounts.require('4001')).id,
          balance: -sumCents([...buckets.values()].map((b) => b.balance)),
          ytdCredit: buckets.size * 123,
        });
        for (let month = 1; month <= 12; month++)
          await api.close({ period: 202600 + month, confirmed: true });
        await api.yearEnd({ year: 2026, confirmed: true });
        const next = await app.svc.opening.list(2027);
        for (const b of buckets.values()) {
          const row = next.find(
            (r) =>
              r.accountId === b.accountId &&
              r.currency === b.currency &&
              dimensionsKey(r.dimensions) === dimensionsKey(b.dimensions),
          );
          expect(row).toMatchObject({ ...b, ytdDebit: 0, ytdCredit: 0 });
        }
        const balances = await app.svc.ledger.balances({
          periodFrom: 202701,
          periodTo: 202701,
          rollup: false,
          includeZero: true,
        });
        expect(balances.every((r) => r.ytdDebit === 0 && r.ytdCredit === 0)).toBe(true);
        expect(new Decimal(balances.reduce((s, r) => s + r.closing, 0)).isZero()).toBe(true);
        expect(
          next.every(
            (r) => r.accountId !== (usd.parentId ?? -1) && r.accountId !== (eur.parentId ?? -1),
          ),
        ).toBe(true);
        expect((await app.svc.periods.list()).filter((p) => p.year === 2027)).toHaveLength(12);
      } finally {
        await app.close();
      }
    }),
    { numRuns: 8 },
  );
}, 30000);
