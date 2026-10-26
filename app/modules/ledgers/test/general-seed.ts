import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';

/** 仅用于独立合成账套；2026 年 7 月启用，账前累计不含逐月历史。 */
export async function seedGeneralBook(svc: CoreServices) {
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 6_000,
    ytdDebit: 10_000,
    ytdCredit: 4_000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('4001')).id,
    balance: -6_000,
  });
  const cash = (
    date: string,
    value: number,
    status: VoucherSpec['status'] = 'posted',
  ): VoucherSpec => ({
    date,
    status,
    lines: [
      { account: '1001', debit: value },
      { account: '4001', credit: value },
    ],
  });
  const vouchers = await seedVouchers(svc, [
    cash('2026-07-02', 2_000),
    cash('2026-07-03', -300),
    {
      date: '2026-07-04',
      status: 'posted',
      lines: [
        { account: '1001', credit: 500 },
        { account: '4001', debit: 500 },
      ],
    },
    cash('2026-07-05', 100, 'pending'),
    cash('2026-07-06', 200, 'audited'),
    cash('2026-07-07', 999, 'draft'),
    cash('2026-07-08', 777, 'pending'),
    {
      date: '2026-07-09',
      status: 'posted',
      lines: [
        { account: '100201', debit: 500 },
        { account: '4001', credit: 500 },
      ],
    },
    {
      date: '2026-07-10',
      status: 'posted',
      lines: [
        { account: '100202', debit: 710, currency: 'USD', fcAmount: 100, rate: '7.1' },
        { account: '4001', credit: 710 },
      ],
    },
    cash('2026-12-02', 300),
  ]);
  await svc.vouchers.setVoided(vouchers[6]!.id, true);
  await svc.periods.ensureYear(2027);
  const nextYear = await seedVouchers(svc, [cash('2027-01-02', 101)]);
  return { voucherId: vouchers[0]!.id, nextYearId: nextYear[0]!.id };
}
