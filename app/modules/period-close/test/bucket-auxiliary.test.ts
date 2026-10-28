import { expect, it } from 'vitest';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { closingBuckets } from '../server/buckets';
import { call, generateAll, rule, zeroOpening } from './helpers';

it('w_zw_ydjz / u_hlgl：现金流量项目不拆分期初辅助余额桶', async () => {
  const app = await createTestApp({ modules: [periodCloseServer] });
  try {
    const accountId = (await app.svc.accounts.require('1001')).id;
    const cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
    await app.svc.opening.upsert({ year: 2026, accountId, dimensions: { cashflow }, balance: 100 });
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require('4001')).id,
      balance: -100,
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', credit: 50 },
          { account: '4001', debit: 50 },
        ],
      },
    ]);
    const buckets = [...(await closingBuckets(app.svc, 202601, [], false)).values()].filter(
      (b) => b.accountId === accountId,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ amount: 50, dimensions: { cashflow: null } });
  } finally {
    await app.close();
  }
});

it('w_zw_ydjz：小于十二位小数的有效转出汇率保持正数并可正式保存', async () => {
  const app = await createTestApp({ modules: [periodCloseServer] });
  try {
    await zeroOpening(app);
    const source = await app.svc.accounts.create(
      { code: '6999', name: '合成小汇率损益', categoryId: 'pnl', currency: 'USD' },
      app.book.codeScheme,
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          {
            account: source.code,
            debit: 1,
            currency: 'USD',
            rate: '0.00000000000000011102230246251567',
            fcAmount: 9007199254740991,
          },
          { account: '4001', credit: 1 },
        ],
      },
    ]);
    await call(app).saveRule({ data: await rule(app) });
    const { result } = await generateAll(app);
    const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    const line = voucher.lines.find((l) => l.accountId === source.id)!;
    expect(line.exchangeRate).toMatch(/^0\.0+[1-9]/);
    expect(line).toMatchObject({ credit: 1, debit: 0, fcAmount: 9007199254740991 });
  } finally {
    await app.close();
  }
});
