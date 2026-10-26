import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';

export async function seedMultiBook(svc: CoreServices) {
  const { codeScheme } = await svc.book.info();
  for (const [code, name] of [
    ['4999', '合成多栏根'],
    ['499901', '第一分栏'],
    ['499902', '第二分栏'],
    ['499903', '空分栏'],
    ['49990101', '第一末级'],
    ['49990102', '第二末级'],
  ]) {
    await svc.accounts.create(
      { code: code!, name: name!, categoryId: 'equity', direction: 'credit' },
      codeScheme,
    );
  }
  const first = await svc.accounts.require('49990101');
  const second = await svc.accounts.require('499902');
  await svc.opening.upsert({
    year: 2026,
    accountId: first.id,
    balance: 10000,
    ytdDebit: 5000,
    ytdCredit: 1000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: second.id,
    balance: -3000,
    ytdDebit: 2000,
    ytdCredit: 4000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('4001')).id,
    balance: -7000,
  });
  const voucher = (
    date: string,
    account: string,
    debit: number,
    credit: number,
    status: VoucherSpec['status'] = 'posted',
  ): VoucherSpec => ({
    date,
    status,
    summary: `合成${account}`,
    lines: [
      { account, debit, credit },
      { account: '4001', debit: credit, credit: debit },
    ],
  });
  const vouchers = await seedVouchers(svc, [
    voucher('2026-07-01', '49990101', 1000, 0),
    voucher('2026-07-02', '49990102', 0, 2000),
    voucher('2026-07-03', '49990101', -300, 0),
    voucher('2026-07-04', '499902', 0, -100),
    voucher('2026-07-05', '499902', 500, 0, 'pending'),
    voucher('2026-07-06', '49990102', 0, 200, 'audited'),
    voucher('2026-07-07', '499902', 999, 0, 'draft'),
    voucher('2026-07-08', '499902', 777, 0, 'pending'),
    voucher('2026-12-01', '499902', 200, 0),
  ]);
  await svc.vouchers.setVoided(vouchers[7]!.id, true);
  await svc.periods.ensureYear(2027);
  await seedVouchers(svc, [voucher('2027-01-01', '49990101', 0, 50)]);
  return { firstId: first.id, secondId: second.id, voucherId: vouchers[0]!.id };
}
